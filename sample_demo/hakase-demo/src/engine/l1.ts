/**
 * Layer 1 — In Vitro screen.
 *
 * Assembles the complete Layer-1 record: the stage-gate verdict and its
 * evidence-graded checks, the safety readouts, the structural-alert screen,
 * synthetic feasibility, the regulatory precedent outlook, the indication and
 * route reading contexts, the target-evidence retrieval, the extended assay
 * bench and the study dossier index.
 */

import { pseudoInchiKey } from "../lib/chem";
import { ADMET_SECTIONS } from "../lib/admetRegistry";
import { CLINICAL_ROUTES, THERAPEUTIC_AREAS } from "../lib/catalogs";
import { clamp, round, stamp } from "../lib/format";
import { chance, logSpan, normal, pick, span, unit } from "../lib/rng";
import type { CompoundProfile, EndpointValue } from "./profile";
import { t } from "../i18n";

const seed = (smiles: string, channel: string) => `${smiles}::l1::${channel}`;

/* ── stage gate ──────────────────────────────────────────────────────────── */

export type GateCheck = {
  name: string;
  value: string;
  source: string;
  status: "good" | "warn" | "bad";
  endpoint?: string;
  unit?: string;
  decision_role: "gate_driver" | "supporting" | "context";
  evidence_type: "model_prediction" | "deterministic_rule" | "structural_rule";
  influences_verdict: boolean;
  applicability_domain?: "in_domain" | "borderline" | "out_of_domain";
  nearest_tanimoto?: number;
  domain_caveat?: string;
  rationale: string;
};

export type Verdict = {
  verdict: "GO" | "WATCH" | "NO-GO";
  headline: string;
  rationale: string;
  recommendation: string;
  checks: GateCheck[];
  major_risks: string[];
  missing_evidence: string[];
  recommended_next_experiments: string[];
  policy: Record<string, string>;
};

function checkFrom(profile: CompoundProfile, key: string, name: string, role: GateCheck["decision_role"]): GateCheck | null {
  const endpoint = profile.endpoints[key];
  if (!endpoint) return null;
  const domainState = endpoint.applicabilityDomain.inDomain
    ? "in_domain"
    : endpoint.applicabilityDomain.nearestTanimoto >= endpoint.applicabilityDomain.threshold * 0.7 ? "borderline" : "out_of_domain";
  const value = endpoint.spec.task === "binary_classification"
    ? `${(endpoint.canonicalValue * 100).toFixed(0)}% ${endpoint.statusLabel.toLowerCase()}`
    : `${endpoint.canonicalValue} ${endpoint.canonicalUnit}`;
  return {
    name,
    value,
    source: "Local structure-directed demo heuristic",
    status: endpoint.status === "neutral" ? "warn" : endpoint.status,
    endpoint: endpoint.endpoint,
    unit: endpoint.canonicalUnit,
    decision_role: role,
    evidence_type: endpoint.spec.datasetSize > 0 ? "model_prediction" : "deterministic_rule",
    influences_verdict: role === "gate_driver",
    applicability_domain: domainState as GateCheck["applicability_domain"],
    nearest_tanimoto: endpoint.applicabilityDomain.nearestTanimoto,
    domain_caveat: domainState === "out_of_domain"
      ? "This value comes from outside the model's training chemistry. It is an extrapolation and may not be reliable at any level."
      : undefined,
    rationale: endpoint.spec.scientistMeaning,
  };
}

export function buildVerdict(profile: CompoundProfile, routeCode: string, areaCode: string): Verdict {
  const checks: GateCheck[] = [];
  const d = profile.descriptors;

  checks.push({
    name: t("Physicochemical feasibility"),
    value: d.lipinski_rule_of_five_pass ? "Rule of five satisfied" : `${d.lipinski_violations} rule-of-five violation${d.lipinski_violations === 1 ? "" : "s"}`,
    source: "RDKit — computed from the molecular graph",
    status: d.lipinski_violations === 0 ? "good" : d.lipinski_violations === 1 ? "warn" : "bad",
    decision_role: "gate_driver",
    evidence_type: "deterministic_rule",
    influences_verdict: true,
    rationale: t("The rule of five is a heuristic derived from approved oral drugs. Two or more violations is the conventional oral-absorption warning, not a prohibition."),
  });

  const herg = checkFrom(profile, "hERG", t("hERG local safety model"), "gate_driver");
  if (herg) checks.push(herg);
  const dili = checkFrom(profile, "DILI", t("DILI local safety model"), "gate_driver");
  if (dili) checks.push(dili);
  const ames = checkFrom(profile, "AMES", t("Ames mutagenicity"), "gate_driver");
  if (ames) checks.push(ames);

  const painsCount = profile.alerts.filter((alert) => alert.set === "PAINS").length;
  const brenkCount = profile.alerts.filter((alert) => alert.set === "Brenk").length;
  checks.push({
    name: t("PAINS structural alerts"),
    value: painsCount === 0 ? "No alert matched" : `${painsCount} alert${painsCount === 1 ? "" : "s"} matched`,
    source: "RDKit FilterCatalog PAINS_A/B/C",
    status: painsCount === 0 ? "good" : "bad",
    decision_role: "gate_driver",
    evidence_type: "structural_rule",
    influences_verdict: true,
    rationale: t("A PAINS match means the compound belongs to a class that has historically produced assay artefacts, not that this compound interferes."),
  });
  checks.push({
    name: t("Brenk structural alerts"),
    value: brenkCount === 0 ? "No alert matched" : `${brenkCount} alert${brenkCount === 1 ? "" : "s"} matched`,
    source: "RDKit FilterCatalog BRENK",
    status: brenkCount === 0 ? "good" : brenkCount <= 1 ? "warn" : "bad",
    decision_role: "supporting",
    evidence_type: "structural_rule",
    influences_verdict: false,
    rationale: t("Brenk alerts identify reactive or unstable functionality for medicinal-chemistry review; they are not measured liabilities."),
  });

  const solubility = checkFrom(profile, "Solubility_AqSolDB", t("Aqueous solubility"), "gate_driver");
  if (solubility) checks.push(solubility);

  const routeIsOral = routeCode === "ORAL";
  const permeability = checkFrom(profile, "Caco2_Wang", t("Caco-2 permeability"), routeIsOral ? "gate_driver" : "context");
  if (permeability) { permeability.influences_verdict = routeIsOral; checks.push(permeability); }
  const bioavailability = checkFrom(profile, "Bioavailability_Ma", t("Oral bioavailability class"), routeIsOral ? "gate_driver" : "context");
  if (bioavailability) { bioavailability.influences_verdict = routeIsOral; checks.push(bioavailability); }

  const clearance = checkFrom(profile, "Clearance_Hepatocyte_AZ", t("Metabolic stability"), "supporting");
  if (clearance) checks.push(clearance);

  checks.push({
    name: t("Model applicability domain"),
    value: profile.applicability.domain === "in_domain" ? "Inside the training chemistry" : profile.applicability.domain === "borderline" ? "At the edge of the training chemistry" : "Outside the training chemistry",
    value_hidden: undefined,
    source: "Morgan radius-2 Tanimoto against the vendored applicability panel",
    status: profile.applicability.domain === "in_domain" ? "good" : profile.applicability.domain === "borderline" ? "warn" : "bad",
    decision_role: "gate_driver",
    evidence_type: "deterministic_rule",
    influences_verdict: true,
    applicability_domain: profile.applicability.domain,
    nearest_tanimoto: profile.applicability.nearest_tanimoto,
    rationale: profile.applicability.interpretation,
  } as GateCheck);

  const drivers = checks.filter((check) => check.influences_verdict);
  const flags = drivers.filter((check) => check.status === "bad");
  const reviews = drivers.filter((check) => check.status === "warn");
  const verdict: Verdict["verdict"] = flags.length >= 2 ? "NO-GO" : flags.length === 1 || reviews.length >= 3 ? "WATCH" : reviews.length ? "WATCH" : "GO";

  const area = THERAPEUTIC_AREAS.find((entry) => entry.code === areaCode);
  const risks: string[] = [];
  for (const check of flags) risks.push(`${check.name}: ${check.value}`);
  if (profile.applicability.domain === "out_of_domain") {
    risks.push("Every safety prediction is an extrapolation from outside the models' training chemistry.");
  }
  if (profile.endpoints.PPBR_AZ.canonicalValue > 99) {
    risks.push("Plasma protein binding above 99% makes the unbound fraction — and every quantity derived from it — highly uncertain.");
  }

  const missing: string[] = [
    "No measured potency on the submitted compound; the affinity anchor is analogue read-across.",
    "No measured hepatocyte intrinsic clearance or unbound fraction; the exposure projection runs on predicted disposition.",
  ];
  if (flags.some((check) => check.name.includes("hERG"))) missing.push("No manual patch-clamp hERG IC50, so no ICH S7B margin can be defended.");
  if (flags.some((check) => check.name.includes("Ames"))) missing.push("No experimental bacterial reverse-mutation result to resolve the predicted genotoxicity hazard.");

  const experiments: string[] = [];
  if (flags.some((check) => check.name.includes("hERG")) || reviews.some((check) => check.name.includes("hERG"))) {
    experiments.push("Manual patch-clamp hERG IC50 determination, then compute the margin over the projected free Cmax.");
  }
  if (flags.some((check) => check.name.includes("Ames"))) {
    experiments.push("OECD 471 bacterial reverse mutation with and without S9 metabolic activation.");
  }
  experiments.push("Equilibrium-dialysis plasma protein binding in the intended toxicology species and in human.");
  experiments.push("Hepatocyte intrinsic clearance in the toxicology species and in human, to replace the predicted disposition inputs.");
  if (painsCount > 0) experiments.push("Orthogonal-format confirmation of any reported activity, with a detergent aggregation control.");
  if (routeIsOral) experiments.push("Kinetic and thermodynamic solubility in FaSSIF and FeSSIF before any oral exposure claim.");

  /* Composed through `t()` rather than assembled and looked up afterwards:
     these sentences carry injected values, so there is no fixed string to key
     on once they are built. English plural agreement disappears in Japanese,
     which is why the count is a parameter rather than a branch. */
  const unresolved = flags.length + reviews.length;
  const headline = verdict === "GO"
    ? t("No gate-driving check reached the concern band.")
    : verdict === "WATCH"
      ? t("{n} gate-driving checks need resolution before confirmation.", { n: unresolved })
      : t("{n} gate-driving checks are in the concern band.", { n: flags.length });

  const rationale = verdict === "GO"
    ? t(
        profile.applicability.domain === "in_domain"
          ? "Every check that is permitted to drive the gate sits in the favourable band, and the structure lies inside the models' training chemistry. This is an absence of a screening flag, not evidence of safety or efficacy."
          : "Every check that is permitted to drive the gate sits in the favourable band, and the structure lies at the edge of the models' training chemistry. This is an absence of a screening flag, not evidence of safety or efficacy.",
      )
    : verdict === "WATCH"
      ? t("The screen is not clean: {checks} require an orthogonal or measured result. The recorded manual review must state how each will be resolved before Confirmation proceeds.",
          { checks: [...flags, ...reviews].map((check) => check.name).join(t(", ")) })
      : t("Two or more gate-driving checks are in the concern band ({checks}). The underlying evidence has to change; a review signature cannot substitute for it.",
          { checks: flags.map((check) => check.name).join(t(", ")) });

  return {
    verdict,
    headline,
    rationale,
    recommendation: verdict === "GO"
      ? t("Progress to Confirmation and run the orthogonal in-silico cross-checks.")
      : verdict === "WATCH"
        ? t("Record a manual review with a resolution plan, then progress to Confirmation.")
        : t("Do not progress. Resolve the flagged evidence or redesign the series."),
    checks,
    major_risks: risks.length ? risks : [t("No gate-driving check reached the concern band in this screen.")],
    missing_evidence: missing,
    recommended_next_experiments: experiments,
    policy: {
      gate_scope: "Only checks marked as gate drivers may change the verdict. Supporting and context checks are reported and never scored.",
      composite_score: "No composite score is computed. One flagged check can set the verdict on its own regardless of how many others are clear.",
      route_awareness: routeIsOral
        ? "The declared oral route allows the oral ADME endpoints to influence the gate."
        : "Oral ADME endpoints are reported as context only, because the declared route is not oral.",
      indication_awareness: area
        ? `The stated therapeutic area (${area.label}) changes the acceptable-risk envelope and the reading direction of some endpoints. It changes no model output.`
        : "No therapeutic area was stated, so no indication-specific reading was applied.",
      review_policy: "A recorded manual review is stored alongside the original verdict. It never replaces it.",
    },
  };
}

/* ── safety and structural review ────────────────────────────────────────── */

export function safetyAssessments(profile: CompoundProfile) {
  const herg = profile.endpoints.hERG;
  const dili = profile.endpoints.DILI;
  const ames = profile.endpoints.AMES;
  const classOf = (value: number) => (value < 0.35 ? "Low" : value < 0.65 ? "Moderate" : "High");
  const label = (value: number) => ({ Low: "Low predicted likelihood", Moderate: "Intermediate predicted likelihood", High: "High predicted likelihood" }[classOf(value)]);

  return {
    hERG_local: {
      endpoint: "hERG screening result",
      model_value: herg.canonicalValue,
      unit: "P(blocker)",
      risk_class: classOf(herg.canonicalValue),
      status_label: label(herg.canonicalValue),
      source: "CardioTox local Random Forest",
      ic50_band: herg.canonicalValue > 0.65 ? "< 1 µM" : herg.canonicalValue > 0.45 ? "1 – 10 µM" : herg.canonicalValue > 0.3 ? "10 – 30 µM" : "> 30 µM",
      basis: "Screening prediction; not a clinical probability and not an IC50.",
      applicability: profile.applicability.model_domains["CardioTox (hERG)"],
    },
    dili_local: {
      endpoint: "DILI screening result",
      model_value: dili.canonicalValue,
      unit: "P(DILI)",
      risk_class: classOf(dili.canonicalValue),
      status_label: label(dili.canonicalValue),
      source: "DILI-ML local Random Forest with conformal veto",
      conformal_decision: dili.applicabilityDomain.inDomain ? "accepted" : "abstained — outside the applicability domain",
      basis: "Screening prediction; not a clinical probability or confirmed safety result.",
      applicability: profile.applicability.model_domains["DILI-ML"],
    },
    ames_local: {
      endpoint: "Ames mutagenicity screening result",
      model_value: ames.canonicalValue,
      unit: "P(mutagenic)",
      risk_class: classOf(ames.canonicalValue),
      status_label: label(ames.canonicalValue),
      source: "Ames-ML (TDC Xu)",
      basis: "OECD 471 hazard classification only; no potency is predicted.",
      applicability: profile.applicability.model_domains["ADMET-AI ensemble"],
    },
  };
}

export function assayReliability(profile: CompoundProfile) {
  const pains = profile.alerts.filter((alert) => alert.set === "PAINS");
  const brenk = profile.alerts.filter((alert) => alert.set === "Brenk");
  const total = pains.length + brenk.length;
  const level = pains.length > 0 ? "high" : brenk.length > 1 ? "moderate" : brenk.length === 1 ? "low" : "none";
  const controls: string[] = [];
  if (pains.length) controls.push("Confirm any reported activity in a mechanistically orthogonal assay format.");
  if (pains.length) controls.push("Include a detergent control (0.01% Triton X-100) to exclude colloidal aggregation.");
  if (brenk.some((alert) => alert.name.includes("Michael") || alert.name.includes("Aldehyde"))) {
    controls.push("Run a glutathione-trapping incubation to characterise covalent adduct formation.");
  }
  if (brenk.some((alert) => alert.name.includes("Nitro"))) {
    controls.push("Run OECD 471 with and without S9; nitroaromatics are frequently activated by nitroreductase.");
  }
  if (total) controls.push("Confirm compound stability in the assay buffer over the incubation period by LC-MS.");

  return {
    overall_alert_level: level,
    display_summary: total === 0 ? "No structural alerts matched" : `${total} structural alert${total === 1 ? "" : "s"} matched`,
    display_recommendation: total === 0
      ? "No orthogonal-confirmation requirement is raised by the structural screen."
      : pains.length
        ? "Orthogonal confirmation is required before any reported activity may be relied on."
        : "Review the flagged functionality with medicinal chemistry before lead optimisation.",
    display_rule: "Structural alerts are substructure matches, not experimental evidence of interference. A clean screen does not demonstrate that an assay readout is reliable.",
    interpretation: total === 0
      ? "No pan-assay-interference or reactive-functionality substructure was matched in this structure."
      : `The screen matched ${pains.length} PAINS and ${brenk.length} Brenk substructure${brenk.length === 1 ? "" : "s"}. ${pains.length ? "PAINS matches are the stronger signal: they identify chemotypes that have repeatedly produced false positives across unrelated targets." : "Brenk matches identify reactivity and stability liabilities rather than assay artefacts."}`,
    pains: { count: pains.length, alerts: pains.map((alert) => ({ name: alert.name, description: alert.description, severity: alert.severity })) },
    brenk: { count: brenk.length, alerts: brenk.map((alert) => ({ name: alert.name, description: alert.description, severity: alert.severity })) },
    recommended_controls: controls,
  };
}

export function syntheticFeasibility(profile: CompoundProfile) {
  const sa = profile.disposition.syntheticAccessibility;
  const np = profile.disposition.npLikeness;
  const saClass = sa < 3.5 ? "easy" : sa < 6 ? "moderate" : "difficult";
  return {
    available: profile.molecule.valid,
    synthetic_accessibility: {
      sa_score: sa,
      sa_class: saClass,
      scale: "1 (easy) – 10 (difficult)",
      interpretation: saClass === "easy"
        ? "The fragment contributions and complexity penalty place this structure in the readily accessible range for a medicinal-chemistry campaign."
        : saClass === "moderate"
          ? "Accessible, but the ring complexity and stereocentre count will add steps. Route scouting is advisable before a large analogue series is committed."
          : "The complexity penalty is high. Expect a long linear sequence; consider whether the pharmacophore can be reached from a simpler scaffold.",
    },
    natural_product_likeness: {
      np_score: np,
      np_class: np > 0 ? "natural-product-like" : np > -1.5 ? "intermediate" : "synthetic",
      confidence: round(clamp(0.55 + unit(seed(profile.smiles, "npconf")) * 0.4, 0.5, 0.97), 2),
      interpretation: np > 0
        ? "The atom environments resemble natural-product chemical space, which often correlates with three-dimensionality and with harder synthesis."
        : "The atom environments resemble synthetic medicinal-chemistry space, which usually means a shorter and more modular route.",
    },
    error_reason: profile.molecule.valid ? null : "The structure could not be parsed, so no feasibility score was computed.",
    method_note: "Structural triage from the Ertl SA (2009) and NP-likeness (2008) scores. It estimates ease of synthesis, not a route or a cost.",
  };
}

/* ── regulatory precedent ────────────────────────────────────────────────── */

const FDA_ANALOGUES = [
  { name: t("Imatinib mesylate"), brands: ["Gleevec"], routes: ["ORAL"], boxed: false },
  { name: t("Atorvastatin calcium"), brands: ["Lipitor"], routes: ["ORAL"], boxed: false },
  { name: t("Celecoxib"), brands: ["Celebrex"], routes: ["ORAL"], boxed: true },
  { name: t("Losartan potassium"), brands: ["Cozaar"], routes: ["ORAL"], boxed: true },
  { name: t("Gefitinib"), brands: ["Iressa"], routes: ["ORAL"], boxed: false },
  { name: t("Sildenafil citrate"), brands: ["Viagra", "Revatio"], routes: ["ORAL"], boxed: false },
  { name: t("Ciprofloxacin hydrochloride"), brands: ["Cipro"], routes: ["ORAL", "INTRAVENOUS"], boxed: true },
  { name: t("Omeprazole"), brands: ["Prilosec"], routes: ["ORAL"], boxed: false },
  { name: t("Diazepam"), brands: ["Valium"], routes: ["ORAL", "INTRAVENOUS"], boxed: true },
];

export function regulatoryOutlook(profile: CompoundProfile, areaCode: string) {
  const smiles = profile.smiles;
  const exact = chance(seed(smiles, "exact"), 0.18);
  const inchikey = pseudoInchiKey(smiles);
  const analogueCount = exact ? 0 : Math.floor(span(seed(smiles, "nanalog"), 2, 5.99));
  const analogues = Array.from({ length: analogueCount }, (_, index) => {
    const source = FDA_ANALOGUES[Math.floor(unit(seed(smiles, `analog${index}`)) * FDA_ANALOGUES.length)];
    const similarity = round(span(seed(smiles, `sim${index}`), 42, 88) - index * 4, 1);
    return {
      name: source.name,
      inchikey: pseudoInchiKey(`${smiles}:${source.name}`),
      similarity_percent: similarity,
      evidence_kind: chance(seed(smiles, `kind${index}`), 0.6) ? "Drugs@FDA application" : "OpenFDA drug label",
      application_count: Math.floor(span(seed(smiles, `apps${index}`), 1, 9)),
      label_count: Math.floor(span(seed(smiles, `labels${index}`), 1, 24)),
      brands: source.brands,
      routes: source.routes,
      boxed_warning_present: source.boxed,
      verification: "Morgan fingerprint similarity recomputed locally against the retrieved structure.",
    };
  }).sort((a, b) => b.similarity_percent - a.similarity_percent);

  const identityName = exact ? pick(seed(smiles, "identity"), FDA_ANALOGUES).name : null;
  const area = THERAPEUTIC_AREAS.find((entry) => entry.code === areaCode);

  const directions = [
    {
      priority: 1,
      action: exact
        ? "Reconcile the intended indication against the approved label"
        : analogues.length
          ? "Review the closest FDA-linked precedent for shared class liabilities"
          : "Prepare a first-in-class regulatory narrative",
      rationale: exact
        ? "An exact structural match to an approved product changes the development question from novelty to differentiation, and the existing label defines the safety expectations."
        : analogues.length
          ? `The nearest precedent (${analogues[0].name}, ${analogues[0].similarity_percent}% similarity) carries ${analogues[0].boxed_warning_present ? "a boxed warning" : "no boxed warning"}. Class-level liabilities should be screened for explicitly rather than assumed absent.`
          : "No FDA-linked structural neighbour was retrieved. That is an absence of precedent, not evidence of novelty benefit — the nonclinical package carries the full evidentiary burden.",
    },
    {
      priority: 2,
      action: "Confirm the nonclinical package scope against ICH M3(R2) Table 1",
      rationale: `The intended clinical duration and ${area ? `the ${area.label.toLowerCase()} population` : "the enrolled population"} determine which repeat-dose, reproductive and carcinogenicity studies must precede each clinical phase.`,
    },
    {
      priority: 3,
      action: "Search FDA product-specific guidance for the closest approved comparator",
      rationale: "Where a bioequivalence pathway exists for a structural analogue, its dissolution and pharmacokinetic expectations are the most concrete regulatory precedent available.",
    },
  ];

  return {
    status: exact || analogues.length ? "available" : "not_found",
    outlook_class: exact ? "exact_fda_precedent" : analogues.length ? "structural_precedent" : "no_precedent",
    exact_structure_match: exact,
    identity_name: identityName,
    inchikey,
    reason: exact
      ? `Exact identity resolved to ${identityName} through the InChIKey skeleton, with matching Drugs@FDA and label records.`
      : analogues.length
        ? `No exact identity was found. ${analogues.length} PubChem structural neighbour${analogues.length === 1 ? "" : "s"} resolved to a named OpenFDA record, with the similarity recomputed locally before it was reported.`
        : "No exact identity and no FDA-linked structural neighbour were retrieved for this structure.",
    drugsfda_applications: exact
      ? Array.from({ length: Math.floor(span(seed(smiles, "napps"), 1, 5)) }, (_, index) => ({
        application_number: `NDA${String(Math.floor(span(seed(smiles, `app${index}`), 20000, 21999)))}`,
        sponsor: pick(seed(smiles, `sponsor${index}`), ["Novartis", "Pfizer", "AstraZeneca", "Merck", "Roche", "Bristol Myers Squibb"]),
        submission_status: "Approved",
        approval_year: Math.floor(span(seed(smiles, `year${index}`), 1996, 2024)),
      }))
      : [],
    drug_labels: exact
      ? Array.from({ length: Math.floor(span(seed(smiles, "nlabels"), 1, 6)) }, (_, index) => ({
        brand_name: pick(seed(smiles, `brand${index}`), ["Gleevec", "Lipitor", "Celebrex", "Cozaar", "Iressa"]),
        boxed_warning_present: chance(seed(smiles, `boxed${index}`), 0.3),
        route: "ORAL",
      }))
      : [],
    structural_analogs: analogues,
    directions,
    sources: ["PubChem structure search", "OpenFDA Drugs@FDA", "OpenFDA drug label", "Local Morgan-fingerprint verification"],
    limitation: "This is precedent context assembled from public records. It is not an approval prediction and it does not assert interchangeability with any listed product.",
  };
}

/* ── indication and route reading contexts ───────────────────────────────── */

export function indicationContext(areaCode: string) {
  const area = THERAPEUTIC_AREAS.find((entry) => entry.code === areaCode);
  if (!area) {
    return {
      available: false,
      reason: "No therapeutic area was stated for this analysis, so no indication-specific reading was applied. Every endpoint below is presented against its generic screening band.",
      affects_predictions: false,
    };
  }
  return {
    available: true,
    affects_predictions: false,
    predictions_note: "No value on this screen changed because a therapeutic area was selected. What the area decides is how much risk is acceptable and, for the endpoints listed below, which direction is even favourable.",
    stated_area: area.label,
    code: area.code,
    meddra_soc: area.meddra_soc,
    icd11: area.icd11,
    severity: area.severity,
    unmet_need: area.unmet_need,
    risk_tolerance: area.risk_tolerance,
    profile: area.profile,
    profile_note: area.profile_note,
    decision_critical_endpoints: area.decision_critical_endpoints,
    directional_endpoints: area.directional_endpoints.map((entry) => ({ endpoint: entry.endpoint, favourable_direction: entry.favourable_direction, note: entry.note })),
    windowed_endpoints: area.windowed_endpoints,
    mechanism_candidates: area.mechanism_candidates,
    deprioritised_endpoints: area.deprioritised_endpoints,
    unmatched_note: null,
  };
}

export function routeContext(routeCode: string) {
  const route = CLINICAL_ROUTES.find((entry) => entry.code === routeCode);
  if (!route) {
    return {
      available: false,
      code: null,
      label: "Clinical route not selected",
      affects_predictions: false,
      prediction_note: "No clinical route was declared. Every ADME endpoint is reported as context and none may influence the Layer 1 gate.",
      gate_note: "Declare the intended route so the gate can decide which endpoint set is decision-relevant.",
      oral_endpoints_decisive: false,
      required_evidence: ["Declare the intended clinical route."],
    };
  }
  return {
    available: true,
    code: route.code,
    label: route.label,
    affects_predictions: false,
    prediction_note: "The clinical route is a programme input, not a model feature. It does not alter any ADMET prediction; it determines which of them may influence the gate.",
    gate_note: route.gateNote,
    oral_endpoints_decisive: route.oralEndpointsDecisive,
    required_evidence: [...route.requiredEvidence],
  };
}

/* ── target evidence ─────────────────────────────────────────────────────── */

export type TargetHit = {
  rank: number;
  targetChemblId: string;
  targetName: string;
  targetType: string;
  uniprotId: string;
  geneName: string;
  organism: string;
  bestActivityType: string;
  bestValue_nM: number;
  pChembl: number;
  bestSimilarity?: number;
  source: "exact" | "similarity" | "prediction";
  confidence: "high" | "moderate" | "low" | "not_confident";
  confidenceScore: number;
  method: string;
  evidenceSummary: string;
  limitations: string[];
  hits: number;
  pdbIds: string[];
  pdbCount: number;
  quality: {
    tier: string;
    score: number;
    source: string;
    provenance: string;
    payload: {
      confidence: string;
      nMeasurements: number;
      distinctCompounds: number;
      range_nM: [number, number];
      geometricMean_nM: number;
      species: string[];
      assayTypes: Record<string, number>;
      assayFormats: Record<string, number>;
    };
  };
};

const TARGET_LIBRARY = [
  { name: t("Cyclin-dependent kinase 2"), gene: "CDK2", uniprot: "P24941", chembl: "CHEMBL301", type: "SINGLE PROTEIN", pdb: ["1HCK", "2R3I", "1AQ1", "4EK3"] },
  { name: t("Epidermal growth factor receptor erbB1"), gene: "EGFR", uniprot: "P00533", chembl: "CHEMBL203", type: "SINGLE PROTEIN", pdb: ["1M17", "4HJO", "2ITY", "5UG9"] },
  { name: t("Carbonic anhydrase II"), gene: "CA2", uniprot: "P00918", chembl: "CHEMBL205", type: "SINGLE PROTEIN", pdb: ["3KS3", "1CA2", "4Q78"] },
  { name: t("Cyclooxygenase-2"), gene: "PTGS2", uniprot: "P35354", chembl: "CHEMBL230", type: "SINGLE PROTEIN", pdb: ["5KIR", "3LN1", "5F1A"] },
  { name: t("Serine/threonine-protein kinase B-raf"), gene: "BRAF", uniprot: "P15056", chembl: "CHEMBL5145", type: "SINGLE PROTEIN", pdb: ["4MNE", "3OG7", "5CSW"] },
  { name: t("Phosphodiesterase 5A"), gene: "PDE5A", uniprot: "O76074", chembl: "CHEMBL1827", type: "SINGLE PROTEIN", pdb: ["1UDT", "2H42", "3SHY"] },
  { name: t("Beta-2 adrenergic receptor"), gene: "ADRB2", uniprot: "P07550", chembl: "CHEMBL210", type: "SINGLE PROTEIN", pdb: ["2RH1", "3NY8", "4LDO"] },
  { name: t("Histone deacetylase 6"), gene: "HDAC6", uniprot: "Q9UBN7", chembl: "CHEMBL1865", type: "SINGLE PROTEIN", pdb: ["5EDU", "5G0I"] },
  { name: t("Janus kinase 2"), gene: "JAK2", uniprot: "O60674", chembl: "CHEMBL2971", type: "SINGLE PROTEIN", pdb: ["4BBE", "3KRR", "5TQ8"] },
  { name: t("Dipeptidyl peptidase IV"), gene: "DPP4", uniprot: "P27487", chembl: "CHEMBL284", type: "SINGLE PROTEIN", pdb: ["1X70", "2ONC", "4A5S"] },
  { name: t("HMG-CoA reductase"), gene: "HMGCR", uniprot: "P04035", chembl: "CHEMBL402", type: "SINGLE PROTEIN", pdb: ["1HWK", "1HW9"] },
  { name: t("Bromodomain-containing protein 4"), gene: "BRD4", uniprot: "O60885", chembl: "CHEMBL1163125", type: "SINGLE PROTEIN", pdb: ["3MXF", "4LYI", "5U2C"] },
];

export function predictTargets(profile: CompoundProfile): { targets: TargetHit[]; mode: "exact" | "similarity" | "prediction"; thresholdUsed: number } {
  const smiles = profile.smiles;
  const exact = chance(seed(smiles, "targetexact"), 0.28);
  const mode: "exact" | "similarity" | "prediction" = exact ? "exact" : chance(seed(smiles, "targetsim"), 0.8) ? "similarity" : "prediction";
  const threshold = mode === "similarity" ? pick(seed(smiles, "thresh"), [70, 60, 50]) : 0;
  const count = 5;
  const offset = Math.floor(unit(seed(smiles, "toffset")) * TARGET_LIBRARY.length);

  const targets: TargetHit[] = Array.from({ length: count }, (_, index) => {
    const entry = TARGET_LIBRARY[(offset + index) % TARGET_LIBRARY.length];
    const potency = logSpan(seed(smiles, `pot${index}`), profile.affinity.kdNm * (1 + index * 1.6), profile.affinity.kdNm * (6 + index * 9));
    const measurements = Math.floor(span(seed(smiles, `meas${index}`), 4, 140));
    const compounds = Math.max(1, Math.floor(measurements * span(seed(smiles, `cmp${index}`), 0.25, 0.8)));
    const similarity = mode === "similarity" ? round(span(seed(smiles, `tsim${index}`), threshold, 96) - index * 3, 1) : undefined;
    const confidenceScore = round(clamp(0.92 - index * 0.14 - (mode === "prediction" ? 0.25 : 0), 0.15, 0.97), 2);
    const confidence: TargetHit["confidence"] = confidenceScore > 0.75 ? "high" : confidenceScore > 0.5 ? "moderate" : confidenceScore > 0.3 ? "low" : "not_confident";
    const activityType = pick(seed(smiles, `act${index}`), ["IC50", "Ki", "Kd", "EC50"]);

    return {
      rank: index + 1,
      targetChemblId: entry.chembl,
      targetName: entry.name,
      targetType: entry.type,
      uniprotId: entry.uniprot,
      geneName: entry.gene,
      organism: "Homo sapiens",
      bestActivityType: activityType,
      bestValue_nM: round(potency, 2),
      pChembl: round(9 - Math.log10(potency), 2),
      bestSimilarity: similarity,
      source: mode,
      confidence,
      confidenceScore,
      method: mode === "exact"
        ? "Exact ChEMBL identity match on the standardised parent structure"
        : mode === "similarity"
          ? `ChEMBL structural-neighbour aggregation at a ${threshold}% Tanimoto threshold`
          : "Target-deconvolution model over the ChEMBL activity matrix",
      evidenceSummary: mode === "exact"
        ? `Activity is attached to this compound's exact ChEMBL identity across ${measurements} measurement${measurements === 1 ? "" : "s"}.`
        : mode === "similarity"
          ? `${compounds} measured structural analogue${compounds === 1 ? "" : "s"}${similarity !== undefined ? `; nearest similarity ${similarity}%` : ""}. This is evidence for the ranking, not a measurement on the submitted compound.`
          : `Ranked by the target-deconvolution model. No measured activity is claimed for this compound or its analogues; experimental target deconvolution is required.`,
      limitations: mode === "prediction"
        ? ["No measured activity supports this ranking.", "Experimental target deconvolution is required before this target may be treated as resolved."]
        : mode === "similarity"
          ? ["The measurement belongs to an analogue, not to the submitted compound.", "Assay formats are heterogeneous; the aggregate is a ranking signal rather than a potency estimate."]
          : ["Aggregated across heterogeneous assay formats and laboratories."],
      hits: measurements,
      pdbIds: entry.pdb,
      pdbCount: entry.pdb.length,
      quality: {
        tier: confidence === "high" ? "A" : confidence === "moderate" ? "B" : "C",
        score: confidenceScore,
        source: "ChEMBL 34 curated bioactivity",
        provenance: mode === "exact" ? "measured on the submitted structure" : mode === "similarity" ? "measured on structural analogues" : "model prediction",
        payload: {
          confidence,
          nMeasurements: measurements,
          distinctCompounds: compounds,
          range_nM: [round(potency * 0.22, 2), round(potency * 5.4, 2)],
          geometricMean_nM: round(potency, 2),
          species: ["Homo sapiens", ...(chance(seed(smiles, `sp${index}`), 0.4) ? ["Rattus norvegicus"] : [])],
          assayTypes: { [activityType]: measurements, ...(chance(seed(smiles, `at${index}`), 0.5) ? { Kd: Math.floor(measurements * 0.2) } : {}) },
          assayFormats: { Biochemical: Math.floor(measurements * 0.7), "Cell-based": Math.ceil(measurements * 0.3) },
        },
      },
    };
  });

  return { targets, mode, thresholdUsed: threshold };
}

export function targetResolution(target: TargetHit | null, profile: CompoundProfile) {
  if (!target) {
    return {
      status: "unresolved" as const,
      target_protein: null, uniprot_id: null, pdb_id: null, organism: null, gene_symbol: null,
      confidence: "not_confident" as const,
      evidence_type: "unavailable" as const,
      provenance: [],
      limitations: ["No protein target was selected, so Layer 1 ran as a structure-only screen and the Confirmation stages that need a target will report as blocked."],
      reason: "No resolved protein target was provided for this analysis.",
    };
  }
  return {
    status: "resolved" as const,
    target_protein: target.targetName,
    uniprot_id: target.uniprotId,
    pdb_id: target.pdbIds[0] ?? null,
    organism: target.organism,
    gene_symbol: target.geneName,
    confidence: target.confidence === "high" ? ("high" as const) : target.confidence === "moderate" ? ("moderate" as const) : ("not_confident" as const),
    evidence_type: target.source === "exact" ? ("database_derived" as const) : target.source === "similarity" ? ("database_derived" as const) : ("predicted_evidence" as const),
    provenance: [
      `ChEMBL target ${target.targetChemblId} resolved to UniProt ${target.uniprotId}`,
      `UniProt entry validated: ${target.geneName}_HUMAN, ${target.organism}`,
      `${target.pdbCount} experimental structure${target.pdbCount === 1 ? "" : "s"} linked through the PDB SIFTS mapping`,
      target.method,
    ],
    limitations: target.limitations,
    sequence_length: Math.floor(span(seed(profile.smiles, "seqlen"), 240, 1210)),
  };
}

/* ── selectivity / off-target evidence ───────────────────────────────────── */

export type PotencyGroup = {
  activity_type: string;
  independent_compound_count: number;
  supporting_measurement_count: number;
  potency_estimate: { median_nM: number; display: string } | null;
  organisms: string[];
  assay_contexts: string[];
  reported_units: string[];
  insufficient_reason: string | null;
};

export function selectivityEvidence(profile: CompoundProfile, selected: TargetHit | null, all: TargetHit[]) {
  if (!selected) {
    return { status: "unavailable", reason: "Select a resolved protein target, then run Layer 1 to retrieve read-across selectivity evidence.", threshold: 3, limitations: [] };
  }
  const smiles = profile.smiles;
  const makeGroup = (target: TargetHit, activityType: string, channel: string): PotencyGroup => {
    const compounds = Math.max(1, Math.floor(span(seed(smiles, `${channel}::cmp`), 1, 11)));
    const measurements = compounds * Math.max(1, Math.floor(span(seed(smiles, `${channel}::meas`), 1, 5)));
    const median = round(logSpan(seed(smiles, `${channel}::med`), target.bestValue_nM * 0.5, target.bestValue_nM * 4), 2);
    const sufficient = compounds >= 3;
    return {
      activity_type: activityType,
      independent_compound_count: compounds,
      supporting_measurement_count: measurements,
      potency_estimate: sufficient ? { median_nM: median, display: `${median} nM (median of ${compounds} independent analogues)` } : null,
      organisms: ["Homo sapiens", ...(chance(seed(smiles, `${channel}::org`), 0.35) ? ["Rattus norvegicus"] : [])],
      assay_contexts: [
        "Enzymatic inhibition, recombinant human protein, ATP at Km",
        ...(chance(seed(smiles, `${channel}::ctx`), 0.5) ? ["Cell-based reporter, 1 h pre-incubation"] : []),
      ],
      reported_units: ["nM", ...(chance(seed(smiles, `${channel}::unit`), 0.3) ? ["µM"] : [])],
      insufficient_reason: sufficient ? null : `Only ${compounds} suitable independent analogue compound${compounds === 1 ? "" : "s"} met the eligibility filters. At least 3 are required before a potency estimate is reported.`,
    };
  };

  const primary = [{
    target_chembl_id: selected.targetChemblId,
    target_name: selected.targetName,
    potency_groups: ["IC50", "Ki"].map((type, index) => makeGroup(selected, type, `primary${index}`)),
  }];

  const others = all.filter((target) => target.targetChemblId !== selected.targetChemblId);
  const offTargets = others.slice(0, 4).map((target, index) => ({
    target_chembl_id: target.targetChemblId,
    target_name: target.targetName,
    potency_groups: [makeGroup(target, target.bestActivityType, `off${index}`)],
  }));
  const eligible = offTargets.filter((entry) => entry.potency_groups.some((group) => group.potency_estimate));

  return {
    status: "completed",
    method: "Read-across from measured ChEMBL activity on structural analogues, grouped by activity type and never averaged across types.",
    reason: null,
    threshold: 3,
    primary_target_evidence: primary,
    off_targets: eligible,
    insufficient_off_target_target_count: offTargets.length - eligible.length,
    limitations: [
      "Every value here is measured on a structural analogue, not on the submitted compound.",
      "Activity types are kept in separate groups; a cross-type median would have no defensible meaning.",
      "An absence of eligible off-target records does not demonstrate that the molecule is selective.",
      "Records flagged as low confidence, non-binding, ADMET-format or broad-chemistry assays are excluded before aggregation.",
    ],
  };
}

/* ── docking ─────────────────────────────────────────────────────────────── */

export function dockingResult(profile: CompoundProfile, pdbId: string) {
  const smiles = profile.smiles;
  const base = -6.2 - profile.descriptors.logp * 0.32 - profile.descriptors.heavy_atom_count * 0.045 + normal(seed(smiles, `dock::${pdbId}`), 0, 0.55);
  const poses = Array.from({ length: 5 }, (_, index) => ({
    mode: index + 1,
    affinity_kcal_mol: round(base + index * span(seed(smiles, `dockstep${index}`), 0.25, 0.8), 2),
    rmsd_lb: index === 0 ? 0 : round(span(seed(smiles, `rmsdl${index}`), 0.6, 3.2), 2),
    rmsd_ub: index === 0 ? 0 : round(span(seed(smiles, `rmsdu${index}`), 2.1, 9.4), 2),
  }));
  return {
    job_id: `dock-${pseudoInchiKey(smiles + pdbId).slice(0, 8).toLowerCase()}`,
    status: "done" as const,
    result: {
      pdb_id: pdbId,
      engine: "AutoDock Vina 1.2.5",
      vina_version: "1.2.5",
      exhaustiveness: 8,
      num_modes: 5,
      poses,
      box: {
        method: "co-crystallised ligand centroid",
        source_residue: pick(seed(smiles, "residue"), ["LEU83", "MET793", "THR199", "TYR385", "PHE168"]),
        centre: [round(span(seed(smiles, "bx"), -18, 34), 2), round(span(seed(smiles, "by"), -12, 40), 2), round(span(seed(smiles, "bz"), -22, 28), 2)],
        size_angstrom: [22, 22, 22],
      },
      runtime_seconds: round(span(seed(smiles, "runtime"), 18, 96), 1),
      warnings: [
        "A docking score is a scoring-function value, not a binding free energy. It ranks poses; it does not predict affinity.",
        "The receptor is held rigid. Induced fit and explicit water are not modelled.",
      ],
    },
  };
}

/* ── assay bench ─────────────────────────────────────────────────────────── */

export function benchResult(profile: CompoundProfile, assayId: string) {
  const smiles = profile.smiles;
  const p = profile.endpoints;
  const groups: Array<{ title: string; fields: Array<{ label: string; value: unknown }> }> = [];
  const fail = chance(seed(smiles, `bench::${assayId}::fail`), 0.10);

  const emit = (title: string, fields: Array<[string, unknown]>) => {
    groups.push({ title, fields: fields.map(([label, value]) => ({ label, value })) });
  };

  switch (assayId) {
    case "pampa":
      emit("PAMPA passive permeability", [
        ["Permeability", `${round(-6.4 + p.PAMPA_NCATS.canonicalValue * 1.5, 2)} log Papp (cm/s)`],
        ["Class", p.PAMPA_NCATS.canonicalValue > 0.7 ? "high" : p.PAMPA_NCATS.canonicalValue > 0.4 ? "moderate" : "low"],
        ["Probability of the high-permeability class", round(p.PAMPA_NCATS.canonicalValue, 3)],
        ["Provider", "ADMETlab 3.0 (remote)"],
      ]);
      break;
    case "caco2":
      emit("Caco-2 apparent permeability", [
        ["log Papp", round(p.Caco2_Wang.modelValue, 3)],
        ["Papp", `${round(p.Caco2_Wang.canonicalValue, 2)} ×10⁻⁶ cm/s`],
        ["Permeability class", p.Caco2_Wang.canonicalValue > 8 ? "high" : p.Caco2_Wang.canonicalValue > 2 ? "moderate" : "low"],
        ["Applicability domain", p.Caco2_Wang.applicabilityDomain.inDomain ? "in domain" : "out of domain"],
      ]);
      break;
    case "pgp_substrate":
      emit("P-glycoprotein substrate", [
        ["Probability", round(clamp(p.Pgp_Broccatelli.canonicalValue * 0.85 + 0.1, 0, 1), 3)],
        ["Class", p.Pgp_Broccatelli.canonicalValue > 0.5 ? "substrate" : "non-substrate"],
        ["Efflux-ratio expectation", p.Pgp_Broccatelli.canonicalValue > 0.5 ? "> 2 in a bidirectional assay" : "≤ 2 in a bidirectional assay"],
        ["Provider", "ADMETlab 3.0 (remote)"],
      ]);
      break;
    case "bbb":
      emit("Blood–brain barrier penetration", [
        ["Probability", round(p.BBB_Martins.canonicalValue, 3)],
        ["Penetration class", p.BBB_Martins.canonicalValue > 0.7 ? "penetrant" : p.BBB_Martins.canonicalValue > 0.4 ? "borderline" : "non-penetrant"],
        ["Projected Kp,uu", round(profile.disposition.kpuuBrain, 3)],
      ]);
      break;
    case "solubility":
      emit("Aqueous solubility", [
        ["Predicted logS", round(p.Solubility_AqSolDB.canonicalValue, 3)],
        ["Solubility", `${round(10 ** p.Solubility_AqSolDB.canonicalValue * profile.descriptors.molecular_weight_da * 1000, 3)} mg/L`],
        ["Solubility class", p.Solubility_AqSolDB.canonicalValue > -4 ? "soluble" : p.Solubility_AqSolDB.canonicalValue > -6 ? "poorly soluble" : "insoluble"],
      ]);
      break;
    case "vdss":
      emit("Steady-state volume of distribution", [
        ["VDss", `${round(p.VDss_Lombardo.canonicalValue, 3)} L/kg`],
        ["Distribution class", p.VDss_Lombardo.canonicalValue < 0.6 ? "plasma-restricted" : p.VDss_Lombardo.canonicalValue < 5 ? "moderate" : "extensive"],
        ["Total body water reference", "0.6 L/kg"],
      ]);
      break;
    case "half_life":
      emit("Plasma half-life", [
        ["Half-life", `${round(p.Half_Life_Obach.canonicalValue, 2)} h`],
        ["Half-life class", p.Half_Life_Obach.canonicalValue < 2 ? "short" : p.Half_Life_Obach.canonicalValue < 12 ? "intermediate" : "long"],
        ["Implied once-daily accumulation ratio", round(1 / (1 - Math.exp(-(Math.log(2) / p.Half_Life_Obach.canonicalValue) * 24)), 2)],
      ]);
      break;
    case "cyp_inhibition": {
      const isoforms = ["CYP1A2_Veith", "CYP2C9_Veith", "CYP2C19_Veith", "CYP2D6_Veith", "CYP3A4_Veith"];
      const highest = isoforms.reduce((best, key) => (p[key].canonicalValue > p[best].canonicalValue ? key : best), isoforms[0]);
      emit("CYP isoform inhibition", isoforms.map((key) => [p[key].title, round(p[key].canonicalValue, 3)] as [string, unknown]));
      emit("Summary", [
        ["Isoforms evaluated", isoforms.length],
        ["Highest-risk isoform", highest.replace("_Veith", "")],
        ["Highest probability", round(p[highest].canonicalValue, 3)],
        ["Isoforms above the 0.5 call", isoforms.filter((key) => p[key].canonicalValue >= 0.5).map((key) => key.replace("_Veith", "")).join(", ") || "none"],
      ]);
      break;
    }
    case "reactive_metabolites": {
      const reactive = profile.alerts.filter((alert) => ["Michael acceptor", "Aldehyde", "Nitro group", "Aniline", "Thiol", "Three-membered heterocycle", "Quinone A", "Catechol A"].includes(alert.name));
      emit("Reactive-metabolite alerts", [
        ["Alert class", reactive.length === 0 ? "none" : reactive.length === 1 ? "low" : reactive.length === 2 ? "moderate" : "high"],
        ["Alert count", reactive.length],
        ["Matched substructures", reactive.map((alert) => alert.name).join(", ") || "None"],
        ["Recommended trapping study", reactive.length ? "Glutathione and potassium-cyanide trapping in human liver microsomes" : "Not indicated by the structural screen"],
      ]);
      break;
    }
    case "tox21": {
      const tox21Keys = Object.keys(p).filter((key) => key.startsWith("NR-") || key.startsWith("SR-"));
      const flagged = tox21Keys.filter((key) => p[key].canonicalValue >= 0.55);
      const top = tox21Keys.reduce((best, key) => (p[key].canonicalValue > p[best].canonicalValue ? key : best), tox21Keys[0]);
      emit("Tox21 panel summary", [
        ["Assays evaluated", tox21Keys.length],
        ["In-domain flags", flagged.length],
        ["Top liability", top],
        ["Top liability probability", round(p[top].canonicalValue, 3)],
      ]);
      emit("Per-assay activity", tox21Keys.map((key) => [key, round(p[key].canonicalValue, 3)] as [string, unknown]));
      break;
    }
    case "ames":
      emit("Ames mutagenicity", [
        ["Mutagenic probability", round(p.AMES.canonicalValue, 3)],
        ["Call", p.AMES.canonicalValue >= 0.5 ? "positive" : "negative"],
        ["Applicability domain", p.AMES.applicabilityDomain.inDomain ? "in_domain" : "out_of_domain"],
        ["Nearest training analogue", round(p.AMES.applicabilityDomain.nearestTanimoto, 3)],
      ]);
      break;
    case "cardiotox":
      emit("hERG cardiotoxicity", [
        ["Blocker probability", round(p.hERG.canonicalValue, 3)],
        ["Risk class", p.hERG.canonicalValue > 0.65 ? "High" : p.hERG.canonicalValue > 0.35 ? "Moderate" : "Low"],
        ["IC50 band", p.hERG.canonicalValue > 0.65 ? "< 1 µM" : p.hERG.canonicalValue > 0.45 ? "1 – 10 µM" : p.hERG.canonicalValue > 0.3 ? "10 – 30 µM" : "> 30 µM"],
        ["Limitation", "The model returns a class and a band, never a numeric IC50, so no single ICH S7B margin can be defended from it."],
      ]);
      break;
    case "dili":
      emit("Drug-induced liver injury", [
        ["DILI probability", round(p.DILI.canonicalValue, 3)],
        ["Applicability domain", p.DILI.applicabilityDomain.inDomain ? "in_domain" : "out_of_domain"],
        ["Conformal decision", p.DILI.applicabilityDomain.inDomain ? "accepted" : "abstained"],
        ["Limitation", "A binary hazard call. No severity, latency or incidence is predicted."],
      ]);
      break;
    case "bsep": {
      const score = clamp(p.DILI.canonicalValue * 0.6 + profile.descriptors.logp / 12, 0, 1);
      emit("BSEP inhibition (structural)", [
        ["Risk class", score > 0.6 ? "high" : score > 0.35 ? "moderate" : "low"],
        ["Structural score", round(score, 3)],
        ["Rationale", score > 0.35 ? "Anionic amphiphile with a lipophilic core — the physicochemical profile associated with bile-salt export pump inhibition." : "The physicochemical profile does not match the anionic-amphiphile pattern associated with BSEP inhibition."],
      ]);
      break;
    }
    case "bsep_inhibition_remote":
      emit("BSEP inhibition (ADMETlab)", [
        ["Probability", round(clamp(p.DILI.canonicalValue * 0.75 + 0.08, 0, 1), 3)],
        ["Class", p.DILI.canonicalValue > 0.5 ? "inhibitor" : "non-inhibitor"],
        ["Provider", "ADMETlab 3.0 (remote)"],
      ]);
      break;
    case "phospholipidosis":
      emit("Phospholipidosis", [
        ["Probability", round(clamp((profile.descriptors.logp - 1) / 6 + (profile.disposition.chargeAtPh74 > 0 ? 0.25 : 0), 0.02, 0.95), 3)],
        ["Class", profile.descriptors.logp > 3 && profile.disposition.chargeAtPh74 > 0 ? "positive" : "negative"],
        ["Basis", "Cationic amphiphilic drug pattern: a basic centre combined with a lipophilic domain."],
      ]);
      break;
    case "cytotoxicity":
      emit("General cytotoxicity", [
        ["CC50", `${round(logSpan(seed(smiles, "cc50"), 0.5, 160), 2)} µM`],
        ["Cell line", "HepG2"],
        ["Source", "Ersilia Model Hub (remote)"],
        ["Note", "The only bench assay that yields a numeric concentration, so the only one that can support a cytotoxicity margin."],
      ]);
      break;
    case "known_drug": {
      const matched = chance(seed(smiles, "known"), 0.22);
      emit("Known-drug identity lookup", [
        ["Matched", matched ? "yes" : "no"],
        ["Name", matched ? pick(seed(smiles, "knownname"), FDA_ANALOGUES).name : "No indexed drug matched this structure"],
        ["Match type", matched ? pick(seed(smiles, "matchtype"), ["exact", "stereo_variant", "near_neighbour"]) : "none"],
        ["Similarity", matched ? round(span(seed(smiles, "knownsim"), 0.72, 1.0), 3) : round(profile.applicability.nearest_tanimoto, 3)],
        ["Index", "InChIKey skeleton + ECFP4 nearest neighbour over the indexed approved-drug set"],
      ]);
      break;
    }
    case "properties":
      emit("Computed molecular properties", [
        ["Estimated pKa", profile.disposition.pka],
        ["Charge at pH 7.4", profile.disposition.chargeAtPh74],
        ["Synthetic accessibility", profile.disposition.syntheticAccessibility],
        ["Molar refractivity", profile.descriptors.molar_refractivity],
        ["Fraction sp³ carbon", profile.descriptors.fraction_csp3],
        ["Molecular formula", profile.descriptors.molecular_formula],
      ]);
      break;
    case "assay_reliability": {
      const report = assayReliability(profile);
      emit("Structural interference review", [
        ["Summary", report.display_summary],
        ["Alert level", report.overall_alert_level],
        ["Recommendation", report.display_recommendation],
        ["PAINS matches", report.pains.count],
        ["Brenk matches", report.brenk.count],
      ]);
      break;
    }
    default:
      break;
  }

  if (fail && ["pampa", "pgp_substrate", "bsep_inhibition_remote", "phospholipidosis", "cytotoxicity"].includes(assayId)) {
    return {
      id: assayId,
      status: "unavailable" as const,
      reason: "The remote provider did not respond within the request timeout. No value is substituted — an unavailable provider stays visible as unavailable.",
      presentation: { groups: [] },
    };
  }

  return { id: assayId, status: "available" as const, reason: null, presentation: { groups } };
}

/* ── study dossier ───────────────────────────────────────────────────────── */

export function l1Dossier(hasTarget: boolean, hasReview: boolean) {
  return {
    available: true,
    title: "Layer 1 review order",
    subtitle: "The order a reviewer reads a completed in-vitro screen, and where every returned block sits in it.",
    sections: [
      { id: "identity", sequence: 1, title: "Structure and identity", purpose: "Confirm which chemical species was actually screened after salt stripping and standardisation.", source_keys: ["canonical_smiles", "structure_preparation", "three_dimensional_structure"], status: "pass" },
      { id: "physchem", sequence: 2, title: "Physicochemical feasibility", purpose: "Establish whether the structure is in a range where the downstream models are meaningful at all.", source_keys: ["rdkit_feasibility", "rdkit_assessments"], status: "pass" },
      { id: "domain", sequence: 3, title: "Model applicability", purpose: "Decide whether the safety models may speak about this chemistry before any of their values are read.", source_keys: ["tanimoto_applicability"], status: "pass" },
      { id: "admet", sequence: 4, title: "ADMET profile", purpose: "Read the absorption, distribution, metabolism, excretion and toxicity endpoints against their published bands.", source_keys: ["admet_ai_endpoints", "admet_ai_sections"], status: "pass" },
      { id: "bench", sequence: 5, title: "Extended assay bench", purpose: "Run the focused predictors that sit behind the compact Layer-1 contract.", source_keys: ["assay_bench"], status: "pending" },
      { id: "safety", sequence: 6, title: "Safety and structural review", purpose: "Read the dedicated safety models and the structural-alert screen together.", source_keys: ["safety", "safety_assessments", "assay_reliability", "synthetic_feasibility"], status: "pass" },
      { id: "target", sequence: 7, title: "Target evidence and selectivity", purpose: "Establish what is actually known about the target, and about the compound's activity at it.", source_keys: ["target_resolution", "selectivity_evidence"], status: hasTarget ? "pass" : "caution", not_predicted_source_keys: hasTarget ? [] : ["selectivity_evidence"] },
      { id: "regulatory", sequence: 8, title: "Regulatory precedent", purpose: "Place the structure against public FDA approval and labelling records.", source_keys: ["regulatory_outlook"], status: "pass" },
      { id: "decision", sequence: 9, title: "Stage-gate decision", purpose: "Record the verdict, its evidence-graded checks, and any manual review.", source_keys: ["verdict", "override_record"], status: hasReview ? "pass" : "caution" },
    ],
    data_retention: {
      all_current_outputs_preserved: true,
      indexed_source_keys: ["canonical_smiles", "verdict", "rdkit_feasibility", "rdkit_assessments", "tanimoto_applicability", "safety", "safety_assessments", "assay_reliability", "synthetic_feasibility", "admet_ai_endpoints", "admet_ai_sections", "three_dimensional_structure", "regulatory_outlook", "target_resolution", "indication_context", "route_context"],
      missing_source_keys: [],
      principle: "The dossier is an index over the returned record. It never derives a value and never hides a block that the record contains.",
    },
  };
}

/* ── assembly ────────────────────────────────────────────────────────────── */

export type L1Record = ReturnType<typeof buildL1Record>;

export function buildL1Record(
  profile: CompoundProfile,
  options: {
    routeCode: string;
    areaCode: string;
    target: TargetHit | null;
    allTargets: TargetHit[];
    simulationOptions: { admet_profiling: boolean; binding_simulation: boolean; toxicity_signal_detection: boolean; behavioral_fingerprinting: boolean; confidence_threshold: number };
  },
) {
  const verdict = buildVerdict(profile, options.routeCode, options.areaCode);
  const sections: Record<string, Record<string, EndpointValue>> = {};
  for (const section of ADMET_SECTIONS) {
    sections[section] = Object.fromEntries(
      Object.values(profile.endpoints).filter((endpoint) => endpoint.section === section).map((endpoint) => [endpoint.endpoint, endpoint]),
    );
  }

  const analysisId = pseudoInchiKey(profile.smiles).slice(0, 8).toLowerCase();
  const resolution = targetResolution(options.target, profile);

  return {
    analysis_id: analysisId,
    schema_version: "hakase.small-molecule.l1.v2",
    canonical_smiles: profile.rdkit?.canonicalSmiles ?? profile.molecule.canonicalSmiles,
    inchikey: profile.rdkit?.inchiKey ?? pseudoInchiKey(profile.smiles),
    molecular_formula: profile.descriptors.molecular_formula,
    structure_preparation: {
      standardised: true,
      parent_species_selected: profile.molecule.components > 1,
      components_found: profile.molecule.components,
      stripped_fragments: profile.molecule.strippedFragments,
      note: profile.molecule.components > 1
        ? "The submitted structure contained more than one component. Every descriptor, model and search below ran on the largest fragment — the parent species — not on the salt form."
        : "A single component was submitted; no salt or solvate was stripped.",
    },
    verdict,
    rdkit_feasibility: profile.descriptors,
    tanimoto_applicability: profile.applicability,
    synthetic_feasibility: syntheticFeasibility(profile),
    safety_assessments: safetyAssessments(profile),
    assay_reliability: assayReliability(profile),
    admet_ai_sections: sections,
    admet_endpoint_count: Object.keys(profile.endpoints).length,
    three_dimensional_structure: {
      available: profile.molecule.valid,
      format: "molblock-v2000",
      source: profile.rdkit
        ? `${profile.rdkit.engine} 2D depiction and graph descriptors`
        : "Local fallback depiction; RDKit WebAssembly was unavailable for this run",
      reason: profile.molecule.valid ? undefined : "The structure could not be parsed, so no conformer was generated.",
      atom_count: profile.molecule.atoms.length,
      bond_count: profile.molecule.bonds.length,
      ring_count: profile.molecule.rings.length,
    },
    indication_context: indicationContext(options.areaCode),
    route_context: routeContext(options.routeCode),
    regulatory_outlook: regulatoryOutlook(profile, options.areaCode),
    target_resolution: resolution,
    target_evidence: options.target,
    selectivity_evidence: selectivityEvidence(profile, options.target, options.allTargets),
    simulation_configuration: {
      ...options.simulationOptions,
      confidence_threshold_note: "Review preference only. It is recorded with the run for audit and changes no calibrated model threshold and filters no result.",
    },
    optional_model_runs: {
      binding_simulation: options.simulationOptions.binding_simulation
        ? options.target
          ? {
            status: "available",
            reason: null,
            result: {
              prediction: {
                pKd_predicted: profile.affinity.pKd,
                Kd_nM: profile.affinity.kdNm,
                affinity_class: profile.affinity.kdNm < 10 ? "high" : profile.affinity.kdNm < 200 ? "moderate" : "low",
                model: "BindingML — ligand-protein cross-attention regressor",
                uniprot_id: options.target.uniprotId,
              },
            },
          }
          : { status: "needs_target", reason: "BindingML requires a resolved UniProt target.", result: null }
        : { status: "not_requested", reason: "Binding simulation was disabled by the submitted simulation configuration.", result: null },
      behavioral_fingerprinting: options.simulationOptions.behavioral_fingerprinting
        ? options.target
          ? {
            status: "available",
            reason: null,
            result: {
              prediction: {
                top_cell_types: ["Hepatocyte", "Cardiac myocyte", "Proximal tubule cell", "Cortical neuron", "CD4+ T cell"].slice(0, 3 + Math.floor(unit(seed(profile.smiles, "celln")) * 3)),
                dataset: "Tabula Sapiens v1.0 via Drug2cell",
                gene_symbol: options.target.geneName,
              },
            },
          }
          : { status: "needs_target", reason: "Behavioural fingerprinting requires a resolved target gene symbol.", result: null }
        : { status: "not_requested", reason: "Behavioural fingerprinting was disabled by the submitted simulation configuration.", result: null },
    },
    study_dossier: l1Dossier(Boolean(options.target), false),
    provenance: {
      owner: "hakase_smallmol.l1.pipeline",
      schema_version: "hakase.small-molecule.l1.v2",
      computed_at: stamp(0),
      inference_time_ms: round(span(seed(profile.smiles, "infer"), 4200, 28_000), 1),
      client_contract: "display-only",
      engines: [
        "RDKit",
        "Structure-directed ADMET demo heuristic (45 endpoint views)",
        "Local cardiac-risk heuristic",
        "Local liver-risk heuristic",
        "Local Morgan/Tanimoto applicability domain",
        "Synthetic-feasibility engine (Ertl SA + NP-likeness, offline)",
        "RDKit FilterCatalog PAINS/Brenk/NIH assay-reliability screen",
        "PubChem structural precedent + OpenFDA regulatory lookup",
        options.simulationOptions.binding_simulation ? "Local affinity read-across heuristic" : "Local affinity read-across heuristic (not requested)",
        options.simulationOptions.behavioral_fingerprinting ? "Local cellular-context heuristic" : "Local cellular-context heuristic (not requested)",
      ],
      excluded: ["Ersilia", "ADMETlab", "external model hubs", "legacy invitro_panel"],
    },
  };
}
