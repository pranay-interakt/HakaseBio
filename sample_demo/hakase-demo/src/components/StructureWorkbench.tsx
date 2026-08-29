/**
 * Structure workbench.
 *
 * A scratch copy of the screened structure that can be edited — by typing
 * SMILES, or by picking an atom in the depiction and changing, adding or
 * deleting it — with the consequences recomputed on every keystroke.
 *
 * Two rules hold the panel honest:
 *
 *  · Every number comes from `buildProfile`, the same engine the screen itself
 *    runs. The workbench derives nothing of its own; it re-runs the pipeline on
 *    a different structure.
 *  · The baseline is normalised through the writer before it is compared.
 *    `parseSmiles` perceives rings from the order it walks them, so a structure
 *    typed by hand and the same structure written back out can disagree on ring
 *    count with no atom having moved. Diffing normalised against normalised
 *    means a row only moves when the edit moved it.
 *
 * Nothing here touches the screened record. An edit is a proposal until it is
 * explicitly applied, which re-runs Layer 1 from the top.
 */
import { useMemo, useState } from "react";
import { FlaskConical, Play, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { parseSmiles } from "../lib/chem";
import { addAtom, deleteAtom, setElement, writeSmiles } from "../lib/smilesWrite";
import { buildProfile } from "../engine/profile";
import { num, tone } from "../lib/format";
import { MoleculeView } from "./Molecule";
import { SectionHeader } from "./ui";
import { t } from "../i18n";

/** Elements offered for a swap: the ones a medicinal chemist actually reaches for. */
const ELEMENTS = ["C", "N", "O", "S", "F", "Cl", "Br"];

/** Endpoints the Layer 1 gate can be driven by, so an edit's effect on the
    verdict is visible without leaving the panel. */
const GATE_ENDPOINTS = ["hERG", "DILI", "AMES", "Caco2_Wang", "Solubility_AqSolDB", "Bioavailability_Ma"];

type Row = { label: string; before: number; after: number; unit?: string; decimals?: number; higherIsBetter?: boolean };

function normalise(smiles: string): string {
  const parsed = parseSmiles(smiles);
  return parsed.valid ? writeSmiles(parsed) : smiles;
}

export function StructureWorkbench({ baselineSmiles, onApply }: {
  baselineSmiles: string;
  onApply: (smiles: string) => void;
}) {
  const [draft, setDraft] = useState(() => normalise(baselineSmiles));
  const [picked, setPicked] = useState<number | null>(null);

  const baseline = useMemo(() => buildProfile(normalise(baselineSmiles)), [baselineSmiles]);
  const parsed = useMemo(() => parseSmiles(draft), [draft]);
  const current = useMemo(() => (parsed.valid ? buildProfile(draft) : null), [draft, parsed.valid]);

  const edited = normalise(draft) !== normalise(baselineSmiles);

  function edit(next: string | null) {
    if (!next) return;
    setDraft(next);
    setPicked(null);
  }

  const descriptorRows: Row[] = current ? [
    { label: "Molecular weight", before: baseline.descriptors.molecular_weight_da, after: current.descriptors.molecular_weight_da, unit: "Da", decimals: 1 },
    { label: "cLogP", before: baseline.descriptors.logp, after: current.descriptors.logp, decimals: 2 },
    { label: "TPSA", before: baseline.descriptors.tpsa_a2, after: current.descriptors.tpsa_a2, unit: "Å²", decimals: 1 },
    { label: "H-bond donors", before: baseline.descriptors.h_bond_donors, after: current.descriptors.h_bond_donors, decimals: 0 },
    { label: "H-bond acceptors", before: baseline.descriptors.h_bond_acceptors, after: current.descriptors.h_bond_acceptors, decimals: 0 },
    { label: "Rotatable bonds", before: baseline.descriptors.rotatable_bonds, after: current.descriptors.rotatable_bonds, decimals: 0 },
    { label: "Aromatic rings", before: baseline.descriptors.aromatic_ring_count, after: current.descriptors.aromatic_ring_count, decimals: 0 },
    { label: "QED", before: baseline.descriptors.qed, after: current.descriptors.qed, decimals: 3, higherIsBetter: true },
  ] : [];

  return <section className="panel">
    <SectionHeader icon={<FlaskConical size={18} />} eyebrow={t("STRUCTURE WORKBENCH")} accent="l1"
      title={t("Modify the structure and see what moves")}
      description={t("A scratch copy of the screened structure. Type SMILES or pick an atom in the drawing; every property is recomputed by the same engine that ran the screen. Nothing here changes the record until it is applied.")} />

    <div className="bench-grid">
      <div>
        <MoleculeView molecule={parsed.valid ? parsed : baseline.molecule} height={260}
          onPickAtom={parsed.valid ? setPicked : undefined} selectedAtom={picked} />

        <div className="bench-smiles mt">
          <textarea value={draft} spellCheck={false} onChange={(event) => { setDraft(event.target.value); setPicked(null); }}
            className={parsed.valid ? "" : "is-invalid"} aria-label={t("SMILES string")} />
          {!parsed.valid && <p className="hint" style={{ color: "var(--bad-ink)" }}>
            <TriangleAlert size={14} /> {parsed.error ?? t("This structure could not be parsed.")}
          </p>}
        </div>

        {picked !== null && parsed.valid && <>
          <div className="sub-label">{t("Atom {n} — {element}", { n: picked + 1, element: parsed.atoms[picked]?.element ?? "?" })}</div>
          <div className="bench-tools">
            {ELEMENTS.map((element) => (
              <button key={element} className="pill" disabled={parsed.atoms[picked]?.element === element}
                onClick={() => edit(setElement(parsed, picked, element))}>{element}</button>
            ))}
          </div>
          <div className="bench-tools">
            {["C", "N", "O", "F"].map((element) => (
              <button key={element} className="pill" onClick={() => edit(addAtom(parsed, picked, element))}>
                {t("+ {element}", { element })}
              </button>
            ))}
            <button className="pill" disabled={(parsed.atoms[picked]?.neighbours.length ?? 0) > 1}
              onClick={() => edit(deleteAtom(parsed, picked))}>
              <Trash2 size={11} /> {t("Delete")}
            </button>
          </div>
          <p className="bench-hint">
            {(parsed.atoms[picked]?.neighbours.length ?? 0) > 1
              ? t("Only a terminal atom can be deleted — removing an interior one would split the structure into fragments you did not ask for.")
              : t("Swapping an element or adding a substituent rewrites the SMILES, which is then re-parsed from scratch.")}
          </p>
        </>}

        {picked === null && <p className="bench-hint">{t("Click any atom in the drawing to change it, add a substituent to it, or delete it.")}</p>}

        <div className="actions-row">
          <button className="btn" disabled={!edited} onClick={() => { setDraft(normalise(baselineSmiles)); setPicked(null); }}>
            <RotateCcw size={14} /> {t("Reset to screened structure")}
          </button>
          <button className="btn primary" disabled={!edited || !parsed.valid} onClick={() => onApply(draft)}>
            <Play size={14} /> {t("Run Layer 1 on this structure")}
          </button>
        </div>
      </div>

      <div>
        {current ? <>
          <div className="sub-label">{t("Physicochemistry")}</div>
          <DeltaTable rows={descriptorRows} />

          <div className="sub-label">{t("Gate-driving endpoints")}</div>
          <table className="delta-table">
            <thead><tr>
              <th>{t("Endpoint")}</th><th>{t("Screened")}</th><th>{t("Edited")}</th><th>{t("Band")}</th>
            </tr></thead>
            <tbody>
              {GATE_ENDPOINTS.map((key) => {
                const before = baseline.endpoints[key];
                const after = current.endpoints[key];
                if (!before || !after) return null;
                const moved = Math.abs(after.canonicalValue - before.canonicalValue) > 1e-6;
                const bandChanged = after.status !== before.status;
                return <tr key={key} className={moved ? "moved" : ""}>
                  <td>{t(after.title)}</td>
                  <td>{num(before.canonicalValue, 3)}</td>
                  <td className="now">{num(after.canonicalValue, 3)}</td>
                  <td>
                    <span className={`delta-band ${tone(after.status)}`}><i />{t(after.statusLabel)}</span>
                    {bandChanged && <span className="tiny muted"> ← {t(before.statusLabel)}</span>}
                  </td>
                </tr>;
              })}
            </tbody>
          </table>

          <p className="limitation">
            <TriangleAlert size={13} />
            {t("These are screening predictions on a hypothetical structure. A favourable move here is a reason to make and measure the compound, not evidence that the liability is solved.")}
          </p>
        </> : <p className="hint-muted">{t("Fix the structure to see what changes.")}</p>}
      </div>
    </div>
  </section>;
}

function DeltaTable({ rows }: { rows: Row[] }) {
  return <table className="delta-table">
    <thead><tr>
      <th>{t("Property")}</th><th>{t("Screened")}</th><th>{t("Edited")}</th><th>{t("Change")}</th>
    </tr></thead>
    <tbody>
      {rows.map((row) => {
        const delta = row.after - row.before;
        const moved = Math.abs(delta) > 10 ** -(row.decimals ?? 2) / 2;
        /* Direction is coloured only where "better" is defined for that
           property. Molecular weight going up is not good or bad on its own. */
        const direction = !moved ? "flat"
          : row.higherIsBetter === undefined ? ""
            : (delta > 0) === row.higherIsBetter ? "up" : "down";
        return <tr key={row.label} className={moved ? "moved" : ""}>
          <td>{t(row.label)}</td>
          <td>{num(row.before, row.decimals)}</td>
          <td className="now">{num(row.after, row.decimals)}{row.unit && <span className="tiny muted"> {row.unit}</span>}</td>
          <td className={`d ${direction}`}>{moved ? `${delta > 0 ? "+" : ""}${num(delta, row.decimals)}` : "—"}</td>
        </tr>;
      })}
    </tbody>
  </table>;
}
