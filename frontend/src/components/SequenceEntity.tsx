// Peptides and antibodies registered by sequence or HELM (docs/14 P4). The backend validates
// every rule and computes every derived value; this form only gathers the registered facts.
import { useState } from "react";
import { api } from "../api";
import { humanize } from "../lib/format";
import type {
  Compound,
  EngineeredMutation,
  Program,
  SequenceChain,
  SequenceEntityRecord,
  SequenceEntitySpec,
} from "../types";
import { Citations, Section } from "./common";
import { QuantityView } from "./QuantityView";

const ROLES: SequenceChain["role"][] = ["peptide", "heavy_chain", "light_chain", "other"];

export function SequenceRegistration({
  p,
  reload,
  onErr,
}: {
  p: Program;
  reload: () => void;
  onErr: (e: unknown) => void;
}) {
  const antibody = p.context.modality === "monoclonal_antibody";
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"sequence" | "helm">("sequence");
  const [fasta, setFasta] = useState("");
  const [fastaErrors, setFastaErrors] = useState<string[]>([]);
  const [chains, setChains] = useState<SequenceChain[]>([]);
  const [helm, setHelm] = useState("");
  const [helmCheck, setHelmCheck] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [lib, setLib] = useState({ name: "", version: "", sha256: "" });
  const [isotype, setIsotype] = useState("");
  const [lct, setLct] = useState("");
  const [mutations, setMutations] = useState<EngineeredMutation[]>([]);
  const [surrogate, setSurrogate] = useState("");
  const [rationale, setRationale] = useState("");

  async function parse() {
    try {
      const r = await api.post<{ records: { description: string; sequence: string }[]; errors: string[] }>(
        "/sequence/fasta",
        { text: fasta },
      );
      setFastaErrors(r.errors);
      setChains(
        r.records.map((rec) => ({
          name: rec.description,
          role: antibody ? (/light/i.test(rec.description) ? "light_chain" : "heavy_chain") : "peptide",
          sequence: rec.sequence,
          copies: 1,
        })),
      );
    } catch (e) {
      onErr(e);
    }
  }
  async function checkHelm() {
    try {
      const r = await api.post<{
        structure: { polymers: { id: string; monomers: number }[]; warnings: string[] } | null;
        errors: string[];
      }>("/sequence/helm", { text: helm });
      setHelmCheck(
        r.structure
          ? {
              ok: true,
              lines: [
                r.structure.polymers.map((x) => `${x.id}: ${x.monomers} monomers`).join("; "),
                ...r.structure.warnings,
              ],
            }
          : { ok: false, lines: r.errors },
      );
    } catch (e) {
      onErr(e);
    }
  }
  async function register() {
    const entity: SequenceEntitySpec = {
      format,
      chains: format === "sequence" ? chains : [],
      helm: format === "helm" ? helm : null,
      monomer_library: format === "helm" ? lib : null,
      isotype: antibody && isotype ? isotype : null,
      light_chain_type: antibody && lct ? (lct as "kappa" | "lambda") : null,
      engineered_mutations: format === "sequence" ? mutations : [],
      surrogate_for: surrogate || null,
      surrogate_rationale: surrogate ? rationale : null,
    };
    try {
      await api.post(`/programs/${p.id}/biologics`, { name, entity });
      setName("");
      setFasta("");
      setChains([]);
      setHelm("");
      setMutations([]);
      reload();
    } catch (e) {
      onErr(e);
    }
  }
  const putChain = (i: number, c: SequenceChain) => setChains(chains.map((x, j) => (j === i ? c : x)));
  const putMut = (i: number, m: EngineeredMutation) => setMutations(mutations.map((x, j) => (j === i ? m : x)));
  return (
    <Section title={`Register ${antibody ? "antibody" : "peptide"} by sequence`}>
      <div className="grid2">
        <label className="field">
          <span className="field-label">Name *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as "sequence" | "helm")}>
            <option value="sequence">one-letter sequence (FASTA)</option>
            <option value="helm">HELM 2.04 (non-natural chemistry)</option>
          </select>
        </label>
      </div>
      {format === "sequence" ? (
        <>
          <label className="field">
            <span className="field-label">FASTA (one record per chain; upper-case one-letter codes)</span>
            <textarea
              rows={5}
              value={fasta}
              onChange={(e) => setFasta(e.target.value)}
              placeholder={antibody ? ">heavy chain\nQVQL...\n>light chain\nDIQM..." : ">peptide\nHAEG..."}
            />
          </label>
          <button onClick={parse} disabled={!fasta.trim()}>
            Read chains
          </button>
          {fastaErrors.length > 0 && (
            <div className="error">
              <ul>
                {fastaErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {chains.length > 0 && (
            <table className="small">
              <thead>
                <tr>
                  <th>Chain</th>
                  <th>Role</th>
                  <th>Copies per molecule</th>
                  <th>Residues</th>
                </tr>
              </thead>
              <tbody>
                {chains.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <input value={c.name} onChange={(e) => putChain(i, { ...c, name: e.target.value })} />
                    </td>
                    <td>
                      <select
                        value={c.role}
                        onChange={(e) => putChain(i, { ...c, role: e.target.value as SequenceChain["role"] })}
                      >
                        {ROLES.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={c.copies}
                        onChange={(e) => putChain(i, { ...c, copies: Number(e.target.value) })}
                      />
                    </td>
                    <td>{c.sequence.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h4>Engineered mutations</h4>
          <p className="muted small">
            Position counts residues from 1 in the chain as registered; the registered chain must carry the engineered
            residue. Keep your own notation (e.g. EU numbering) in the label; it is not converted.
          </p>
          {mutations.map((m, i) => (
            <div className="row" key={i} style={{ marginBottom: 4 }}>
              <select
                style={{ width: 140 }}
                value={m.chain}
                onChange={(e) => putMut(i, { ...m, chain: e.target.value })}
              >
                <option value="">chain…</option>
                {chains.map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </select>
              <input
                style={{ width: 80 }}
                type="number"
                min="1"
                placeholder="position"
                value={m.position || ""}
                onChange={(e) => putMut(i, { ...m, position: Number(e.target.value) })}
              />
              <input
                style={{ width: 60 }}
                maxLength={1}
                placeholder="from"
                value={m.from_residue}
                onChange={(e) => putMut(i, { ...m, from_residue: e.target.value.toUpperCase() })}
              />
              <input
                style={{ width: 60 }}
                maxLength={1}
                placeholder="to"
                value={m.to_residue}
                onChange={(e) => putMut(i, { ...m, to_residue: e.target.value.toUpperCase() })}
              />
              <input
                style={{ flex: 1 }}
                placeholder="purpose *"
                value={m.purpose}
                onChange={(e) => putMut(i, { ...m, purpose: e.target.value })}
              />
              <input
                style={{ width: 160 }}
                placeholder="label (optional)"
                value={m.label ?? ""}
                onChange={(e) => putMut(i, { ...m, label: e.target.value || null })}
              />
              <button onClick={() => setMutations(mutations.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button
            onClick={() =>
              setMutations([...mutations, { chain: "", position: 0, from_residue: "", to_residue: "", purpose: "" }])
            }
          >
            Add mutation
          </button>
        </>
      ) : (
        <>
          <label className="field">
            <span className="field-label">HELM string</span>
            <textarea
              rows={3}
              value={helm}
              onChange={(e) => setHelm(e.target.value)}
              placeholder="PEPTIDE1{H.[Aib].E.G}$$$$"
            />
          </label>
          <button onClick={checkHelm} disabled={!helm.trim()}>
            Check HELM
          </button>
          {helmCheck && (
            <div className={helmCheck.ok ? "note small" : "error"}>
              <ul>
                {helmCheck.lines.filter(Boolean).map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="muted small">
            A HELM string is resolved by its monomer library (HELM 2.04, 5.1), so the library is recorded with it.
          </p>
          <div className="grid2">
            {(["name", "version", "sha256"] as const).map((k) => (
              <label className="field" key={k}>
                <span className="field-label">Monomer library {k} *</span>
                <input value={lib[k]} onChange={(e) => setLib({ ...lib, [k]: e.target.value })} />
              </label>
            ))}
          </div>
        </>
      )}
      <div className="grid2">
        {antibody && (
          <>
            <label className="field">
              <span className="field-label">Isotype</span>
              <input placeholder="e.g. IgG1" value={isotype} onChange={(e) => setIsotype(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Light-chain type</span>
              <select value={lct} onChange={(e) => setLct(e.target.value)}>
                <option value="">—</option>
                <option value="kappa">kappa</option>
                <option value="lambda">lambda</option>
              </select>
            </label>
          </>
        )}
        <label className="field">
          <span className="field-label">Surrogate for (clinical candidate)</span>
          <select value={surrogate} onChange={(e) => setSurrogate(e.target.value)}>
            <option value="">not a surrogate</option>
            {p.compounds.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {surrogate && (
          <label className="field">
            <span className="field-label">Why a surrogate *</span>
            <input
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="e.g. the candidate does not bind the rat target"
            />
          </label>
        )}
      </div>
      <button className="primary" disabled={!name.trim()} onClick={register}>
        Register sequence entity
      </button>
    </Section>
  );
}

export function SequenceEntityView({
  c,
  p,
  reload,
  onErr,
}: {
  c: Compound;
  p: Program;
  reload: () => void;
  onErr: (e: unknown) => void;
}) {
  const e = c.entity as SequenceEntityRecord;
  const d = e.derived;
  const s = e.spec;
  const target = s.surrogate_for ? p.compounds.find((x) => x.id === s.surrogate_for) : null;
  const [reason, setReason] = useState("");
  async function useForClassification() {
    try {
      await api.patch(`/programs/${p.id}/context`, { changes: { amino_acid_chains: d.amino_acid_chains }, reason });
      setReason("");
      reload();
    } catch (err) {
      onErr(err);
    }
  }
  const inContext = JSON.stringify(p.context.amino_acid_chains ?? []) === JSON.stringify(d.amino_acid_chains);
  return (
    <Section title={c.name} right={<span className="tag">{s.format === "helm" ? "HELM" : "sequence"}</span>}>
      <div className="small">
        {s.isotype && <>isotype {s.isotype} · </>}
        {s.light_chain_type && <>{s.light_chain_type} light chain · </>}
        fingerprint <code>{e.fingerprint.slice(0, 12)}</code>
        {target && (
          <>
            {" "}
            · <strong>surrogate for {target.name}</strong>: {s.surrogate_rationale}
          </>
        )}
      </div>
      {d.chains.length > 0 && (
        <table className="small">
          <thead>
            <tr>
              <th>Chain</th>
              <th>Role</th>
              <th>Copies</th>
              <th>Residues</th>
              <th>Average mass</th>
            </tr>
          </thead>
          <tbody>
            {d.chains.map((ch) => (
              <tr key={ch.name}>
                <td>{ch.name}</td>
                <td>{humanize(ch.role)}</td>
                <td>{ch.copies}</td>
                <td>{ch.residues}</td>
                <td>
                  <QuantityView q={ch.average_mass} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.helm && (
        <div className="small">
          HELM {d.helm.version ?? "1.x"}: {d.helm.polymers.map((x) => `${x.id} (${x.monomers} monomers)`).join(", ")};{" "}
          {d.helm.connections} connections; monomers {d.helm.monomer_ids.join(", ")}; library {s.monomer_library?.name}{" "}
          {s.monomer_library?.version}
        </div>
      )}
      <div className="small">
        {d.total_mass.label}: <QuantityView q={d.total_mass} />
      </div>
      {s.engineered_mutations.length > 0 && (
        <>
          <h4>Engineered mutations</h4>
          <ul className="small">
            {s.engineered_mutations.map((m, i) => (
              <li key={i}>
                {m.chain} {m.from_residue}
                {m.position}
                {m.to_residue}
                {m.label && <> ({m.label})</>}: {m.purpose}
              </li>
            ))}
          </ul>
        </>
      )}
      {d.classification && (
        <div className="small">
          {d.classification.statement}
          <Citations list={d.classification.citations} />
          {p.context.modality === "peptide" &&
            (inContext ? (
              <span className="muted">These chain lengths are the programme's classification facts.</span>
            ) : (
              <div className="row">
                <input
                  style={{ flex: 1 }}
                  placeholder="reason (to use these chains for the programme's classification) *"
                  value={reason}
                  onChange={(ev) => setReason(ev.target.value)}
                />
                <button disabled={!reason.trim()} onClick={useForClassification}>
                  Use for 21 CFR 600.3(h)(6)
                </button>
              </div>
            ))}
        </div>
      )}
    </Section>
  );
}
