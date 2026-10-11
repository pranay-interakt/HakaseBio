import { useState } from "react";
import type { JsonSchema } from "../types";

// Renders a form from a driver's pydantic JSON schema. Values the user does not enter are
// omitted, so the backend's validation (not the browser) decides what is missing.

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

function kindOf(s: JsonSchema): string {
  if (s.enum) return "enum";
  if (s.type === "array") {
    const it = s.items ?? {};
    if (it.enum) return "multi-enum";
    if (it.type === "number" || it.type === "integer") return "number-list";
    if (it.type === "string") return "string-list";
    return "json";
  }
  if (s.type === "object" || s.properties) return "json";
  return s.type ?? "json";
}

function typeLabel(s: JsonSchema, root: JsonSchema): string {
  const { schema: r, optional } = unwrapOptional(s, root);
  const base = r.enum
    ? r.enum.join(" | ")
    : r.type === "array"
      ? `list of ${r.items ? typeLabel(r.items, root) : "values"}`
      : r.properties
        ? "object"
        : (r.type ?? "value");
  return optional ? `${base}, optional` : base;
}

/** The keys a JSON field expects, read from the schema, so nested lists are not guesswork. */
export function StructureHint({ s, root }: { s: JsonSchema; root: JsonSchema }) {
  const target = resolve(s.type === "array" && s.items ? s.items : s, root);
  if (!target.properties) return null;
  const req = new Set(target.required ?? []);
  return (
    <details className="small">
      <summary className="muted">
        Expected structure: {s.type === "array" ? "a list of objects" : "an object"} with these keys
      </summary>
      <ul className="list">
        {Object.entries(target.properties).map(([key, ps]) => (
          <li key={key}>
            <code>{key}</code>
            {req.has(key) && <span className="req"> *</span>} <span className="muted">({typeLabel(ps, root)})</span>
            {ps.description && <> — {ps.description}</>}
          </li>
        ))}
      </ul>
    </details>
  );
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
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const [vals, setVals] = useState<Record<string, unknown>>(initial);
  const [text, setText] = useState<Record<string, string>>(() => {
    const t: Record<string, string> = {};
    for (const [k, raw] of Object.entries(props)) {
      const { schema: s } = unwrapOptional(raw, schema);
      const v = initial[k];
      const kind = kindOf(resolve(s, schema));
      if (v === undefined || v === null) continue;
      if (kind === "number-list" || kind === "string-list") t[k] = (v as unknown[]).join(", ");
      else if (kind === "json") t[k] = JSON.stringify(v, null, 2);
    }
    return t;
  });
  const [err, setErr] = useState<string | null>(null);

  const set = (k: string, v: unknown) => setVals((o) => ({ ...o, [k]: v }));

  function submit() {
    const out: Record<string, unknown> = {};
    try {
      for (const [k, raw] of Object.entries(props)) {
        const { schema: s } = unwrapOptional(raw, schema);
        const kind = kindOf(s);
        if (kind === "number-list" || kind === "string-list") {
          const t = (text[k] ?? "").trim();
          if (!t) continue;
          const parts = t.split(",").map((x) => x.trim()).filter(Boolean);
          out[k] = kind === "number-list" ? parts.map(Number) : parts;
        } else if (kind === "json") {
          const t = (text[k] ?? "").trim();
          if (!t) continue;
          out[k] = JSON.parse(t);
        } else if (vals[k] !== undefined && vals[k] !== "") {
          out[k] = vals[k];
        }
      }
    } catch (e) {
      setErr(`Could not read a structured field: ${(e as Error).message}`);
      return;
    }
    setErr(null);
    onSubmit(out);
  }

  return (
    <div className="schema-form">
      {Object.entries(props).map(([k, raw]) => {
        const { schema: s, optional } = unwrapOptional(raw, schema);
        const kind = kindOf(s);
        const label = (
          <label className="field-label">
            {raw.title ?? s.title ?? k}
            {required.has(k) && !optional && <span className="req"> *</span>}
            {(raw.description ?? s.description) && (
              <span className="muted small"> — {raw.description ?? s.description}</span>
            )}
          </label>
        );
        let input;
        if (kind === "enum") {
          input = (
            <select value={String(vals[k] ?? "")} onChange={(e) => set(k, e.target.value || undefined)}>
              <option value="">—</option>
              {s.enum!.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          );
        } else if (kind === "multi-enum") {
          const cur = new Set((vals[k] as string[] | undefined) ?? []);
          input = (
            <div className="checks">
              {s.items!.enum!.map((o) => (
                <label key={o}>
                  <input
                    type="checkbox"
                    checked={cur.has(o)}
                    onChange={(e) => {
                      const n = new Set(cur);
                      if (e.target.checked) n.add(o);
                      else n.delete(o);
                      set(k, s.items!.enum!.filter((x) => n.has(x)));
                    }}
                  />{" "}
                  {o}
                </label>
              ))}
            </div>
          );
        } else if (kind === "boolean") {
          input = (
            <select
              value={vals[k] === undefined ? "" : String(vals[k])}
              onChange={(e) => set(k, e.target.value === "" ? undefined : e.target.value === "true")}
            >
              <option value="">—</option>
              <option value="true">yes</option>
              <option value="false">no</option>
            </select>
          );
        } else if (kind === "number" || kind === "integer") {
          input = (
            <input
              type="number"
              step="any"
              value={vals[k] === undefined || vals[k] === null ? "" : String(vals[k])}
              onChange={(e) => set(k, e.target.value === "" ? undefined : Number(e.target.value))}
            />
          );
        } else if (kind === "number-list" || kind === "string-list") {
          input = (
            <input
              placeholder="comma-separated"
              value={text[k] ?? ""}
              onChange={(e) => setText((t) => ({ ...t, [k]: e.target.value }))}
            />
          );
        } else if (kind === "json") {
          input = (
            <>
              <textarea
                rows={4}
                placeholder="JSON"
                value={text[k] ?? ""}
                onChange={(e) => setText((t) => ({ ...t, [k]: e.target.value }))}
              />
              <StructureHint s={s} root={schema} />
            </>
          );
        } else {
          input = (
            <input value={String(vals[k] ?? "")} onChange={(e) => set(k, e.target.value || undefined)} />
          );
        }
        return (
          <div className="field" key={k}>
            {label}
            {input}
          </div>
        );
      })}
      {err && <div className="error">{err}</div>}
      <button className="primary" onClick={submit} disabled={busy}>
        {submitLabel}
      </button>
    </div>
  );
}
