// The programme facts that drive the derived study set, as a form. Used to create a programme
// and for what-if comparisons; unknown facts stay unknown (the engine shows the affected
// requirements as conditional instead of guessing).
import type { ReactNode } from "react";
import { INDICATIONS, MODALITIES, POPULATIONS, ROUTES } from "../lib/format";

export type Ctx = Record<string, unknown>;

export const AMINO_ACID = ["peptide", "recombinant_protein", "monoclonal_antibody"];

export function emptyContext(): Ctx {
  return {
    modality: "small_molecule",
    indication: "chronic_non_oncology",
    route: "oral",
    intended_clinical_duration_days: null,
    max_trial_duration_days: null,
    populations: ["healthy_volunteers"],
    supports_marketing: false,
    molar_extinction_coefficient_ge_1000: null,
    pharmacologically_relevant_species: [],
    is_immunomodulatory_agonist: false,
    intended_pediatric_use: false,
    peptide_origin: null,
    amino_acid_chains: [],
    chains_naturally_associated: null,
  };
}

/** The context as the API takes it: facts that do not apply to the modality are cleared. */
export function cleanContext(c: Ctx): Ctx {
  const aa = AMINO_ACID.includes(String(c.modality));
  const chains = (c.amino_acid_chains as number[] | undefined) ?? [];
  return {
    ...c,
    peptide_origin: c.modality === "peptide" ? (c.peptide_origin ?? null) : null,
    amino_acid_chains: aa ? chains : [],
    chains_naturally_associated: aa && chains.length > 1 ? (c.chains_naturally_associated ?? null) : null,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function Field({
  label,
  help,
  changed,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  changed?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label} {changed && <span className="pill pill-accent">changed</span>}
      </span>
      {children}
      {help && <span className="field-help">{help}</span>}
    </label>
  );
}

function Tri({ value, onChange }: { value: unknown; onChange: (v: boolean | null) => void }) {
  return (
    <select
      value={value === null || value === undefined ? "" : String(value)}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}
    >
      <option value="">Unknown</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>
  );
}

function Options({ map }: { map: Record<string, string> }) {
  return (
    <>
      {Object.entries(map).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </>
  );
}

export function ContextForm({
  value,
  onChange,
  compareTo,
}: {
  value: Ctx;
  onChange: (c: Ctx) => void;
  compareTo?: Ctx;
}) {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  const changed = (k: string) => compareTo !== undefined && !same(value[k], compareTo[k]);
  const modality = String(value.modality);
  const aa = AMINO_ACID.includes(modality);
  const chains = (value.amino_acid_chains as number[] | undefined) ?? [];
  const pops = (value.populations as string[] | undefined) ?? [];
  const num = (k: string) => (
    <input
      type="number"
      min={1}
      value={value[k] === null || value[k] === undefined ? "" : String(value[k])}
      onChange={(e) => set(k, e.target.value === "" ? null : Number(e.target.value))}
    />
  );
  return (
    <div className="stack">
      <div className="grid3">
        <Field label="Modality *" changed={changed("modality")}>
          <select value={modality} onChange={(e) => set("modality", e.target.value)}>
            <Options map={MODALITIES} />
          </select>
        </Field>
        <Field label="Indication *" changed={changed("indication")}>
          <select value={String(value.indication)} onChange={(e) => set("indication", e.target.value)}>
            <Options map={INDICATIONS} />
          </select>
        </Field>
        <Field label="Clinical route *" changed={changed("route")}>
          <select value={String(value.route)} onChange={(e) => set("route", e.target.value)}>
            <Options map={ROUTES} />
          </select>
        </Field>
        <Field
          label="Treatment duration (days) *"
          help="How long patients will take the drug once approved"
          changed={changed("intended_clinical_duration_days")}
        >
          {num("intended_clinical_duration_days")}
        </Field>
        <Field
          label="Longest trial dosing (days) *"
          help="Sets repeat-dose study durations (ICH M3(R2) Table 1)"
          changed={changed("max_trial_duration_days")}
        >
          {num("max_trial_duration_days")}
        </Field>
        <Field
          label="Absorbs light (ICH S10)"
          help="MEC above 1000 L/mol/cm between 290 and 700 nm; decides phototoxicity testing"
          changed={changed("molar_extinction_coefficient_ge_1000")}
        >
          <Tri
            value={value.molar_extinction_coefficient_ge_1000}
            onChange={(v) => set("molar_extinction_coefficient_ge_1000", v)}
          />
        </Field>
        {modality === "peptide" && (
          <Field
            label="Peptide origin"
            help="ICH S6(R1) section 1.3 scopes peptides by origin"
            changed={changed("peptide_origin")}
          >
            <select
              value={String(value.peptide_origin ?? "")}
              onChange={(e) => set("peptide_origin", e.target.value || null)}
            >
              <option value="">Unknown</option>
              <option value="chemical_synthesis">Chemical synthesis</option>
              <option value="recombinant">Recombinant expression</option>
            </select>
          </Field>
        )}
        {aa && (
          <Field
            label="Amino acids per chain"
            help="e.g. 31, or 21, 30 for two chains (21 CFR 600.3(h)(6))"
            changed={changed("amino_acid_chains")}
          >
            <input
              defaultValue={chains.join(", ")}
              onChange={(e) =>
                set(
                  "amino_acid_chains",
                  e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .map(Number)
                    .filter((n) => Number.isFinite(n)),
                )
              }
            />
          </Field>
        )}
        {aa && chains.length > 1 && (
          <Field label="Chains associated as in nature" changed={changed("chains_naturally_associated")}>
            <Tri value={value.chains_naturally_associated} onChange={(v) => set("chains_naturally_associated", v)} />
          </Field>
        )}
        {modality === "gene_therapy" && (
          <Field label="Integrating vector" changed={changed("is_integrating_vector")}>
            <Tri value={value.is_integrating_vector} onChange={(v) => set("is_integrating_vector", v)} />
          </Field>
        )}
        <Field
          label="Pharmacologically relevant species"
          help="Biologics: comma-separated, e.g. cynomolgus monkey"
          changed={changed("pharmacologically_relevant_species")}
        >
          <input
            defaultValue={((value.pharmacologically_relevant_species as string[] | undefined) ?? []).join(", ")}
            onChange={(e) =>
              set(
                "pharmacologically_relevant_species",
                e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              )
            }
          />
        </Field>
      </div>
      <div>
        <div className="field-label">
          Clinical populations {changed("populations") && <span className="pill pill-accent">changed</span>}
        </div>
        <div className="checks">
          {Object.entries(POPULATIONS).map(([p, l]) => (
            <label key={p}>
              <input
                type="checkbox"
                checked={pops.includes(p)}
                onChange={(e) => set("populations", e.target.checked ? [...pops, p] : pops.filter((x) => x !== p))}
              />
              {l}
            </label>
          ))}
        </div>
      </div>
      <div className="checks">
        {(
          [
            ["supports_marketing", "Also support marketing (ICH M3(R2) Table 2)"],
            ["is_immunomodulatory_agonist", "Immune agonist"],
            ["intended_pediatric_use", "Paediatric use intended"],
          ] as const
        ).map(([k, l]) => (
          <label key={k}>
            <input type="checkbox" checked={Boolean(value[k])} onChange={(e) => set(k, e.target.checked)} />
            {l} {changed(k) && <span className="pill pill-accent">changed</span>}
          </label>
        ))}
      </div>
    </div>
  );
}
