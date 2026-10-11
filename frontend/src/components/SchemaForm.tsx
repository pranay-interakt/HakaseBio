import { useEffect, useState } from "react";
import type { JsonSchema } from "../types";

// Renders a form from a driver's pydantic JSON schema: nested objects as groups, lists of records
// as editable tables, maps as key/value rows, tuples as fixed inputs. Values the user does not
// enter are omitted, so the backend's validation (not the browser) decides what is missing and
// nothing is defaulted on the scientist's behalf. Raw JSON entry remains only for the rare field
// whose schema has no single shape (a union of several structures).

type Json = unknown;
type Obj = Record<string, Json>;

function resolve(s: JsonSchema, root: JsonSchema): JsonSchema {
  if (s.$ref) {
    const name = s.$ref.split("/").pop() ?? "";
    return root.$defs?.[name] ?? s;
  }
  return s;
}

function unwrapOptional(s: JsonSchema, root: JsonSchema): { schema: JsonSchema; optional: boolean } {
  if (s.anyOf) {
    const nonNull = s.anyOf.filter((x) => x.type !== "null");
    if (nonNull.length === 1) return { schema: resolve(nonNull[0], root), optional: true };
  }
  return { schema: resolve(s, root), optional: false };
}

type Kind =
  "enum" | "boolean" | "number" | "string" | "multi-enum" | "list" | "tuple" | "records" | "object" | "map" | "json";

function kindOf(s: JsonSchema, root: JsonSchema): Kind {
  if (s.enum) return "enum";
  if (s.type === "boolean") return "boolean";
  if (s.type === "number" || s.type === "integer") return "number";
  if (s.type === "string") return "string";
  if (s.type === "array") {
    if (s.prefixItems) return "tuple";
    const it = s.items ? resolve(unwrapOptional(s.items, root).schema, root) : {};
    if (it.enum) return "multi-enum";
    if (it.type === "number" || it.type === "integer" || it.type === "string") return "list";
    if (it.properties) return "records";
    return "json";
  }
  if (s.properties) return "object";
  if (s.type === "object" && s.additionalProperties && typeof s.additionalProperties === "object") return "map";
  return "json";
}

const SCALAR: Kind[] = ["enum", "boolean", "number", "string", "list", "multi-enum"];

const UNITS: Record<string, string> = {
  uM: "µM",
  nM: "nM",
  mM: "mM",
  uL: "µL",
  mL: "mL",
  L: "L",
  ug: "µg",
  ng: "ng",
  mg: "mg",
  g: "g",
  kg: "kg",
  C: "°C",
  c: "°C",
  min: "min",
  h: "h",
  ms: "ms",
  pA: "pA",
  mmhg: "mmHg",
  percent: "%",
  ul: "µL",
  da: "Da",
  day: "day",
  Hz: "Hz",
  bpm: "bpm",
  pctvv: "% v/v",
};
const ABBREV: Record<string, string> = {
  ic50: "IC50",
  ec50: "EC50",
  nadph: "NADPH",
  r2: "r²",
  tk: "TK",
  pk: "PK",
  qtc: "QTc",
  qt: "QT",
  rr: "RR",
  bp: "BP",
  cv: "CV",
  lloq: "LLOQ",
  uloq: "ULOQ",
  isr: "ISR",
  auc: "AUC",
  cmax: "Cmax",
  tmax: "Tmax",
  noael: "NOAEL",
  glp: "GLP",
  ppb: "PPB",
  herg: "hERG",
  fu: "fu",
  clint: "CLint",
  mtd: "MTD",
  id: "ID",
  sd: "SD",
  ci: "CI",
  is: "IS",
  mwco: "MWCO",
  blq: "BLQ",
  qc: "QC",
  spo2: "SpO2",
  pr: "PR",
  qrs: "QRS",
};

/** "acceptance_clint_low_uL_min_mg" -> "Acceptance CLint low (µL/min/mg)": units in brackets. */
export function fieldLabel(name: string): string {
  const words = name
    .replace(/_percent_v_v$/, "_pctvv")
    .replace(/_per_/g, "_/_")
    .split("_")
    .filter(Boolean);
  // the unit is the run of unit words at the end ("/" joins them)
  let i = words.length;
  while (i > 1 && (UNITS[words[i - 1]] !== undefined || words[i - 1] === "/")) i--;
  if (words[i] === "/") i++;
  const head = words.slice(0, i).map((w, j) => {
    const a = ABBREV[w.toLowerCase()];
    if (a) return a;
    return j === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  });
  const unitWords = words.slice(i).filter((w) => w !== "/");
  const unit = unitWords.map((w) => UNITS[w]).join("/");
  return unit ? `${head.join(" ")} (${unit})` : head.join(" ");
}

/** "PositiveControl" -> "positive control". */
export function itemLabel(title: string | undefined): string {
  if (!title) return "row";
  return title.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function placeholderFor(s: JsonSchema): string | undefined {
  if (s.default === undefined || s.default === null) return undefined;
  return `if left empty: ${Array.isArray(s.default) ? s.default.join(", ") : String(s.default)}`;
}

// ---- inputs ---------------------------------------------------------------------------------

function NumberInput({
  value,
  onChange,
  placeholder,
}: {
  value: Json;
  onChange: (v: Json) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === undefined || value === null ? "" : String(value));
  useEffect(() => {
    const cur = text.trim() === "" ? undefined : Number(text);
    if (cur !== value && !(cur === undefined && (value === undefined || value === null)))
      setText(value === undefined || value === null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === "") onChange(undefined);
        else if (!Number.isNaN(Number(t))) onChange(Number(t));
      }}
      className={text.trim() !== "" && Number.isNaN(Number(text)) ? "invalid" : undefined}
    />
  );
}

function ListInput({
  value,
  onChange,
  numeric,
  placeholder,
}: {
  value: Json;
  onChange: (v: Json) => void;
  numeric: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(Array.isArray(value) ? value.join(", ") : "");
  return (
    <input
      value={text}
      placeholder={placeholder ?? "comma-separated"}
      onChange={(e) => {
        setText(e.target.value);
        const parts = e.target.value
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        onChange(parts.length === 0 ? undefined : numeric ? parts.map(Number) : parts);
      }}
    />
  );
}

function JsonInput({ value, onChange }: { value: Json; onChange: (v: Json) => void }) {
  const [text, setText] = useState(value === undefined ? "" : JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <>
      <textarea
        rows={4}
        value={text}
        className={bad ? "invalid" : undefined}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) {
            setBad(false);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(e.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
      {bad && <span className="field-help qc-fail">Not valid yet: this field takes structured text.</span>}
    </>
  );
}

// ---- one value of any shape -----------------------------------------------------------------

function ValueInput({
  schema,
  value,
  onChange,
  root,
}: {
  schema: JsonSchema;
  value: Json;
  onChange: (v: Json) => void;
  root: JsonSchema;
}) {
  const s = schema;
  const k = kindOf(s, root);
  const ph = placeholderFor(s);
  switch (k) {
    case "enum":
      return (
        <select
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">{ph ? `— (${ph})` : "—"}</option>
          {s.enum!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "boolean":
      return (
        <select
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")}
        >
          <option value="">{ph ? `— (${ph})` : "—"}</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    case "number":
      return <NumberInput value={value} onChange={onChange} placeholder={ph} />;
    case "string":
      return (
        <input
          value={value === undefined || value === null ? "" : String(value)}
          placeholder={ph}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    case "list": {
      const it = resolve(unwrapOptional(s.items!, root).schema, root);
      return <ListInput value={value} onChange={onChange} numeric={it.type !== "string"} placeholder={ph} />;
    }
    case "multi-enum": {
      const it = resolve(unwrapOptional(s.items!, root).schema, root);
      const cur = new Set((value as string[] | undefined) ?? []);
      return (
        <div className="checks">
          {it.enum!.map((o) => (
            <label key={o}>
              <input
                type="checkbox"
                checked={cur.has(o)}
                onChange={(e) => {
                  const n = new Set(cur);
                  if (e.target.checked) n.add(o);
                  else n.delete(o);
                  const out = it.enum!.filter((x) => n.has(x));
                  onChange(out.length ? out : undefined);
                }}
              />
              {o}
            </label>
          ))}
        </div>
      );
    }
    case "tuple": {
      const items = s.prefixItems!;
      const cur = Array.isArray(value) ? value : [];
      const dflt = Array.isArray(s.default) ? s.default : [];
      return (
        <div className="sf-tuple">
          {items.map((_, i) => (
            <NumberInput
              key={i}
              value={cur[i]}
              placeholder={dflt[i] !== undefined ? String(dflt[i]) : undefined}
              onChange={(v) => {
                const next = items.map((_, j) => (j === i ? v : cur[j]));
                onChange(next.every((x) => x === undefined) ? undefined : next);
              }}
            />
          ))}
        </div>
      );
    }
    case "object":
      return (
        <ObjectFields schema={s} value={(value as Obj | undefined) ?? {}} onChange={(v) => onChange(v)} root={root} />
      );
    case "records":
      return <RecordsEditor schema={s} value={value} onChange={onChange} root={root} />;
    case "map":
      return <MapEditor schema={s} value={value} onChange={onChange} root={root} />;
    default:
      return <JsonInput value={value} onChange={onChange} />;
  }
}

// ---- objects, record lists, maps ------------------------------------------------------------

function Label({ name, raw, s, required }: { name: string; raw: JsonSchema; s: JsonSchema; required: boolean }) {
  const desc = raw.description ?? s.description;
  return (
    <span className="field-label">
      {fieldLabel(name)}
      {required && <span className="req"> *</span>}
      {desc && <span className="sf-desc"> — {desc}</span>}
    </span>
  );
}

export function ObjectFields({
  schema,
  value,
  onChange,
  root,
}: {
  schema: JsonSchema;
  value: Obj;
  onChange: (v: Obj) => void;
  root: JsonSchema;
}) {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const set = (k: string, v: Json) => {
    const next = { ...value };
    if (v === undefined) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  const entries = Object.entries(props).map(([k, raw]) => {
    const { schema: s, optional } = unwrapOptional(raw, root);
    return { k, raw, s, optional, kind: kindOf(s, root) };
  });
  const simple = entries.filter((e) => SCALAR.includes(e.kind) || e.kind === "tuple" || e.kind === "json");
  const complex = entries.filter((e) => !simple.includes(e));
  return (
    <div className="stack">
      {simple.length > 0 && (
        <div className="sf-grid">
          {simple.map(({ k, raw, s, optional }) => (
            <label className="field" key={k}>
              <Label name={k} raw={raw} s={s} required={required.has(k) && !optional} />
              <ValueInput schema={s} value={value[k]} onChange={(v) => set(k, v)} root={root} />
            </label>
          ))}
        </div>
      )}
      {complex.map(({ k, raw, s, optional }) => (
        <div className="sf-group" key={k}>
          <div className="sf-group-head">
            <Label name={k} raw={raw} s={s} required={required.has(k) && !optional} />
          </div>
          <ValueInput schema={s} value={value[k]} onChange={(v) => set(k, v)} root={root} />
        </div>
      ))}
    </div>
  );
}

function RecordsEditor({
  schema,
  value,
  onChange,
  root,
}: {
  schema: JsonSchema;
  value: Json;
  onChange: (v: Json) => void;
  root: JsonSchema;
}) {
  const item = resolve(unwrapOptional(schema.items!, root).schema, root);
  const rows = Array.isArray(value) ? (value as Obj[]) : [];
  const props = Object.entries(item.properties ?? {}).map(([k, raw]) => {
    const { schema: s, optional } = unwrapOptional(raw, root);
    return { k, raw, s, optional, kind: kindOf(s, root) };
  });
  const required = new Set(item.required ?? []);
  const flat = props.every((p) => SCALAR.includes(p.kind) && p.kind !== "multi-enum");
  const update = (i: number, row: Obj) => onChange(rows.map((r, j) => (j === i ? row : r)));
  const remove = (i: number) => {
    const next = rows.filter((_, j) => j !== i);
    onChange(next.length ? next : undefined);
  };
  const add = () => onChange([...rows, {}]);
  return (
    <div>
      {rows.length === 0 && <div className="muted small">None yet.</div>}
      {flat && rows.length > 0 ? (
        <div className="table-wrap">
          <table className="compact sf-table">
            <thead>
              <tr>
                {props.map(({ k, raw, s, optional }) => (
                  <th key={k} title={raw.description ?? s.description}>
                    {fieldLabel(k)}
                    {required.has(k) && !optional && <span className="req"> *</span>}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {props.map(({ k, s }) => (
                    <td key={k}>
                      <ValueInput schema={s} value={r[k]} root={root} onChange={(v) => update(i, setKey(r, k, v))} />
                    </td>
                  ))}
                  <td>
                    <button
                      className="icon-btn danger"
                      title="Remove row"
                      aria-label="Remove row"
                      onClick={() => remove(i)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="sf-rows">
          {rows.map((r, i) => (
            <div className="sf-row" key={i}>
              <div className="sf-row-head">
                <span>
                  {itemLabel(item.title).replace(/^./, (c) => c.toUpperCase())} {i + 1}
                </span>
                <button className="small danger" onClick={() => remove(i)}>
                  Remove
                </button>
              </div>
              <ObjectFields schema={item} value={r} root={root} onChange={(v) => update(i, v)} />
            </div>
          ))}
        </div>
      )}
      <button className="small" style={{ marginTop: 8 }} onClick={add}>
        + Add {itemLabel(item.title)}
      </button>
    </div>
  );
}

function setKey(o: Obj, k: string, v: Json): Obj {
  const next = { ...o };
  if (v === undefined) delete next[k];
  else next[k] = v;
  return next;
}

function MapEditor({
  schema,
  value,
  onChange,
  root,
}: {
  schema: JsonSchema;
  value: Json;
  onChange: (v: Json) => void;
  root: JsonSchema;
}) {
  const valueSchema = resolve(unwrapOptional(schema.additionalProperties as JsonSchema, root).schema, root);
  // keep row order and allow a key being typed to be empty for a moment
  const [rows, setRows] = useState<[string, Json][]>(() => Object.entries((value as Obj | undefined) ?? {}));
  const emit = (next: [string, Json][]) => {
    setRows(next);
    const out: Obj = {};
    for (const [k, v] of next) if (k.trim()) out[k.trim()] = v;
    onChange(Object.keys(out).length ? out : undefined);
  };
  const complexValue = !SCALAR.includes(kindOf(valueSchema, root));
  return (
    <div className="stack">
      {rows.length === 0 && <div className="muted small">None yet.</div>}
      {rows.map(([k, v], i) =>
        complexValue ? (
          <div className="sf-row" key={i}>
            <div className="sf-row-head">
              <input
                style={{ maxWidth: 260 }}
                placeholder="name *"
                value={k}
                onChange={(e) => emit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
              />
              <button className="small danger" onClick={() => emit(rows.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
            <ValueInput
              schema={valueSchema}
              value={v}
              root={root}
              onChange={(nv) => emit(rows.map((r, j) => (j === i ? [r[0], nv] : r)))}
            />
          </div>
        ) : (
          <div className="sf-map-row" key={i}>
            <input
              placeholder="name *"
              value={k}
              onChange={(e) => emit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
            />
            <ValueInput
              schema={valueSchema}
              value={v}
              root={root}
              onChange={(nv) => emit(rows.map((r, j) => (j === i ? [r[0], nv] : r)))}
            />
            <button
              className="icon-btn danger"
              aria-label="Remove"
              onClick={() => emit(rows.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ),
      )}
      <div>
        <button className="small" onClick={() => emit([...rows, ["", undefined]])}>
          + Add entry
        </button>
      </div>
    </div>
  );
}

// ---- the form ---------------------------------------------------------------------------------

/** Drop what the user left empty, so the backend decides what is missing. */
export function prune(v: Json): Json {
  if (v === undefined || v === null || v === "") return undefined;
  if (Array.isArray(v)) {
    const xs = v.map(prune).filter((x) => x !== undefined);
    return xs.length ? xs : undefined;
  }
  if (typeof v === "object") {
    const out: Obj = {};
    for (const [k, x] of Object.entries(v as Obj)) {
      const p = prune(x);
      if (p !== undefined) out[k] = p;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return v;
}

export function SchemaFields({
  schema,
  value,
  onChange,
}: {
  schema: JsonSchema;
  value: Obj;
  onChange: (v: Obj) => void;
}) {
  return <ObjectFields schema={schema} value={value} onChange={onChange} root={schema} />;
}

export function SchemaForm({
  schema,
  initial,
  onSubmit,
  submitLabel,
  busy,
}: {
  schema: JsonSchema;
  initial: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => void;
  submitLabel: string;
  busy?: boolean;
}) {
  const [value, setValue] = useState<Obj>(() => structuredClone(initial ?? {}));
  return (
    <div className="schema-form">
      <SchemaFields schema={schema} value={value} onChange={setValue} />
      <div className="row-end">
        <button className="primary" onClick={() => onSubmit((prune(value) as Obj | undefined) ?? {})} disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
