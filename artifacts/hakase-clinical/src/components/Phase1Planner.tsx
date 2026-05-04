import type { PreClinicalPackage } from "@workspace/preclinical-handoff";

interface Props {
  pkg: PreClinicalPackage | null;
  importError: string | null;
  onImport: (jsonText: string) => void;
}

export default function Phase1Planner({ pkg, importError, onImport }: Props) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-violet-500/30 bg-[#0a0c12] p-6 ring-1 ring-violet-500/20">
        <h2 className="text-[15px] font-semibold text-white">
          Phase 1 — FIH / SAD-MAD Planner
        </h2>
        <p className="text-[12px] text-slate-400 mt-1">
          Paste a PreClinicalPackage JSON emitted by Hakase BioDigital Twin
          L4 (the §8 handoff). The planner narrows on the typed shape and
          surfaces every null field explicitly — no silent defaults.
        </p>

        <ImportBox onImport={onImport} importError={importError} />
      </div>

      {!pkg && (
        <div className="rounded-lg border border-dashed border-slate-700 bg-[#0a0c12] p-8 text-center text-[12px] text-slate-500">
          No package loaded. Run the L4 Animal Cohort simulation in
          Hakase BioDigital Twin and paste the emitted JSON above.
        </div>
      )}

      {pkg && <PackageView pkg={pkg} />}
    </div>
  );
}

function ImportBox({
  onImport,
  importError,
}: {
  onImport: (s: string) => void;
  importError: string | null;
}) {
  return (
    <div className="mt-4 space-y-2">
      <label className="text-[11px] uppercase tracking-wide text-slate-500">
        PreClinicalPackage JSON
      </label>
      <textarea
        spellCheck={false}
        rows={6}
        placeholder='{"schemaVersion":"1.0.0","compound":{...},"inVitro":{...},"inSilico":{...},"animalCohort":{...},"provenance":{...}}'
        className="w-full rounded-md border border-slate-700 bg-[#07080c] px-3 py-2 text-[12px] font-mono text-slate-200 placeholder:text-slate-600 focus:border-violet-500/60 focus:outline-none"
        onChange={(e) => onImport(e.target.value)}
      />
      {importError && (
        <p className="text-[11px] text-red-400 leading-snug">
          {importError}
        </p>
      )}
    </div>
  );
}

function PackageView({ pkg }: { pkg: PreClinicalPackage }) {
  return (
    <div className="space-y-6">
      <Section title="Compound">
        <KV k="SMILES" v={pkg.compound.smiles} mono />
        <KV k="InChIKey" v={pkg.compound.inchiKey} mono />
        <KV k="MW (g/mol)" v={fmt(pkg.compound.molecularWeight)} />
        <KV k="ChEMBL ID" v={pkg.compound.chemblId} />
        <KV k="Preferred name" v={pkg.compound.preferredName} />
      </Section>

      <Section title="L1 In Vitro">
        <KV k="hERG IC₅₀ (µM)" v={fmt(pkg.inVitro.hergIc50UM)} />
        <KV k="Caco-2 (10⁻⁶ cm/s)" v={fmt(pkg.inVitro.caco2Permeability)} />
        <KV
          k="PPB (fraction bound)"
          v={fmt(pkg.inVitro.plasmaProteinBindingFraction)}
        />
        <KV k="Primary target UniProt" v={pkg.inVitro.primaryTargetUniprot} />
        <KV k="Primary target gene" v={pkg.inVitro.primaryTargetGeneSymbol} />
        <KV
          k="Primary target IC₅₀ (nM)"
          v={fmt(pkg.inVitro.primaryTargetIc50nM)}
        />
      </Section>

      <Section title="L2 In Silico (human projections)">
        <KV
          k="Cmax (ng/mL)"
          v={fmt(pkg.inSilico.humanProjectedCmaxNgPerMl)}
        />
        <KV
          k="AUC (ng·h/mL)"
          v={fmt(pkg.inSilico.humanProjectedAucNgHPerMl)}
        />
        <KV
          k="t½ (h)"
          v={fmt(pkg.inSilico.humanProjectedHalfLifeHours)}
        />
        <KV
          k="CL (L/h/kg)"
          v={fmt(pkg.inSilico.humanProjectedClearanceLPerHPerKg)}
        />
        <KV
          k="FEP ΔΔG (kcal/mol)"
          v={fmt(pkg.inSilico.freeEnergyDdgKcalPerMol)}
        />
        <KV
          k="FEP uncertainty"
          v={fmt(pkg.inSilico.freeEnergyUncertaintyKcalPerMol)}
        />
      </Section>

      <Section title="L4 Animal Cohort">
        <KV
          k="Species"
          v={`${pkg.animalCohort.speciesDisplayName} (${pkg.animalCohort.speciesId})`}
        />
        <KV
          k="Study"
          v={`${pkg.animalCohort.studyTypeLabel} (${pkg.animalCohort.studyTypeId})`}
        />
        <KV k="Route" v={pkg.animalCohort.routeOfAdministration} />
        <KV k="NOAEL (mg/kg)" v={fmt(pkg.animalCohort.noaelMgPerKg)} />
        <KV k="MTD (mg/kg)" v={fmt(pkg.animalCohort.mtdMgPerKg)} />
        <KV k="HED-BSA (mg/kg)" v={fmt(pkg.animalCohort.hedBsaMgPerKg)} />
        <KV k="HED-PBPK (mg/kg)" v={fmt(pkg.animalCohort.hedPbpkMgPerKg)} />
        <KV k="FIH dose (mg)" v={fmt(pkg.animalCohort.fihDoseMg)} />
        <KV k="FIH dose (mg/kg)" v={fmt(pkg.animalCohort.fihDoseMgPerKg)} />
        <KV
          k="Safety margin (NOAEL)"
          v={fmt(pkg.animalCohort.safetyMarginNoael)}
        />
        <KV k="Overall risk" v={pkg.animalCohort.overallRisk} />
        <KV
          k="IND-enabling complete"
          v={pkg.animalCohort.indEnablingComplete ? "yes" : "no"}
        />
      </Section>

      <Section title="§6.1.a — CYP / Transporter Panel">
        {pkg.cypTransporterPanel === null ? (
          <NullBlock
            label="Panel unavailable"
            detail="Hakase BioDigital Twin did not emit a CYP/transporter panel for this compound. Phase 1 DDI design requires an in-vitro CYP/transporter panel before proceeding."
          />
        ) : (
          <div className="space-y-3">
            <div className="text-[11px] text-slate-500">
              CYP source:{" "}
              <span className="text-slate-300">
                {pkg.cypTransporterPanel.cyp.source ?? "—"}
              </span>
              {" · "}
              Transporter source:{" "}
              <span className="text-slate-300">
                {pkg.cypTransporterPanel.transporters.source ?? "—"}
              </span>
            </div>
            <KV
              k="CYP1A2 inhibition (P)"
              v={fmt(pkg.cypTransporterPanel.cyp.cyp1a2InhibitionProb)}
            />
            <KV
              k="CYP2C9 inhibition (P)"
              v={fmt(pkg.cypTransporterPanel.cyp.cyp2c9InhibitionProb)}
            />
            <KV
              k="CYP2C19 inhibition (P)"
              v={fmt(pkg.cypTransporterPanel.cyp.cyp2c19InhibitionProb)}
            />
            <KV
              k="CYP2D6 inhibition (P)"
              v={fmt(pkg.cypTransporterPanel.cyp.cyp2d6InhibitionProb)}
            />
            <KV
              k="CYP3A4 inhibition (P)"
              v={fmt(pkg.cypTransporterPanel.cyp.cyp3a4InhibitionProb)}
            />
            <KV
              k="Induction mRNA fold-change"
              v={fmt(pkg.cypTransporterPanel.cyp.inductionMrnaFoldChange)}
            />
            <KV
              k="P-gp inhibition (P)"
              v={fmt(pkg.cypTransporterPanel.transporters.pgpInhibitionProb)}
            />
            <KV
              k="BCRP inhibition (P)"
              v={fmt(pkg.cypTransporterPanel.transporters.bcrpInhibitionProb)}
            />
            <KV
              k="OATP1B1 inhibition (P)"
              v={fmt(pkg.cypTransporterPanel.transporters.oatp1b1InhibitionProb)}
            />
            <KV
              k="OATP1B3 inhibition (P)"
              v={fmt(pkg.cypTransporterPanel.transporters.oatp1b3InhibitionProb)}
            />
            <KV
              k="OCT2 inhibition (P)"
              v={fmt(pkg.cypTransporterPanel.transporters.oct2InhibitionProb)}
            />
            <KV
              k="MATE1 inhibition (P)"
              v={fmt(pkg.cypTransporterPanel.transporters.mate1InhibitionProb)}
            />
          </div>
        )}
      </Section>

      <Section title="§6.1.b — Renal vs Hepatic Clearance Fractions">
        {pkg.clearanceFractions === null ? (
          <NullBlock
            label="Clearance fractions unavailable"
            detail="Phase 1 Special-Pop module cannot branch renal-impairment vs hepatic-impairment study planning until route-fractional CL is provided. Add an in-vitro hepatocyte clearance assay or DMPK CL contribution data and re-emit."
          />
        ) : (
          <div className="space-y-3">
            <div className="text-[11px] text-slate-500">
              Source:{" "}
              <span className="text-slate-300">
                {pkg.clearanceFractions.source ?? "—"}
              </span>
            </div>
            <KV
              k="Renal fraction"
              v={fmt(pkg.clearanceFractions.renalFraction)}
            />
            <KV
              k="Hepatic fraction"
              v={fmt(pkg.clearanceFractions.hepaticFraction)}
            />
            <KV
              k="Biliary fraction"
              v={fmt(pkg.clearanceFractions.biliaryFraction)}
            />
            <KV
              k="Other fraction"
              v={fmt(pkg.clearanceFractions.otherFraction)}
            />
            <div className="text-[11px] text-slate-400 pt-2 leading-snug">
              {pkg.clearanceFractions.basis}
            </div>
          </div>
        )}
      </Section>

      <Section title="Provenance">
        <KV k="Emitted at" v={pkg.provenance.emittedAt} />
        <KV
          k="Emitter"
          v={`${pkg.provenance.emitterEngine} v${pkg.provenance.emitterVersion}`}
        />
        <KV k="L1 engine" v={pkg.provenance.l1EngineVersion} />
        <KV k="L2 engine" v={pkg.provenance.l2EngineVersion} />
        <KV k="L4 engine" v={pkg.provenance.l4EngineVersion} />
        {pkg.provenance.warnings.length > 0 && (
          <div className="pt-3 space-y-1">
            <div className="text-[11px] uppercase tracking-wide text-amber-400">
              Warnings
            </div>
            {pkg.provenance.warnings.map((w, i) => (
              <p
                key={i}
                className="text-[11px] text-amber-300/90 leading-snug"
              >
                · {w}
              </p>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-800/80 bg-[#0a0c12] p-5">
      <h3 className="text-[12px] uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      <div className="mt-3 space-y-1.5">{children}</div>
    </div>
  );
}

function KV({
  k,
  v,
  mono,
}: {
  k: string;
  v: string | number | null;
  mono?: boolean;
}) {
  const display = v === null || v === "" ? "—" : String(v);
  const isNull = v === null || v === "";
  return (
    <div className="grid grid-cols-12 gap-3 text-[12px]">
      <div className="col-span-5 text-slate-500">{k}</div>
      <div
        className={
          "col-span-7 truncate " +
          (mono ? "font-mono " : "") +
          (isNull ? "text-slate-600 italic" : "text-slate-200")
        }
        title={display}
      >
        {display}
      </div>
    </div>
  );
}

function NullBlock({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="text-[12px] font-medium text-amber-300">{label}</div>
      <p className="text-[11px] text-amber-200/80 mt-1 leading-snug">
        {detail}
      </p>
    </div>
  );
}

function fmt(v: number | string | null): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    if (Math.abs(v) >= 1000 || Math.abs(v) < 0.01) {
      return v.toExponential(3);
    }
    return v.toFixed(3);
  }
  return v;
}
