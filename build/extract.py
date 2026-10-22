"""Extract site data from the repository's own generated documents and code.

Inputs (all inside hakase_operating_system):
  docs/18a_method_reference.md        generated from the method registry
  docs/13_glossary.md                 the project glossary
  backend/hos/drivers                 the built-in study drivers
Nothing is typed in by hand here; re-run after the repository changes.
"""
import json, re, sys, pathlib
ROOT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parent.parent.parent
OUT = pathlib.Path(__file__).parent / "data"; OUT.mkdir(exist_ok=True)

def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

# ---- methods ----
md = (ROOT / "docs/18a_method_reference.md").read_text()
areas, cur, meth, mode = [], None, None, None
for line in md.splitlines():
    if line.startswith("## "):
        name = line[3:].strip()
        if name == "Standing limitations":
            cur = None; continue
        cur = {"name": name, "slug": slug(name), "methods": []}; areas.append(cur); meth = None; continue
    if cur is None: continue
    if line.startswith("### "):
        meth = {"title": line[4:].strip(), "id": None, "version": None, "assumptions": [], "limits": [], "references": []}
        cur["methods"].append(meth); mode = None; continue
    if meth is None: continue
    m = re.match(r"^`([^`]+)` · version (\S+)", line)
    if m: meth["id"], meth["version"] = m.group(1), m.group(2); continue
    if line.strip() in ("Assumptions:", "Limits:", "References:"):
        mode = line.strip()[:-1].lower(); continue
    if line.startswith("- ") and mode:
        txt = line[2:].strip()
        if mode == "references":
            url = None
            mm = re.search(r"(https?://\S+)$", txt)
            if mm: url = mm.group(1); txt = txt[:mm.start()].strip()
            meth["references"].append({"text": txt, "url": url})
        else:
            meth[mode].append(txt)
standing = re.search(r"## Standing limitations\n\n(.*?)\n## ", md, re.S).group(1).strip()
json.dump({"areas": areas, "standing": standing}, open(OUT / "methods.json", "w"), indent=1)
print("methods", sum(len(a["methods"]) for a in areas), "areas", len(areas))

# ---- glossary ----
gl = (ROOT / "docs/13_glossary.md").read_text()
terms = []
for m in re.finditer(r"\*\*(.+?)\*\* — (.+?)(?=\n\n|\Z)", gl, re.S):
    terms.append({"term": m.group(1).strip(), "definition": re.sub(r"\s+", " ", m.group(2)).strip()})
json.dump(terms, open(OUT / "glossary_src.json", "w"), indent=1)
print("glossary", len(terms))

# ---- drivers ----
sys.path.insert(0, str(ROOT / "backend"))
from hos.drivers.registry import default_registry
drivers = []
for d in default_registry():
    drivers.append({"name": d.name, "version": getattr(d, "version", None), "description": getattr(d, "description", None)})
json.dump(drivers, open(OUT / "drivers.json", "w"), indent=1)
print("drivers", len(drivers))
