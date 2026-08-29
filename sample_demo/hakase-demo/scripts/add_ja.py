"""Merge a batch of translations into src/i18n/ja.ts, preserving what's there."""
import io, json, re, sys

PATH = "src/i18n/ja.ts"

def load():
    src = io.open(PATH, encoding="utf-8").read()
    head, _, rest = src.partition("export const JA: Record<string, string> = {")
    body = rest.rsplit("};", 1)[0]
    entries, sections = {}, []
    cur = None
    for line in body.split("\n"):
        sec = re.match(r'\s*/\* ── (.+?) ─+ \*/', line)
        if sec:
            cur = sec.group(1); sections.append(cur); continue
        m = re.match(r'\s*("(?:\\.|[^"\\])*")\s*:\s*("(?:\\.|[^"\\])*")\s*,\s*$', line)
        if m:
            entries[json.loads(m.group(1))] = (json.loads(m.group(2)), cur)
    return head, entries, sections

def save(head, entries, sections):
    out = head + "export const JA: Record<string, string> = {\n"
    for sec in sections:
        rows = [(k, v) for k, (v, s) in entries.items() if s == sec]
        if not rows: continue
        pad = "─" * max(3, 68 - len(sec))
        out += f"\n  /* ── {sec} {pad} */\n"
        for k, v in rows:
            out += f"  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},\n"
    out += "};\n"
    io.open(PATH, "w", encoding="utf-8").write(out)

def add(section, mapping):
    head, entries, sections = load()
    if section not in sections: sections.append(section)
    added = 0
    for k, v in mapping.items():
        if k not in entries: added += 1
        entries[k] = (v, section)
    save(head, entries, sections)
    print(f"{section}: +{added} new, {len(entries)} total")
