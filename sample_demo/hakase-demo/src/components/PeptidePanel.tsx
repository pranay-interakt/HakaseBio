/**
 * Peptide screen.
 *
 * The small-molecule cascade is not run for a peptide and this panel says so
 * rather than showing endpoints whose applicability domain excludes the
 * subject. What is shown are sequence-derived properties, which are
 * deterministic functions of the letters submitted, plus the developability
 * heuristics that apply to a peptide.
 */
import { AlertTriangle, Atom, Info, Ruler, ShieldCheck } from "lucide-react";
import { computePeptideProperties, peptideFlags, validateSequence } from "../lib/peptide";
import { num } from "../lib/format";
import { SectionHeader, Tile, TileRow } from "./ui";
import { t } from "../i18n";

export function PeptidePanel({ sequence }: { sequence: string }) {
  const issue = validateSequence(sequence);
  if (issue) {
    return <section className="panel empty">
      <div className="orb"><Ruler size={26} /></div>
      <h2>{issue.code === "empty" ? t("Enter a sequence to screen") : t("This sequence cannot be screened")}</h2>
      <p>{t(issue.detail)}</p>
    </section>;
  }

  const properties = computePeptideProperties(sequence)!;
  const flags = peptideFlags(properties);

  return <>
    <section className="panel">
      <SectionHeader icon={<Ruler size={18} />} eyebrow={t("PEPTIDE · SEQUENCE PROPERTIES")} accent="l1"
        title={t("{n} residues", { n: properties.length })}
        description={t("Deterministic functions of the submitted sequence. Values are for the linear, free-acid, fully reduced peptide — a disulfide bridge, a C-terminal amide or any other modification is not expressible in a one-letter sequence and is not assumed.")} />

      <div className="peptide-sequence">
        {[...properties.sequence].map((residue, index) => (
          <span key={index} data-residue={residue} title={`${index + 1} · ${residue}`}>{residue}</span>
        ))}
      </div>

      <TileRow>
        <Tile icon={<Atom size={16} />} label={t("Molecular weight")} value={num(properties.molecularWeightDa, 1)} unit="Da"
          note={t("Linear free acid, no modifications assumed")} />
        <Tile icon={<ShieldCheck size={16} />} label={t("Isoelectric point")} value={num(properties.isoelectricPoint, 2)}
          note={t("EMBOSS pKa set, by titration")} />
        <Tile icon={<Info size={16} />} label={t("Net charge at pH 7.4")} value={num(properties.netChargeAtPh74, 2)}
          note={t("Henderson–Hasselbalch over the ionisable groups")}
          tone={properties.netChargeAtPh74 > 2 ? "warn" : "neutral"} />
        <Tile icon={<Ruler size={16} />} label={t("GRAVY")} value={num(properties.gravy, 3)}
          note={t("Mean Kyte–Doolittle hydropathy")}
          tone={properties.gravy > 0 ? "warn" : "good"} />
      </TileRow>

      <div className="dl-grid">
        <div><dt>{t("Aliphatic index")}</dt><dd>{num(properties.aliphaticIndex, 1)}</dd></div>
        <div><dt>{t("Boman index")}</dt><dd>{num(properties.bomanIndex, 2)} kcal/mol</dd></div>
        <div><dt>{t("Aromaticity")}</dt><dd>{num(properties.aromaticity, 3)}</dd></div>
        <div><dt>{t("Extinction at 280 nm")}</dt><dd>{properties.extinctionCoefficient.toLocaleString()} M⁻¹cm⁻¹</dd></div>
      </div>

      <p className="limitation">
        <AlertTriangle size={13} />
        {t("The instability index requires the Guruprasad dipeptide-instability table and is computed by the sequence service, not here. It is absent rather than approximated.")}
      </p>
    </section>

    <section className="panel">
      <SectionHeader icon={<ShieldCheck size={18} />} eyebrow={t("DEVELOPABILITY")} accent="l1"
        title={t("Sequence-derived observations")}
        description={t("Screening heuristics with a stated basis, each naming what would settle it. No overall grade is computed — averaging a charge against a hydrophobicity has no more meaning here than averaging a permeability against a genotoxicity flag.")} />
      <div className="criteria">
        {flags.map((flag) => (
          <div className="criterion" data-tone={flag.tone} key={flag.title}>
            <div className="criterion-head"><strong>{t(flag.title)}</strong></div>
            <span>{t(flag.detail)}</span>
          </div>
        ))}
      </div>
    </section>

    <section className="panel">
      <SectionHeader icon={<Info size={18} />} eyebrow={t("NOT APPLICABLE")} accent="l1"
        title={t("Why the small-molecule cascade did not run")}
        description={t("This is an absence by design, not a gap in the run.")} />
      <div className="dl-grid">
        <div className="narrative">
          <dt>{t("ADMET endpoint panel")}</dt>
          <dd>{t("The ADMET-AI models are trained on small-molecule chemistry. A peptide falls outside their applicability domain, so every endpoint would be an extrapolation reported as a value. The panel is withheld rather than labelled.")}</dd>
        </div>
        <div className="narrative">
          <dt>{t("Rule of five and the structural filters")}</dt>
          <dd>{t("Lipinski, Veber, Ghose, Egan and Muegge are heuristics derived from approved oral small molecules. A peptide fails them by construction, which says nothing about the peptide.")}</dd>
        </div>
        <div className="narrative">
          <dt>{t("PAINS and Brenk structural alerts")}</dt>
          <dd>{t("Both catalogues target reactive small-molecule substructures found in screening libraries. Matching them against a polypeptide backbone produces artefacts, not liabilities.")}</dd>
        </div>
      </div>
    </section>
  </>;
}
