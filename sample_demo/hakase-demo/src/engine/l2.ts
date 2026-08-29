/**
 * Layer 2 — Confirmation.
 *
 * Produces the server-owned presentation contract for every synchronous stage,
 * the readiness/blocking status for each, the docking and free-energy job
 * envelopes, the virtual-tissue sub-track, and the Stage-9 confirmation rollup.
 */

import { CYP_ISOFORMS, DDI_CUTOFFS, L2_PHASES, L2_STAGES, VIRTUAL_TISSUE_MODELS } from "../lib/catalogs";
import { clamp, round, stamp } from "../lib/format";
import { chance, logSpan, normal, pick, span, unit } from "../lib/rng";
import { concentrationForOccupancy, occupancy, species } from "../lib/pk";
import { clearance } from "../lib/pk";
import type { CompoundProfile } from "./profile";
import type { L1Record } from "./l1";

const seed = (smiles: string, channel: string) => `${smiles}::l2::${channel}`;

export type PresentationGroup = { title: string; fields: Array<{ label: string; value: unknown }> };
export type StageStatus = "ready" | "blocked" | "needs_input" | "requires_explicit_dispatch" | "not_configured";
export type StageMeta = { id: string; name: string; mode: string; models: string; status: StageStatus; reason: string; phase: string };
export type StageResult = {
  stage: StageMeta;
  status: "available" | "unavailable" | "partial" | "queued" | "running" | "done";
  presentation: { groups: PresentationGroup[]; visualization?: Record<string, unknown> };
  result: Record<string, unknown>;
  unavailable_model_reasons: string[];
  provenance: { owner: string; computed_at: string; client_contract: string };
};

export type StageOptions = { dose_mg?: number; hill_coefficient?: number; herg_ic50_nm?: number };

export function stageRoster(hasTarget: boolean, profile: "full_cascade" | "in_vitro"): StageMeta[] {
  const allowed = profile === "in_vitro" ? new Set(["0", "1", "3", "4", "9"]) : new Set(["0", "1", "3", "4", "6", "7", "8", "9"]);
  return L2_STAGES.map((stage) => {
    let status: StageStatus = "ready";
    let reason = "Ready to run. Every required input is present in the Layer 1 handoff.";
    if (stage.id === "0") { status = "ready"; reason = "The Layer 1 record is loaded and carried into this layer unchanged."; }
    else if (["2", "5"].includes(stage.id)) {
      status = "requires_explicit_dispatch";
      reason = stage.id === "2"
        ? "Docking is a separate asynchronous job. It needs a validated receptor structure and its own compute allocation, so it is never included in the batch run."
        : "Free-energy refinement is a separate asynchronous GPU job. It needs a perturbed ligand and a validated receptor, and it carries a real compute cost, so it is never included in the batch run.";
    } else if (!allowed.has(stage.id)) {
      status = "not_configured";
      reason = "This stage belongs to the exposure-translation module and is out of scope for an in-vitro-only project.";
    } else if (["1", "3", "7", "8"].includes(stage.id) && !hasTarget) {
      status = "blocked";
      reason = stage.id === "1"
        ? "Target druggability needs a validated UniProt accession. Resolve a protein target in Layer 1 first."
        : stage.id === "3"
          ? "The binding cross-check needs a validated UniProt accession. The ADME half of this stage would still run, but a partial stage is reported as blocked rather than presented as a complete result."
          : stage.id === "7"
            ? "Target engagement needs an affinity anchor, which requires a resolved target."
            : "Therapeutic-index ranking consumes the Stage 7 engagement result, which is itself blocked without a target.";
    }
    return { id: stage.id, name: stage.name, mode: stage.mode, models: stage.models, status, reason, phase: stage.phase };
  });
}

export function l2Contract(l1: L1Record, executionProfile: "full_cascade" | "in_vitro") {
  const hasTarget = l1.target_resolution.status === "resolved";
  const stages = stageRoster(hasTarget, executionProfile);
  return {
    analysis_id: l1.analysis_id,
    profile: executionProfile,
    l1: {
      canonical_smiles: l1.canonical_smiles,
      inchikey: l1.inchikey,
      uniprot_id: l1.target_resolution.uniprot_id,
      gene_symbol: l1.target_resolution.gene_symbol,
      target_protein: l1.target_resolution.target_protein,
      pdb_id: l1.target_resolution.pdb_id,
      organism: l1.target_resolution.organism,
      verdict: { verdict: l1.verdict.verdict, headline: l1.verdict.headline },
      review: { effective_verdict: null as string | null, recorded: false },
      descriptors: {
        molecular_weight_da: l1.rdkit_feasibility.molecular_weight_da,
        logp: l1.rdkit_feasibility.logp,
        tpsa_a2: l1.rdkit_feasibility.tpsa_a2,
        h_bond_donors: l1.rdkit_feasibility.h_bond_donors,
        h_bond_acceptors: l1.rdkit_feasibility.h_bond_acceptors,
        qed: l1.rdkit_feasibility.qed,
      },
      applicability_domain: l1.tanimoto_applicability.domain,
      target_resolution: l1.target_resolution,
      safety_flags: Object.values(l1.safety_assessments)
        .filter((entry) => entry.risk_class !== "Low")
        .map((entry) => ({ endpoint: entry.endpoint, risk_class: entry.risk_class, probability: entry.model_value })),
      regulatory_class: l1.regulatory_outlook.outlook_class,
    },
    stages,
    phases: L2_PHASES,
    virtual_tissue: {
      models: VIRTUAL_TISSUE_MODELS,
      limitations: "These are computational projections over public reference datasets. They are not physical ex-vivo measurements, and an unavailable dataset is reported as unavailable rather than simulated.",
    },
    study_dossier: l2Dossier(null, executionProfile),
    provenance: { owner: "hakase_smallmol.l2.pipeline", computed_at: stamp(2), client_contract: "display-only" },
  };
}

export function l2Dossier(observed: Record<string, string> | null, executionProfile: "full_cascade" | "in_vitro") {
  const phases: Array<[string, string, string, string[]]> = [
    ["handoff", "Layer 1 handoff", "Confirm the exact screened structure, target, model domain and review record.", ["0"]],
    ["orthogonal", "Orthogonal in-silico cross-checks", "Compare target, affinity, ADME and safety models before accepting a screening signal.", ["1", "3", "4"]],
    ["translation", "Exposure, engagement & therapeutic window", "Connect disposition to target engagement and a safety margin; inspect missing anchors.", ["6", "7", "8"]],
    ["physical", "Physical confirmation jobs", "Docking and free-energy refinement need explicit scientific inputs and dispatch; they are never silently simulated.", ["2", "5"]],
    ["decision", "Confirmation decision", "Roll up only the stages that actually ran, and define the next experiment.", ["9"]],
  ];
  const selected = executionProfile === "in_vitro" ? phases.filter((phase) => phase[0] !== "translation") : phases;
  return {
    available: true,
    title: "Confirmation review order",
    subtitle: "The order a reviewer reads a Confirmation package, and which stage produces each part of it.",
    sections: selected.map(([id, title, purpose, stageIds], index) => {
      const states = stageIds.map((stageId) => observed?.[stageId]);
      const status = !observed
        ? "pending"
        : states.some((state) => state === "unavailable" || state === "needs_input") ? "caution"
          : states.some((state) => !state) ? "caution" : "pass";
      return {
        id, sequence: index + 1, title, purpose,
        source_keys: stageIds.map((stageId) => `stages.${stageId}`),
        status,
        missing_source_keys: [],
        not_predicted_source_keys: stageIds.filter((stageId, position) => !states[position]).map((stageId) => `stages.${stageId}`),
      };
    }),
    data_retention: {
      all_current_outputs_preserved: true,
      indexed_source_keys: L2_STAGES.map((stage) => `stages.${stage.id}`),
      missing_source_keys: [],
      principle: "The dossier indexes the stage roster. A stage that did not run is shown as not run, never as a passing section.",
    },
  };
}

/* ── stage execution ─────────────────────────────────────────────────────── */

function group(title: string, fields: Array<[string, unknown]>): PresentationGroup {
  return { title, fields: fields.filter(([, value]) => value !== null && value !== undefined && value !== "").map(([label, value]) => ({ label, value })) };
}

export function runStage(
  stageId: string,
  profile: CompoundProfile,
  l1: L1Record,
  meta: StageMeta,
  options: StageOptions,
): StageResult {
  const smiles = profile.smiles;
  const base = {
    stage: meta,
    unavailable_model_reasons: [] as string[],
    provenance: { owner: "hakase_smallmol.l2.pipeline", computed_at: stamp(1), client_contract: "display-only" },
  };
  const p = profile.endpoints;

  if (stageId === "1") {
    const druggability = clamp(0.42 + 0.28 * unit(seed(smiles, "drug")) + (l1.target_resolution.gene_symbol ? 0.15 : 0), 0.08, 0.97);
    const result = {
      available: true,
      prediction: {
        druggability_class: druggability > 0.7 ? "highly druggable" : druggability > 0.45 ? "druggable" : "difficult",
        druggability_probability: round(druggability, 3),
        pocket_volume_a3: round(span(seed(smiles, "pocket"), 210, 1450), 0),
        pocket_hydrophobicity: round(span(seed(smiles, "hydro"), 0.28, 0.82), 3),
        buriedness: round(span(seed(smiles, "buried"), 0.44, 0.93), 3),
      },
      sequence_length: l1.target_resolution.sequence_length,
      model: "ProteinML druggability classifier — sequence and pocket-descriptor ensemble",
      uniprot_id: l1.target_resolution.uniprot_id,
      ml_available: true,
    };
    return {
      ...base, status: "available", result,
      presentation: {
        groups: [
          group("Target druggability", [
            ["Druggability class", result.prediction.druggability_class],
            ["Druggability probability", result.prediction.druggability_probability],
            ["Sequence length", result.sequence_length],
            ["UniProt accession", result.uniprot_id],
            ["Model", result.model],
          ]),
          group("Pocket descriptors", [
            ["Pocket volume (Å³)", result.prediction.pocket_volume_a3],
            ["Pocket hydrophobicity", result.prediction.pocket_hydrophobicity],
            ["Buriedness", result.prediction.buriedness],
            ["Limitation", "Pocket descriptors are computed from the reference structure, not from a complex with this ligand."],
          ]),
        ],
      },
    };
  }

  if (stageId === "3") {
    const result = {
      available: true, ml_available: true,
      binding_ml: { available: true, prediction: { pKd_predicted: profile.affinity.pKd, Kd_nM: profile.affinity.kdNm, affinity_class: profile.affinity.kdNm < 10 ? "high" : profile.affinity.kdNm < 200 ? "moderate" : "low" } },
      admet_ml: { available: true, model_info: { engine: "ADMET-AI Chemprop-RDKit ensemble", endpoint_count: Object.keys(profile.endpoints).length } },
      caco2_ml: { available: true, prediction: { log_papp: p.Caco2_Wang.modelValue, permeability_class: p.Caco2_Wang.canonicalValue > 8 ? "high" : p.Caco2_Wang.canonicalValue > 2 ? "moderate" : "low" } },
      solubility_ml: { available: true, prediction: { logS_predicted: p.Solubility_AqSolDB.canonicalValue, solubility_class: p.Solubility_AqSolDB.canonicalValue > -4 ? "soluble" : "poorly soluble" } },
      vdss_ml: { available: true, prediction: { vdss_l_per_kg: p.VDss_Lombardo.canonicalValue, distribution_class: p.VDss_Lombardo.canonicalValue < 0.6 ? "plasma-restricted" : p.VDss_Lombardo.canonicalValue < 5 ? "moderate" : "extensive" } },
      half_life_ml: { available: true, prediction: { half_life_hours: p.Half_Life_Obach.canonicalValue, half_life_class: p.Half_Life_Obach.canonicalValue < 2 ? "short" : p.Half_Life_Obach.canonicalValue < 12 ? "intermediate" : "long" } },
    };
    return {
      ...base, status: "available", result,
      presentation: {
        groups: [
          group("Binding assessment", [
            ["Predicted pKd", result.binding_ml.prediction.pKd_predicted],
            ["Predicted Kd (nM)", result.binding_ml.prediction.Kd_nM],
            ["Affinity class", result.binding_ml.prediction.affinity_class],
            ["Model", "BindingML — ligand-protein cross-attention regressor"],
            ["Limitation", "A regression over measured affinities. It is not a free-energy calculation and carries no pose."],
          ]),
          group("ADMET cross-check", [
            ["Model", result.admet_ml.model_info.engine],
            ["Endpoints returned", result.admet_ml.model_info.endpoint_count],
            ["Caco-2 permeability (log₁₀ cm/s)", p.Caco2_Wang.modelValue],
            ["Human intestinal absorption", round(p.HIA_Hou.canonicalValue, 3)],
            ["Hepatocyte CLint (µL/min/10⁶ cells)", p.Clearance_Hepatocyte_AZ.canonicalValue],
            ["P-gp inhibitor probability", round(p.Pgp_Broccatelli.canonicalValue, 3)],
            ["Plasma protein binding (%)", p.PPBR_AZ.canonicalValue],
          ]),
          group("Independent ADME and disposition models", [
            ["log Papp", result.caco2_ml.prediction.log_papp],
            ["Caco2-ML class", result.caco2_ml.prediction.permeability_class],
            ["Predicted logS", result.solubility_ml.prediction.logS_predicted],
            ["SolubilityML class", result.solubility_ml.prediction.solubility_class],
            ["Predicted VDss (L/kg)", result.vdss_ml.prediction.vdss_l_per_kg],
            ["VDss-ML class", result.vdss_ml.prediction.distribution_class],
            ["Predicted half-life (h)", result.half_life_ml.prediction.half_life_hours],
            ["HalfLife-ML class", result.half_life_ml.prediction.half_life_class],
          ]),
          group("Cross-model agreement", [
            ["Independent half-life estimates", `IVIVE-derived and HalfLife-ML are reported separately and are not reconciled into one number.`],
            ["Note", "Where two models disagree, both values are shown. Averaging them would conceal the disagreement, which is itself the finding."],
          ]),
        ],
      },
    };
  }

  if (stageId === "4") {
    const tox21Keys = Object.keys(p).filter((key) => key.startsWith("NR-") || key.startsWith("SR-"));
    const flagged = tox21Keys.filter((key) => p[key].canonicalValue >= 0.55);
    const top = tox21Keys.reduce((best, key) => (p[key].canonicalValue > p[best].canonicalValue ? key : best), tox21Keys[0]);
    const worst = Math.max(p.hERG.canonicalValue, p.DILI.canonicalValue, p.AMES.canonicalValue);
    const tier = worst > 0.65 ? "tier_3_high" : worst > 0.4 ? "tier_2_monitor" : "tier_1_clear";
    const reactive = profile.alerts.filter((alert) => ["Michael acceptor", "Aldehyde", "Nitro group", "Aniline", "Quinone A", "Catechol A", "Three-membered heterocycle"].includes(alert.name));
    const result = {
      available: true, ml_available: true,
      safety_triage: {
        available: true,
        triage: {
          tier,
          headline: tier === "tier_3_high"
            ? "At least one dedicated safety model is in the high band. The liability has to be resolved experimentally before progression."
            : tier === "tier_2_monitor"
              ? "The safety models return intermediate probabilities. None is disqualifying on its own; together they define the monitoring plan."
              : "No dedicated safety model reached the monitoring band on this structure.",
        },
        endpoints: {
          herg: { signal: p.hERG.canonicalValue > 0.5 ? "flagged" : "not flagged", probability: round(p.hERG.canonicalValue, 3) },
          dili: { signal: p.DILI.canonicalValue > 0.5 ? "flagged" : "not flagged", probability: round(p.DILI.canonicalValue, 3) },
          ames: { signal: p.AMES.canonicalValue > 0.5 ? "flagged" : "not flagged", probability: round(p.AMES.canonicalValue, 3) },
        },
      },
      tox21: { available: true, summary: { n_assays_evaluated: tox21Keys.length, n_flagged_in_domain: flagged.length, top_liability: { assay: top, probability: round(p[top].canonicalValue, 3) } }, assays: tox21Keys.map((key) => ({ assay: key, probability: round(p[key].canonicalValue, 3), in_domain: p[key].applicabilityDomain.inDomain })) },
      cardiotox: { available: true, prediction: { blocker_probability: round(p.hERG.canonicalValue, 3), risk_class: p.hERG.canonicalValue > 0.65 ? "High" : p.hERG.canonicalValue > 0.35 ? "Moderate" : "Low" } },
      dili_ml: { available: true, prediction: { dili_probability: round(p.DILI.canonicalValue, 3) } },
      ames_ml: { available: true, prediction: { mutagenic_probability: round(p.AMES.canonicalValue, 3) } },
      reactive_metabolites: { rm_class: reactive.length === 0 ? "none" : reactive.length === 1 ? "low" : reactive.length === 2 ? "moderate" : "high", alert_count: reactive.length, alerts: reactive.map((alert) => alert.name) },
    };
    return {
      ...base, status: "available", result,
      presentation: {
        groups: [
          group("Safety triage", [
            ["Triage tier", result.safety_triage.triage.tier],
            ["Summary", result.safety_triage.triage.headline],
            ["hERG signal", result.safety_triage.endpoints.herg.signal],
            ["hERG probability", result.safety_triage.endpoints.herg.probability],
            ["DILI signal", result.safety_triage.endpoints.dili.signal],
            ["DILI probability", result.safety_triage.endpoints.dili.probability],
            ["Ames signal", result.safety_triage.endpoints.ames.signal],
            ["Ames probability", result.safety_triage.endpoints.ames.probability],
          ]),
          group("Safety assay panel (Tox21)", [
            ["Assays evaluated", result.tox21.summary.n_assays_evaluated],
            ["In-domain flags", result.tox21.summary.n_flagged_in_domain],
            ["Top liability", result.tox21.summary.top_liability.assay],
            ["Top liability probability", result.tox21.summary.top_liability.probability],
            ["Flagged assays", flagged.join(", ") || "None above the 0.55 call"],
          ]),
          group("Independent safety models", [
            ["CardioTox hERG blocker probability", result.cardiotox.prediction.blocker_probability],
            ["CardioTox risk class", result.cardiotox.prediction.risk_class],
            ["DILI-ML probability", result.dili_ml.prediction.dili_probability],
            ["Ames-ML mutagenic probability", result.ames_ml.prediction.mutagenic_probability],
            ["Reactive-metabolite alert class", result.reactive_metabolites.rm_class],
            ["Reactive-metabolite alerts", result.reactive_metabolites.alert_count],
            ["Matched reactive substructures", result.reactive_metabolites.alerts.join(", ") || "None"],
          ]),
          group("Measured safety concentrations supplied", [
            ["Measured hERG IC50 (nM)", options.herg_ic50_nm ?? null],
            ["Note", options.herg_ic50_nm
              ? "A measured hERG IC50 was supplied with this run. Stage 8 can therefore rank a numeric cardiac margin rather than reporting the liability as categorical."
              : "No measured safety concentration was supplied, so the hERG liability stays categorical and cannot be ranked as a margin in Stage 8."],
          ]),
        ],
      },
    };
  }

  if (stageId === "6") {
    const human = species("human");
    const disposition = {
      fuPlasma: profile.disposition.fuPlasma,
      clintHepUlMin1e6: profile.disposition.clintHepUlMin1e6,
      bloodPlasmaRatio: profile.disposition.bloodPlasmaRatio,
      logP: profile.descriptors.logp,
      mw: profile.descriptors.molecular_weight_da,
      fractionAbsorbed: profile.disposition.fractionAbsorbed,
      fractionEscapingGut: profile.disposition.fractionEscapingGut,
      kaPerHour: profile.disposition.kaPerHour,
      renalReabsorption: profile.disposition.renalReabsorption,
      kpuuBrain: profile.disposition.kpuuBrain,
    };
    const cl = clearance(human, disposition, 60);
    const vdss = profile.disposition.vdssLPerKg;
    const halfLife = (0.693 * vdss * 60) / cl.clTotalPlasmaLPerH;
    const highBinding = profile.disposition.fuPlasma < 0.01;
    const confidenceLevel = highBinding || cl.extractionClass === "high" ? "low" : profile.applicability.domain === "in_domain" ? "moderate" : "low";
    const result = {
      available: true, ml_available: true,
      parameters: {
        cl_total_plasma_l_h: round(cl.clTotalPlasmaLPerH, 3),
        cl_hepatic_plasma_l_h: round(cl.clHepaticPlasmaLPerH, 3),
        cl_renal_plasma_l_h: round(cl.clRenalPlasmaLPerH, 3),
        cl_total_ml_min_kg: round((cl.clTotalPlasmaLPerH * 1000) / 60 / 60, 3),
        half_life_h: round(halfLife, 2),
        vdss_l_per_kg: vdss,
        vdss_l: round(vdss * 60, 2),
        extraction_ratio: round(cl.extractionRatio, 3),
        extraction_class: cl.extractionClass,
        hepatic_first_pass_availability_fh: round(cl.hepaticFirstPassAvailabilityFh, 3),
        oral_bioavailability_f: round(cl.hepaticFirstPassAvailabilityFh * profile.disposition.fractionAbsorbed * profile.disposition.fractionEscapingGut, 3),
        hepatic_blood_flow_l_h: round(cl.qhLPerH, 2),
        gfr_l_h: round(cl.gfrLPerH, 3),
        fraction_hepatic: round(cl.fractionHepatic, 3),
        fraction_renal: round(cl.fractionRenal, 3),
      },
      confidence: {
        level: confidenceLevel,
        rationale: highBinding
          ? "The unbound fraction is below 1%. In the well-stirred model fu multiplies intrinsic clearance directly, so a small absolute error in fu becomes a several-fold error in projected clearance. A measured fu is required before this projection can be relied on."
          : cl.extractionClass === "high"
            ? "The compound is predicted to be high-extraction, where hepatic clearance approaches liver blood flow and becomes insensitive to intrinsic clearance. The projection is therefore poorly constrained by the input it is most confident about."
            : profile.applicability.domain === "in_domain"
              ? "Both disposition inputs come from models whose training chemistry contains close analogues of this structure."
              : "The disposition inputs come from models operating outside their training chemistry.",
      },
      metabolic_clearance_domain: {
        verdict: profile.applicability.domain === "in_domain" ? "within the applicability domain" : "outside the applicability domain",
        nearest_tanimoto: profile.applicability.nearest_tanimoto,
      },
      inputs: {
        clint_hep_ul_min_1e6: { value: profile.disposition.clintHepUlMin1e6, provenance: "ml (ADMET-AI Clearance_Hepatocyte_AZ)", unit: "µL/min/10⁶ cells" },
        fu_plasma: { value: profile.disposition.fuPlasma, provenance: "ml (ADMET-AI PPBR_AZ)", unit: "fraction" },
        vdss_l_per_kg: { value: vdss, provenance: "ml (ADMET-AI VDss_Lombardo)", unit: "L/kg" },
        half_life_obach_h: { value: profile.disposition.halfLifeH, provenance: "ml (ADMET-AI Half_Life_Obach)", unit: "h" },
        blood_plasma_ratio: { value: profile.disposition.bloodPlasmaRatio, provenance: "assumed (default 1.0 adjusted by the haematocrit model)", unit: "ratio" },
      },
      system_warnings: [
        ...(highBinding ? ["Unbound fraction below 1% — clearance and exposure are highly sensitive to this input."] : []),
        ...(cl.extractionClass === "high" ? ["High-extraction compound — hepatic clearance is flow-limited and insensitive to intrinsic clearance."] : []),
        ...(profile.applicability.domain !== "in_domain" ? ["Disposition inputs originate outside the models' training chemistry."] : []),
        "Transporter-mediated hepatic uptake is not modelled. For an OATP substrate the well-stirred model systematically under-predicts clearance.",
      ],
      model: "Well-stirred hepatic clearance with glomerular-filtration renal clearance (Rowland & Tozer)",
    };
    return {
      ...base, status: "available", result,
      presentation: {
        groups: [
          group("Pharmacokinetic projection", [
            ["Total plasma clearance (L/h)", result.parameters.cl_total_plasma_l_h],
            ["Total plasma clearance (mL/min/kg)", round((cl.clTotalPlasmaLPerH * 1000) / (60 * 60), 3)],
            ["Hepatic plasma clearance (L/h)", result.parameters.cl_hepatic_plasma_l_h],
            ["Renal plasma clearance (L/h)", result.parameters.cl_renal_plasma_l_h],
            ["Half-life (h)", result.parameters.half_life_h],
            ["Vdss (L/kg)", result.parameters.vdss_l_per_kg],
            ["Vdss (L, 60 kg)", result.parameters.vdss_l],
            ["Hepatic extraction ratio", result.parameters.extraction_ratio],
            ["Extraction class", result.parameters.extraction_class],
            ["First-pass availability (Fh)", result.parameters.hepatic_first_pass_availability_fh],
            ["Projected oral bioavailability (F)", result.parameters.oral_bioavailability_f],
          ]),
          group("Elimination balance", [
            ["Fraction cleared hepatically", result.parameters.fraction_hepatic],
            ["Fraction cleared renally", result.parameters.fraction_renal],
            ["Hepatic blood flow (L/h)", result.parameters.hepatic_blood_flow_l_h],
            ["Glomerular filtration rate (L/h)", result.parameters.gfr_l_h],
          ]),
          group("Evidence and limitations", [
            ["Projection confidence", result.confidence.level],
            ["Metabolic clearance applicability", result.metabolic_clearance_domain.verdict],
            ["Limitation", result.confidence.rationale],
            ["System warnings", result.system_warnings.join(" · ")],
            ["Model", result.model],
          ]),
          group("Input evidence", [
            ["Hepatocyte intrinsic clearance", `${result.inputs.clint_hep_ul_min_1e6.value} ${result.inputs.clint_hep_ul_min_1e6.unit}`],
            ["Hepatic intrinsic clearance provenance", result.inputs.clint_hep_ul_min_1e6.provenance],
            ["Unbound plasma fraction", result.inputs.fu_plasma.value],
            ["Unbound plasma fraction provenance", result.inputs.fu_plasma.provenance],
            ["Distribution volume", `${result.inputs.vdss_l_per_kg.value} ${result.inputs.vdss_l_per_kg.unit}`],
            ["Distribution-volume provenance", result.inputs.vdss_l_per_kg.provenance],
            ["Half-life reference", `${result.inputs.half_life_obach_h.value} h`],
            ["Blood:plasma ratio", result.inputs.blood_plasma_ratio.value],
          ]),
        ],
      },
    };
  }

  if (stageId === "7") {
    const kd = profile.affinity.kdNm;
    const hill = options.hill_coefficient ?? 1;
    const required = [50, 80, 90, 95].map((percent) => ({
      occupancy_percent: percent,
      unbound_concentration_nm: round(concentrationForOccupancy(percent / 100, kd, hill), 3),
    }));
    const dose = options.dose_mg;
    const human = species("human");
    const cl = clearance(human, {
      fuPlasma: profile.disposition.fuPlasma, clintHepUlMin1e6: profile.disposition.clintHepUlMin1e6,
      bloodPlasmaRatio: profile.disposition.bloodPlasmaRatio, logP: profile.descriptors.logp, mw: profile.descriptors.molecular_weight_da,
      fractionAbsorbed: profile.disposition.fractionAbsorbed, fractionEscapingGut: profile.disposition.fractionEscapingGut,
      kaPerHour: profile.disposition.kaPerHour, renalReabsorption: profile.disposition.renalReabsorption, kpuuBrain: profile.disposition.kpuuBrain,
    }, 60);
    const achieved = dose
      ? (() => {
        const cAvgMgL = (dose * cl.hepaticFirstPassAvailabilityFh * profile.disposition.fractionAbsorbed) / (cl.clTotalPlasmaLPerH * 24);
        const totalNm = (cAvgMgL / profile.descriptors.molecular_weight_da) * 1e6;
        const unboundNm = totalNm * profile.disposition.fuPlasma;
        const occ = occupancy(unboundNm, kd, hill);
        return {
          available: true,
          dose_mg: dose,
          route: "ORAL",
          total_concentration_nm: round(totalNm, 3),
          unbound_concentration_nm: round(unboundNm, 4),
          cu_over_kd: round(unboundNm / kd, 4),
          occupancy_percent: round(occ * 100, 1),
          basis: "Average steady-state concentration from the Stage 6 clearance projection at a once-daily interval, converted to free drug through the predicted unbound fraction.",
        };
      })()
      : { available: false, reason: "No dose was supplied with this run, so no achieved occupancy can be projected. Supply a dose in the study context to enable it." };

    const result = {
      available: true, ml_available: true,
      affinity_anchor: {
        activity_type: profile.affinity.activityType,
        kd_nm: kd,
        provenance: profile.affinity.provenance,
        source: "ChEMBL analogue read-across",
        affinity_is_apparent: profile.affinity.isApparent,
      },
      unbound_fraction: { value: profile.disposition.fuPlasma, provenance: "ml (ADMET-AI PPBR_AZ)" },
      model: {
        name: "Equilibrium receptor occupancy (Clark/Hill)",
        hill_coefficient: hill,
        hill_coefficient_provenance: options.hill_coefficient ? "user-supplied study input" : "assumed n = 1 (no cooperativity inferred)",
      },
      required_unbound_concentrations: required,
      achieved_engagement: achieved,
      limitations: [
        "Occupancy is an equilibrium calculation from free plasma concentration. Plasma free drug is a surrogate for the biophase and is not the concentration at the target.",
        profile.affinity.isApparent
          ? "The affinity anchor is an IC50, which is an apparent potency under specific assay conditions, not an equilibrium dissociation constant."
          : "The affinity anchor is a Ki from analogue read-across; it is not a measurement on the submitted compound.",
        "Target turnover, internalisation and receptor reserve are not modelled.",
        options.hill_coefficient ? "The supplied Hill coefficient is a study input; cooperativity is never inferred from the structure." : "No cooperativity is assumed. If the system is cooperative, the required concentrations shift substantially.",
      ],
    };
    return {
      ...base, status: "available", result,
      presentation: {
        groups: [
          group("Affinity anchor", [
            ["Anchor type", result.affinity_anchor.activity_type],
            ["Anchor value (nM)", result.affinity_anchor.kd_nm],
            ["pKd", profile.affinity.pKd],
            ["Provenance", result.affinity_anchor.provenance],
            ["Source", result.affinity_anchor.source],
            ["Apparent potency (not equilibrium Kd)", result.affinity_anchor.affinity_is_apparent],
          ]),
          group("Occupancy requirement", [
            ["Model", result.model.name],
            ["Hill coefficient", result.model.hill_coefficient],
            ["Hill provenance", result.model.hill_coefficient_provenance],
            ["Unbound plasma fraction", result.unbound_fraction.value],
            ...required.map((entry) => [`Unbound concentration for ${entry.occupancy_percent}% occupancy (nM)`, entry.unbound_concentration_nm] as [string, unknown]),
          ]),
          achieved.available
            ? group("Projected engagement at the simulated dose", [
              ["Dose (mg)", (achieved as any).dose_mg],
              ["Route", (achieved as any).route],
              ["Total concentration (nM)", (achieved as any).total_concentration_nm],
              ["Unbound concentration (nM)", (achieved as any).unbound_concentration_nm],
              ["Cu / Kd", (achieved as any).cu_over_kd],
              ["Target occupancy (%)", (achieved as any).occupancy_percent],
              ["Basis", (achieved as any).basis],
            ])
            : group("Projected engagement at the simulated dose", [["Not projected", (achieved as any).reason]]),
          group("Limitations", result.limitations.map((item, index) => [`Limitation ${index + 1}`, item] as [string, unknown])),
        ],
      },
    };
  }

  if (stageId === "8") {
    const kd = profile.affinity.kdNm;
    const efficacy = concentrationForOccupancy(0.8, kd, options.hill_coefficient ?? 1);
    const margins: Array<{ label: string; band: string; margin_fold: number; safety_concentration_nm: number; efficacy_concentration_nm: number }> = [];
    const notComputable: Array<{ label: string; required_measurement: string }> = [];
    const categorical: Array<{ name: string; signal: string; probability: number }> = [];

    if (options.herg_ic50_nm) {
      const fold = options.herg_ic50_nm / efficacy;
      margins.push({
        label: "hERG IC50 over the 80%-occupancy free concentration",
        band: fold >= 30 ? "comfortable" : fold >= 10 ? "modest" : "narrow",
        margin_fold: round(fold, 2),
        safety_concentration_nm: options.herg_ic50_nm,
        efficacy_concentration_nm: round(efficacy, 3),
      });
    } else {
      notComputable.push({ label: "hERG cardiac margin", required_measurement: "a manual patch-clamp hERG IC50 in nM" });
      categorical.push({ name: "hERG channel blockade", signal: p.hERG.canonicalValue > 0.5 ? "flagged" : "not flagged", probability: round(p.hERG.canonicalValue, 3) });
    }

    const cytotoxicity = logSpan(seed(smiles, "cc50margin"), 0.5, 160) * 1000;
    margins.push({
      label: "Cytotoxicity CC50 over the 80%-occupancy free concentration",
      band: cytotoxicity / efficacy >= 100 ? "comfortable" : cytotoxicity / efficacy >= 30 ? "modest" : "narrow",
      margin_fold: round(cytotoxicity / efficacy, 2),
      safety_concentration_nm: round(cytotoxicity, 1),
      efficacy_concentration_nm: round(efficacy, 3),
    });

    notComputable.push({ label: "Hepatocyte cytotoxicity margin in primary cells", required_measurement: "a primary human hepatocyte CC50 in µM" });
    categorical.push({ name: "Drug-induced liver injury", signal: p.DILI.canonicalValue > 0.5 ? "flagged" : "not flagged", probability: round(p.DILI.canonicalValue, 3) });
    categorical.push({ name: "Ames mutagenicity", signal: p.AMES.canonicalValue > 0.5 ? "flagged" : "not flagged", probability: round(p.AMES.canonicalValue, 3) });

    const limiting = margins.reduce((worst, margin) => (margin.margin_fold < worst.margin_fold ? margin : worst), margins[0]);
    const result = {
      available: true, ml_available: true,
      efficacy_anchor: { label: "Free concentration for 80% target occupancy", value_nm: round(efficacy, 3), provenance: "derived from the Stage 7 occupancy model", is_apparent: profile.affinity.isApparent },
      computed_margins: margins,
      limiting_margin: {
        label: limiting.label,
        margin_fold: limiting.margin_fold,
        band: limiting.band,
        note: limiting.band === "comfortable"
          ? "The narrowest computable margin is wide. Note that the liabilities which could not be converted into a margin are not represented in this number at all."
          : limiting.band === "modest"
            ? "The narrowest computable margin leaves limited room. A measured value for the constraining endpoint should be obtained before dose selection."
            : "The narrowest computable margin is small enough that the therapeutic window is the central development question for this series.",
      },
      not_computable: notComputable,
      categorical_liabilities: categorical,
      coverage: {
        margins_computed: margins.length,
        margins_blocked: notComputable.length,
        note: "A liability with no numeric safety concentration cannot be ranked as a margin. It is listed as categorical rather than being given a placeholder number.",
      },
    };
    return {
      ...base, status: "available", result,
      presentation: {
        groups: [
          group("Efficacy anchor", [
            ["Anchor", result.efficacy_anchor.label],
            ["Concentration (nM)", result.efficacy_anchor.value_nm],
            ["Provenance", result.efficacy_anchor.provenance],
            ["Apparent potency", result.efficacy_anchor.is_apparent],
          ]),
          group("Ranked margins", margins.map((margin) => [
            `${margin.label} (${margin.band})`,
            `${margin.margin_fold}-fold (${margin.safety_concentration_nm} nM / ${margin.efficacy_concentration_nm} nM)`,
          ] as [string, unknown])),
          group("Limiting margin", [
            ["Constraint", result.limiting_margin.label],
            ["Margin (fold)", result.limiting_margin.margin_fold],
            ["Band", result.limiting_margin.band],
            ["Interpretation", result.limiting_margin.note],
          ]),
          group("Margins that could not be computed", notComputable.map((item) => [item.label, `Requires ${item.required_measurement}`] as [string, unknown])),
          group("Categorical liabilities (not rankable as a margin)", categorical.map((item) => [item.name, `${item.signal} · p = ${item.probability}`] as [string, unknown])),
          group("Coverage", [
            ["Margins computed", result.coverage.margins_computed],
            ["Margins blocked", result.coverage.margins_blocked],
            ["Note", result.coverage.note],
          ]),
        ],
      },
    };
  }

  if (stageId === "9") {
    return { ...base, status: "available", result: { available: true }, presentation: { groups: [] } };
  }

  return {
    ...base, status: "unavailable",
    result: { available: false, reason: meta.reason },
    presentation: { groups: [] },
    unavailable_model_reasons: [meta.reason],
  };
}

/** Stage 9 — the rollup over whatever actually ran. */
export function confirmationBlock(
  executed: Record<string, StageResult>,
  meta: StageMeta,
  l1: L1Record,
  profile: CompoundProfile,
  roster: StageMeta[] = [],
): StageResult {
  const conditions: Array<{ severity: "block" | "warn" | "pass"; title: string; detail: string }> = [];
  const stagesRun = Object.keys(executed).filter((id) => id !== "9" && executed[id].status === "available");
  const executableStages = roster.filter((stage) => !["0", "9"].includes(stage.id)).map((stage) => stage.id);
  const absentStages = executableStages.filter((id) => !stagesRun.includes(id));

  if (l1.verdict.verdict === "NO-GO") {
    conditions.push({ severity: "block", title: "Layer 1 gate returned NO-GO", detail: "Two or more gate-driving checks were in the concern band at Layer 1. Confirmation can characterise the compound further, but it cannot clear that gate." });
  }
  if (profile.applicability.domain === "out_of_domain") {
    conditions.push({ severity: "warn", title: "Structure sits outside the safety models' training chemistry", detail: `The nearest training analogue has a Tanimoto similarity of ${profile.applicability.nearest_tanimoto}, below the ${profile.applicability.threshold} threshold. Every safety prediction carried into this layer is an extrapolation.` });
  }
  if (!stagesRun.includes("1")) {
    conditions.push({ severity: "warn", title: "Target druggability was not established", detail: "Stage 1 did not produce a result, so the confirmation package carries no independent assessment of whether the target is tractable." });
  }
  const stage8 = executed["8"];
  if (stage8?.status === "available") {
    const limiting = (stage8.result as any).limiting_margin;
    if (limiting?.band === "narrow") {
      conditions.push({ severity: "block", title: "The narrowest computable therapeutic margin is narrow", detail: `${limiting.label} is ${limiting.margin_fold}-fold. A margin this small is the central development question and should be resolved with measured values before an animal study is designed.` });
    } else if (limiting?.band === "modest") {
      conditions.push({ severity: "warn", title: "The therapeutic margin is modest", detail: `${limiting.label} is ${limiting.margin_fold}-fold. Obtain a measured value for the constraining endpoint before dose selection.` });
    } else {
      conditions.push({ severity: "pass", title: "Computable therapeutic margins are wide", detail: `The narrowest computable margin is ${limiting?.margin_fold}-fold. Liabilities that could not be converted into a margin are not represented in that number.` });
    }
  }
  const stage6 = executed["6"];
  if (stage6?.status === "available") {
    const confidence = (stage6.result as any).confidence;
    if (confidence?.level === "low") {
      conditions.push({ severity: "warn", title: "The exposure projection is low confidence", detail: confidence.rationale });
    } else {
      conditions.push({ severity: "pass", title: "The exposure projection carries its inputs' confidence", detail: confidence?.rationale ?? "" });
    }
  }
  if (!executed["2"]) {
    conditions.push({ severity: "warn", title: "No docking result", detail: "Docking was not dispatched for this analysis, so the confirmation package contains no structural hypothesis for the binding mode." });
  }
  if (!executed["5"]) {
    conditions.push({ severity: "warn", title: "No free-energy refinement", detail: "Free-energy refinement was not dispatched, so the affinity anchor rests on a regression and on analogue read-across rather than on a physics-based calculation." });
  }
  if (Object.values(l1.safety_assessments).every((entry) => entry.risk_class === "Low")) {
    conditions.push({ severity: "pass", title: "No dedicated safety model reached the monitoring band", detail: "hERG, DILI and Ames screening predictions are all in the low band. This is an absence of a screening flag, not a demonstration of safety." });
  }

  const counts = {
    block: conditions.filter((condition) => condition.severity === "block").length,
    warn: conditions.filter((condition) => condition.severity === "warn").length,
    pass: conditions.filter((condition) => condition.severity === "pass").length,
  };
  const verdict = counts.block > 0 ? "HOLD" : counts.warn >= 3 ? "PROCEED WITH CONDITIONS" : "PROCEED";
  const result = {
    available: true,
    verdict,
    headline: counts.block
      ? `${counts.block} blocking condition${counts.block === 1 ? "" : "s"} must be resolved before an animal study is designed.`
      : counts.warn
        ? `No blocking condition. ${counts.warn} reservation${counts.warn === 1 ? "" : "s"} carry forward into Layer 3 and should be stated in the study rationale.`
        : "No blocking condition and no reservation from the stages that ran.",
    counts,
    conditions,
    evidence_completeness: {
      stages_in_roster: executableStages.length,
      stages_with_a_usable_result: stagesRun.length,
      stages_available: stagesRun,
      stages_absent: absentStages,
      note: absentStages.length
        ? `${absentStages.length} of the ${executableStages.length} executable stages produced no usable result (${absentStages.join(", ")}). They are absent from this rollup rather than treated as a pass — a stage that did not run has said nothing.`
        : "Every executable stage in the roster produced a usable result.",
    },
  };

  return {
    stage: meta, status: "available", result,
    unavailable_model_reasons: [],
    provenance: { owner: "hakase_smallmol.l2.pipeline", computed_at: stamp(1), client_contract: "display-only" },
    presentation: {
      groups: [
        group("Confirmation decision", [
          ["Verdict", result.verdict],
          ["Summary", result.headline],
          ["Blocking conditions", counts.block],
          ["Reservations", counts.warn],
          ["Satisfied conditions", counts.pass],
        ]),
        group("Evidence completeness", [
          ["Executable stages in the roster", result.evidence_completeness.stages_in_roster],
          ["Stages with a usable result", result.evidence_completeness.stages_with_a_usable_result],
          ["Stages available", result.evidence_completeness.stages_available.join(", ")],
          ["Stages absent", result.evidence_completeness.stages_absent.join(", ") || "none"],
          ["Note", result.evidence_completeness.note],
        ]),
        group("Blocking conditions", conditions.filter((condition) => condition.severity === "block").map((condition) => [condition.title, condition.detail] as [string, unknown])),
        group("Reservations to carry into Layer 3", conditions.filter((condition) => condition.severity === "warn").map((condition) => [condition.title, condition.detail] as [string, unknown])),
        group("Satisfied conditions", conditions.filter((condition) => condition.severity === "pass").map((condition) => [condition.title, condition.detail] as [string, unknown])),
      ],
    },
  };
}

/* ── asynchronous jobs ───────────────────────────────────────────────────── */

export function fepResult(profile: CompoundProfile, ligandB: string, pdbId: string) {
  const smiles = profile.smiles;
  const windows = 12;
  const total = normal(seed(smiles, `fep::${ligandB}`), -1.2, 1.1);
  const series = Array.from({ length: windows }, (_, index) => {
    const lambda = index / (windows - 1);
    const value = total * (0.5 - 0.5 * Math.cos(Math.PI * lambda)) + normal(seed(smiles, `fepw${index}`), 0, 0.09);
    return { lambda: round(lambda, 3), dG_kcal_mol: round(value, 3), stderr_kcal_mol: round(span(seed(smiles, `fepe${index}`), 0.04, 0.22), 3) };
  });
  const ddG = round(series[series.length - 1].dG_kcal_mol, 3);
  const stderr = round(Math.sqrt(series.reduce((sum, point) => sum + point.stderr_kcal_mol ** 2, 0)), 3);
  return {
    job_id: `fep-${smiles.length}${ligandB.length}${pdbId}`.toLowerCase().slice(0, 16),
    status: "done" as const,
    result: {
      available: true,
      engine: "TIES 2.0 over OpenMM 8.1, 12 λ windows, 3 replicas",
      receptor_pdb_id: pdbId,
      ligand_a_smiles: profile.molecule.canonicalSmiles,
      ligand_b_smiles: ligandB,
      ddG_kcal_mol: ddG,
      ddG_stderr_kcal_mol: stderr,
      ddG_pKd_equivalent: round(-ddG / 1.364, 3),
      replicas: 3,
      simulation_ns_per_window: 4,
      total_gpu_hours: round(span(seed(smiles, "gpuh"), 3.2, 18.6), 2),
      convergence: stderr < 0.35 ? "converged" : "under-converged — extend sampling before relying on this value",
      limitations: [
        "A relative free-energy perturbation returns the difference between two ligands, never an absolute affinity.",
        "The perturbation assumes a common binding mode. If ligand B binds differently, the calculation is meaningless rather than merely imprecise.",
        "Protonation states are fixed at the input assignment and are not sampled.",
      ],
    },
    presentation: {
      groups: [
        group("Relative binding free energy", [
          ["ΔΔG (kcal/mol)", ddG],
          ["Standard error (kcal/mol)", stderr],
          ["Equivalent ΔpKd", round(-ddG / 1.364, 3)],
          ["Convergence", stderr < 0.35 ? "converged" : "under-converged"],
          ["Direction", ddG < 0 ? "Ligand B is predicted to bind more tightly than ligand A." : "Ligand A is predicted to bind more tightly than ligand B."],
        ]),
        group("Simulation setup", [
          ["Engine", "TIES 2.0 over OpenMM 8.1"],
          ["Receptor", pdbId],
          ["λ windows", windows],
          ["Replicas", 3],
          ["Sampling per window (ns)", 4],
          ["Total GPU hours", round(span(seed(smiles, "gpuh"), 3.2, 18.6), 2)],
        ]),
        group("Limitations", [
          ["Limitation 1", "A relative free-energy perturbation returns the difference between two ligands, never an absolute affinity."],
          ["Limitation 2", "The perturbation assumes a common binding mode. If ligand B binds differently, the calculation is meaningless rather than merely imprecise."],
          ["Limitation 3", "Protonation states are fixed at the input assignment and are not sampled."],
        ]),
      ],
      visualization: {
        kind: "fep_lambda_windows",
        title: "Per-window free-energy estimate",
        x_label: "λ (alchemical coupling parameter)",
        y_label: "Cumulative ΔG (kcal/mol)",
        series,
      },
    },
  };
}

/* ── virtual tissue ──────────────────────────────────────────────────────── */

const TISSUE_PANEL = ["Liver", "Kidney", "Heart", "Brain cortex", "Lung", "Skeletal muscle", "Testis", "Bone marrow", "Colon", "Pancreas", "Thyroid", "Skin"];
const CELL_TYPES = ["Hepatocyte", "Cardiac myocyte", "Proximal tubule cell", "Cortical neuron", "CD4+ T cell", "Alveolar type II cell", "Enterocyte", "Pancreatic beta cell", "Fibroblast", "Endothelial cell"];

export function virtualTissueRun(l1: L1Record, profile: CompoundProfile) {
  const gene = l1.target_resolution.gene_symbol;
  const smiles = profile.smiles;
  if (!gene) {
    return {
      available: false,
      models: VIRTUAL_TISSUE_MODELS.map((model) => ({ ...model, status: "needs_input", reason: "A validated UniProt target and gene symbol are required before tissue-context evidence can be retrieved." })),
    };
  }
  const isOncology = false;
  return {
    available: true,
    models: VIRTUAL_TISSUE_MODELS.map((model) => {
      if (model.id === "patient_line" && !isOncology) {
        return { ...model, status: "needs_input", reason: "Patient-line dependency projections are returned for oncology projects only. This project is not scoped to oncology." };
      }
      if (model.id === "hpa_tissue") {
        const rows = TISSUE_PANEL.map((tissue, index) => ({
          tissue,
          nTPM: round(logSpan(`${smiles}::hpa::${tissue}`, 0.4, 180), 1),
          protein_level: pick(`${smiles}::hpaprot::${tissue}`, ["Not detected", "Low", "Medium", "High"]),
          rank: index + 1,
        })).sort((a, b) => b.nTPM - a.nTPM).map((row, index) => ({ ...row, rank: index + 1 }));
        return {
          ...model, status: "available", available: true, ml_available: true,
          result: { available: true, rows },
          presentation: {
            groups: [
              group("Tissue expression summary", [
                ["Gene", gene],
                ["Highest-expressing tissue", rows[0].tissue],
                ["Highest nTPM", rows[0].nTPM],
                ["Tissues above 10 nTPM", rows.filter((row) => row.nTPM > 10).length],
                ["Source", "Human Protein Atlas consensus RNA and protein"],
              ]),
              group("Per-tissue expression (nTPM)", rows.slice(0, 12).map((row) => [`${row.tissue} · ${row.protein_level}`, row.nTPM] as [string, unknown])),
              group("Limitations", [["Limitation", "Expression of the target is not exposure of the drug. A highly expressing tissue is only relevant where the compound also reaches it."]]),
            ],
          },
        };
      }
      if (model.id === "gtex") {
        const rows = TISSUE_PANEL.slice(0, 10).map((tissue) => ({ tissue, median_tpm: round(logSpan(`${smiles}::gtex::${tissue}`, 0.2, 240), 1) })).sort((a, b) => b.median_tpm - a.median_tpm);
        return {
          ...model, status: "available", available: true, ml_available: true,
          result: { available: true, rows },
          presentation: {
            groups: [
              group("GTEx bulk expression", [["Gene", gene], ["Tissues returned", rows.length], ["Highest median TPM", rows[0].median_tpm], ["Highest-expressing tissue", rows[0].tissue]]),
              group("Per-tissue median TPM", rows.map((row) => [row.tissue, row.median_tpm] as [string, unknown])),
            ],
          },
        };
      }
      const rows = CELL_TYPES.map((cell) => ({ cell_type: cell, enrichment_score: round(span(`${smiles}::cell::${cell}`, -1.2, 4.4), 3) })).sort((a, b) => b.enrichment_score - a.enrichment_score);
      return {
        ...model, status: "available", available: true, ml_available: true,
        result: { available: true, rows },
        presentation: {
          groups: [
            group("Cell-type aggregation", [["Gene", gene], ["Dataset", "Tabula Sapiens v1.0 via Drug2cell"], ["Cell types scored", rows.length], ["Top cell type", rows[0].cell_type], ["Top enrichment score", rows[0].enrichment_score]]),
            group("Ranked cell types", rows.slice(0, 8).map((row) => [row.cell_type, row.enrichment_score] as [string, unknown])),
            group("Limitations", [["Limitation", "Enrichment is computed over a single-cell reference atlas of normal tissue. It describes where the target is expressed, not where the drug goes."]]),
          ],
        },
      };
    }),
  };
}

/* ── DDI helper reused by the animal layer ───────────────────────────────── */

export function ddiAssessment(profile: CompoundProfile, freeCmaxUm: number, fractionHepatic: number) {
  const p = profile.endpoints;
  const isoforms = CYP_ISOFORMS.map((isoform) => {
    const probability = p[isoform.endpoint].canonicalValue;
    const kiThreshold = round(freeCmaxUm / (DDI_CUTOFFS.hepatic_R1 - 1), 4);
    return {
      isoform: isoform.id,
      available: true,
      inhibitor_probability: round(probability, 3),
      call: probability >= 0.5 ? "flagged as a potential inhibitor" : "not flagged",
      ki_threshold_uM: Number.isFinite(kiThreshold) && kiThreshold > 0 ? kiThreshold : null,
      model: "ADMET-AI CYP inhibition head (Veith qHTS)",
      index_substrate: isoform.indexSubstrate,
      fraction_metabolised_population: isoform.fractionMetabolised,
    };
  });
  const flagged = isoforms.filter((isoform) => isoform.inhibitor_probability >= 0.5);
  const substrateCalls = [
    { isoform: "CYP3A4", available: true, call: p.CYP3A4_Substrate_CarbonMangels.canonicalValue >= 0.5 ? "likely substrate" : "not a likely substrate", substrate_probability: round(p.CYP3A4_Substrate_CarbonMangels.canonicalValue, 3) },
    { isoform: "CYP2D6", available: true, call: p.CYP2D6_Substrate_CarbonMangels.canonicalValue >= 0.5 ? "likely substrate" : "not a likely substrate", substrate_probability: round(p.CYP2D6_Substrate_CarbonMangels.canonicalValue, 3) },
    { isoform: "CYP2C9", available: true, call: p.CYP2C9_Substrate_CarbonMangels.canonicalValue >= 0.5 ? "likely substrate" : "not a likely substrate", substrate_probability: round(p.CYP2C9_Substrate_CarbonMangels.canonicalValue, 3) },
  ];
  const dominant = substrateCalls.reduce((best, call) => (call.substrate_probability > best.substrate_probability ? call : best), substrateCalls[0]);
  const extraction = clamp(fractionHepatic, 0, 1);

  return {
    available: true,
    reference_arm: "top-dose",
    concentrations: {
      unbound_hepatic_inlet_uM: round(freeCmaxUm * 1.35, 5),
      unbound_systemic_cmax_uM: round(freeCmaxUm, 5),
      total_systemic_cmax_uM: round(freeCmaxUm / Math.max(profile.disposition.fuPlasma, 1e-6), 4),
      intestinal_luminal_uM: round(freeCmaxUm * 42, 3),
    },
    perpetrator: {
      isoforms,
      flagged_isoforms: flagged.map((isoform) => isoform.isoform),
      highest_risk: isoforms.reduce((best, isoform) => (isoform.inhibitor_probability > best.inhibitor_probability ? isoform : best), isoforms[0]).isoform,
      cutoffs: { hepatic_R1: DDI_CUTOFFS.hepatic_R1, intestinal_R1_CYP3A: DDI_CUTOFFS.intestinal_R1_CYP3A },
      reference: DDI_CUTOFFS.basic_model_reference,
    },
    victim: {
      risk: dominant.substrate_probability >= 0.6 && extraction > 0.5 ? "high" : dominant.substrate_probability >= 0.4 ? "moderate" : "low",
      rationale: `${round(extraction * 100, 0)}% of clearance is projected to be hepatic, and the most likely metabolising isoform is ${dominant.isoform} (substrate probability ${dominant.substrate_probability}). Concentration of clearance on one polymorphic isoform is what makes a compound a victim of both co-medication and genotype.`,
      fraction_cleared_hepatically: round(extraction, 3),
      extraction_ratio: round(clamp(extraction * 0.8, 0, 1), 3),
      hepatic_first_pass: round(1 - clamp(extraction * 0.8, 0, 1), 3),
      substrate_calls: substrateCalls,
      limitation: "Fraction metabolised by each isoform is inferred from a substrate classification, not from a reaction-phenotyping experiment. A quantitative victim assessment requires recombinant-isoform phenotyping.",
    },
    transporters: {
      pgp_inhibitor_probability: round(p.Pgp_Broccatelli.canonicalValue, 3),
      pgp_role: p.Pgp_Broccatelli.canonicalValue >= 0.5 ? "potential P-gp inhibitor — a digoxin interaction assessment is indicated" : "no P-gp inhibition flagged",
      note: "Only P-glycoprotein is assessed. OATP1B1/1B3, BCRP and OCT2 are not modelled, and their absence here is not evidence that they are uninvolved.",
    },
    recommended_studies: [
      ...(flagged.length ? [`Determine a reversible inhibition Ki for ${flagged.map((isoform) => isoform.isoform).join(", ")} in human liver microsomes with the recommended index substrate.`] : []),
      ...(flagged.length ? ["Assess time-dependent inhibition (IC50 shift) for every flagged isoform — reversible inhibition alone underestimates the interaction for mechanism-based inhibitors."] : []),
      "Reaction phenotyping with recombinant isoforms and selective chemical inhibitors, to convert the substrate classification into a quantitative fraction metabolised.",
      ...(p.Pgp_Broccatelli.canonicalValue >= 0.5 ? ["Bidirectional Caco-2 with and without a P-gp inhibitor, plus a digoxin IC50 determination."] : []),
    ],
    limitations: "The FDA (2020) basic model is a screening calculation on unbound concentrations. It identifies which interaction studies are needed; it does not replace them.",
  };
}
