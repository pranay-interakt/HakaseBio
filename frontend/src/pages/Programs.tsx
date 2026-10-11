import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorBox, Section } from "../components/common";
import type { Program } from "../types";

const MODALITIES = [
  "small_molecule",
  "peptide",
  "oligonucleotide",
  "monoclonal_antibody",
  "recombinant_protein",
  "antibody_drug_conjugate",
  "cell_therapy",
  "gene_therapy",
  "vaccine",
];
const INDICATIONS = [
  "chronic_non_oncology",
  "acute_non_oncology",
  "advanced_cancer",
  "oncology_non_advanced",
  "life_threatening_non_oncology",
  "rare_genetic",
];
const ROUTES = [
  "oral",
  "intravenous",
  "subcutaneous",
  "intramuscular",
  "topical_dermal",
  "inhalation",
  "intrathecal",
  "intravitreal",
  "other_parenteral",
];
const POPULATIONS = [
  "healthy_volunteers",
  "patients",
  "women_of_childbearing_potential",
  "pregnant_women",
  "pediatric",
];

type Tri = "" | "true" | "false";

export function Programs({ go }: { go: (hash: string) => void }) {
  const [list, setList] = useState<{ id: string; name: string; sponsor: string | null; created_at: string }[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [name, setName] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [modality, setModality] = useState("small_molecule");
  const [indication, setIndication] = useState("chronic_non_oncology");
  const [route, setRoute] = useState("oral");
  const [intended, setIntended] = useState("");
  const [trial, setTrial] = useState("");
  const [pops, setPops] = useState<string[]>(["healthy_volunteers"]);
  const [marketing, setMarketing] = useState(false);
  const [mec, setMec] = useState<Tri>("");
  const [species, setSpecies] = useState("");
  const [agonist, setAgonist] = useState(false);
  const [pediatric, setPediatric] = useState(false);

  useEffect(() => {
    api.get<typeof list>("/programs").then(setList).catch(setErr);
  }, []);

  async function create() {
    try {
      const p = await api.post<Program>("/programs", {
        name,
        sponsor: sponsor || null,
        context: {
          modality,
          indication,
          route,
          intended_clinical_duration_days: Number(intended),
          max_trial_duration_days: Number(trial),
          populations: pops,
          supports_marketing: marketing,
          molar_extinction_coefficient_ge_1000: mec === "" ? null : mec === "true",
          pharmacologically_relevant_species: species
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          is_immunomodulatory_agonist: agonist,
          intended_pediatric_use: pediatric,
        },
      });
      go(`#/program/${p.id}`);
    } catch (e) {
      setErr(e);
    }
  }

  return (
    <div className="page">
      <h2>Programmes</h2>
      <ErrorBox error={err} />
      <Section title="Your programmes">
        {list.length === 0 && <p className="muted">No programmes yet.</p>}
        <ul className="list">
          {list.map((p) => (
            <li key={p.id}>
              <a href={`#/program/${p.id}`}>{p.name}</a> <span className="muted">{p.sponsor ?? ""}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="New programme">
        <p className="muted small">
          These facts drive the study set derived from ICH M3(R2), S6(R1), S9 and related guidelines. Leave
          unknown facts unknown: the affected requirements are shown as conditional rather than guessed.
        </p>
        <div className="grid2">
          <div className="field">
            <label className="field-label">Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Sponsor</label>
            <input value={sponsor} onChange={(e) => setSponsor(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Modality *</label>
            <select value={modality} onChange={(e) => setModality(e.target.value)}>
              {MODALITIES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Indication *</label>
            <select value={indication} onChange={(e) => setIndication(e.target.value)}>
              {INDICATIONS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Clinical route *</label>
            <select value={route} onChange={(e) => setRoute(e.target.value)}>
              {ROUTES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Intended clinical treatment duration (days) *</label>
            <input type="number" value={intended} onChange={(e) => setIntended(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Longest dosing in the planned trial (days) *</label>
            <input type="number" value={trial} onChange={(e) => setTrial(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Absorbs 290–700 nm with MEC &gt; 1000 L/mol/cm (ICH S10)</label>
            <select value={mec} onChange={(e) => setMec(e.target.value as Tri)}>
              <option value="">unknown</option>
              <option value="true">yes</option>
              <option value="false">no</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Pharmacologically relevant species (biologics)</label>
            <input
              placeholder="e.g. cynomolgus monkey"
              value={species}
              onChange={(e) => setSpecies(e.target.value)}
            />
          </div>
        </div>
        <div className="checks">
          {POPULATIONS.map((p) => (
            <label key={p}>
              <input
                type="checkbox"
                checked={pops.includes(p)}
                onChange={(e) => setPops(e.target.checked ? [...pops, p] : pops.filter((x) => x !== p))}
              />{" "}
              {p}
            </label>
          ))}
          <label>
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> also
            support marketing (M3(R2) Table 2)
          </label>
          <label>
            <input type="checkbox" checked={agonist} onChange={(e) => setAgonist(e.target.checked)} /> immune
            agonist
          </label>
          <label>
            <input type="checkbox" checked={pediatric} onChange={(e) => setPediatric(e.target.checked)} />{" "}
            paediatric use intended
          </label>
        </div>
        <button className="primary" onClick={create}>
          Create programme and derive study set
        </button>
      </Section>
    </div>
  );
}
