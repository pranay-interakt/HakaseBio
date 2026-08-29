/**
 * Reference catalogues.
 *
 * Everything here is a registry the platform owns server-side: therapeutic
 * areas and their endpoint panels, clinical routes, the Confirmation stage
 * roster, the extended assay bench, guideline envelopes and study types,
 * toxicology domains, the safety-pharmacology core battery, DDI isoforms,
 * external data sources, the IND checklist, the FDA safety-factor risk flags
 * and the Phase-1 sub-study set. The demonstration build holds them locally so
 * every list the interface offers is the real list.
 */

/* ── therapeutic areas ───────────────────────────────────────────────────── */

export type TherapeuticArea = {
  code: string;
  label: string;
  meddra_soc: string | null;
  icd11: string | null;
  summary: string;
  severity: "life_threatening" | "serious" | "moderate" | "non_serious";
  unmet_need: "high" | "moderate" | "low";
  risk_tolerance: string;
  profile: string | null;
  profile_note: string | null;
  predictions_note: string;
  decision_critical_endpoints: string[];
  directional_endpoints: Array<{ endpoint: string; favourable_direction: "high" | "low"; note: string }>;
  windowed_endpoints: Array<{ endpoint: string; note: string }>;
  mechanism_candidates: Array<{ endpoint: string; note: string }>;
  deprioritised_endpoints: Array<{ endpoint: string; note: string }>;
  layers: string[];
  endpoints: Array<{
    key: string; name: string; kind: "efficacy" | "safety" | "pk" | "biomarker"; layer: "L2" | "L3" | "L4";
    unit: string | null; direction: "higher_is_better" | "lower_is_better" | null; rationale: string;
    threshold: { comparator: string; value: number | null; basis: string; citation: string; is_regulatory: boolean } | null;
    source_kind: string;
  }>;
};

const commonPk = (layer: "L2" | "L3" | "L4") => ([
  {
    key: "exposure_margin", name: "Exposure margin to the point of departure", kind: "pk" as const, layer,
    unit: "fold", direction: "higher_is_better" as const,
    rationale: "The ratio of the animal point-of-departure exposure to the projected therapeutic exposure. Below 10× a first-in-human protocol carries a monitoring burden.",
    threshold: { comparator: "≥", value: 10, basis: "Conventional first-in-human exposure-margin expectation", citation: "EMA/CHMP/SWP/28367/07 Rev.1 (2017)", is_regulatory: true },
    source_kind: "computed",
  },
  {
    key: "target_occupancy", name: "Projected target occupancy at the therapeutic dose", kind: "pk" as const, layer,
    unit: "%", direction: "higher_is_better" as const,
    rationale: "Equilibrium receptor occupancy from simulated free drug and the resolved affinity anchor. Target engagement, not efficacy.",
    threshold: { comparator: "≥", value: 70, basis: "Conventional engagement threshold for a reversible competitive antagonist", citation: "Grimwood & Hartig, Pharmacol Ther (2009)", is_regulatory: false },
    source_kind: "computed",
  },
] as TherapeuticArea["endpoints"]);

const commonSafety = (layer: "L2" | "L3" | "L4") => ([
  {
    key: "herg_margin", name: "hERG margin over free Cmax", kind: "safety" as const, layer,
    unit: "fold", direction: "higher_is_better" as const,
    rationale: "The ICH S7B expectation is a wide separation between the hERG IC50 and the free therapeutic peak concentration.",
    threshold: { comparator: "≥", value: 30, basis: "ICH S7B / CiPA practice", citation: "ICH S7B (2005); Gintant, Nat Rev Drug Discov (2016)", is_regulatory: true },
    source_kind: "computed",
  },
  {
    key: "hepatic_signal", name: "Hepatic hazard band", kind: "safety" as const, layer,
    unit: "categorical", direction: "lower_is_better" as const,
    rationale: "The hepatotoxicity domain call from the mechanistic panel joined onto simulated liver exposure.",
    threshold: { comparator: "≤", value: null, basis: "Domain hazard band must not reach high", citation: "OECD 407/408 repeat-dose liver endpoints", is_regulatory: false },
    source_kind: "model",
  },
] as TherapeuticArea["endpoints"]);

export const THERAPEUTIC_AREAS: TherapeuticArea[] = [
  {
    code: "ONCOLOGY", label: "Oncology", meddra_soc: "Neoplasms benign, malignant and unspecified", icd11: "2A00–2F9Z",
    summary: "Cytotoxic and targeted anti-cancer agents in a population with a life-threatening condition and a correspondingly wide acceptable-risk envelope.",
    severity: "life_threatening", unmet_need: "high",
    risk_tolerance: "High. A myelosuppressive or hepatic signal that would stop a chronic non-oncology programme is routinely managed in oncology through dose interruption and monitoring.",
    profile: "cytotoxic-tolerant", profile_note: "Antiproliferative activity against normal dividing tissue is often the mechanism rather than an off-target hazard; the panel is read for separation, not for absence.",
    predictions_note: "Selecting a therapeutic area changes nothing in the model outputs. It changes how much risk is acceptable and, for a small set of endpoints, which direction is even favourable.",
    decision_critical_endpoints: ["hERG", "DILI", "SR-p53", "SR-ATAD5", "Clearance_Hepatocyte_AZ"],
    directional_endpoints: [
      { endpoint: "BBB_Martins", favourable_direction: "high", note: "For a CNS tumour indication, penetration is the mechanism; for a solid peripheral tumour it is a safety burden." },
      { endpoint: "SR-MMP", favourable_direction: "low", note: "Mitochondrial disruption in tumour cells may be intended, but the same activity in cardiac and hepatic tissue is not." },
    ],
    windowed_endpoints: [
      { endpoint: "Half_Life_Obach", note: "Intermittent dosing schedules need a half-life short enough to permit recovery between cycles." },
    ],
    mechanism_candidates: [
      { endpoint: "SR-ATAD5", note: "Genotoxic stress may be the mechanism of a DNA-damaging agent rather than an unintended hazard. Check the intent before treating this as a flag." },
      { endpoint: "SR-p53", note: "p53 pathway activation is the intended pharmacology of an MDM2 antagonist." },
    ],
    deprioritised_endpoints: [
      { endpoint: "Skin_Reaction", note: "Sensitisation carries little regulatory weight for a short-course intravenous oncology agent." },
    ],
    layers: ["L2", "L3", "L4"],
    endpoints: [
      { key: "antiproliferative_potency", name: "Antiproliferative IC50", kind: "efficacy", layer: "L2", unit: "nM", direction: "lower_is_better", rationale: "Cell-viability potency against the target-bearing line, the primary in-vitro efficacy anchor for an oncology programme.", threshold: { comparator: "≤", value: 100, basis: "Conventional lead-optimisation potency bar for a targeted agent", citation: "Hughes et al., Br J Pharmacol (2011)", is_regulatory: false }, source_kind: "model" },
      { key: "selectivity_window", name: "Tumour:normal selectivity window", kind: "efficacy", layer: "L2", unit: "fold", direction: "higher_is_better", rationale: "Separation between antiproliferative potency and general cytotoxicity.", threshold: { comparator: "≥", value: 10, basis: "Minimum separation for a targeted rather than a cytotoxic mechanism", citation: "Internal operating point — not a regulatory threshold", is_regulatory: false }, source_kind: "computed" },
      { key: "myelosuppression_signal", name: "Haematopoietic hazard band", kind: "safety", layer: "L3", unit: "categorical", direction: "lower_is_better", rationale: "Bone-marrow suppression is the dose-limiting toxicity for most cytotoxic and many targeted agents.", threshold: { comparator: "≤", value: null, basis: "Domain hazard band", citation: "OECD 407/408 haematology endpoints", is_regulatory: false }, source_kind: "model" },
      ...commonPk("L3"), ...commonSafety("L3"),
      { key: "mtd_declared", name: "Declared maximum tolerated dose", kind: "biomarker", layer: "L4", unit: "mg", direction: "higher_is_better", rationale: "The 3+3 operating characteristics return the distribution of the dose level a trial would declare as the MTD.", threshold: null, source_kind: "computed" },
    ],
  },
  {
    code: "CNS", label: "Central nervous system", meddra_soc: "Nervous system disorders", icd11: "8A00–8E7Z",
    summary: "Agents acting on central targets, where blood–brain barrier penetration is a requirement rather than a liability and the safety-pharmacology CNS battery becomes decisive.",
    severity: "serious", unmet_need: "high",
    risk_tolerance: "Moderate. Chronic dosing in a largely ambulatory population makes a hepatic or cardiac signal much harder to manage than in oncology.",
    profile: "cns-penetrant", profile_note: "The endpoint panel is read for penetration and for central safety pharmacology together; a compound that reaches the brain also reaches every off-target in it.",
    predictions_note: "Selecting a therapeutic area changes nothing in the model outputs. It changes the direction in which CNS penetration is read and raises the weight of the ICH S7A CNS battery.",
    decision_critical_endpoints: ["BBB_Martins", "hERG", "Half_Life_Obach", "PPBR_AZ"],
    directional_endpoints: [
      { endpoint: "BBB_Martins", favourable_direction: "high", note: "CNS penetration is the mechanism here. A low penetration probability is an efficacy failure, not a safety win." },
    ],
    windowed_endpoints: [
      { endpoint: "tpsa", note: "The CNS window closes near 90 Å², far below the 140 Å² oral boundary." },
      { endpoint: "molecular_weight", note: "CNS precedent concentrates below 400 Da rather than below the 500 Da oral boundary." },
    ],
    mechanism_candidates: [
      { endpoint: "SR-MMP", note: "Neuronal mitochondrial effects require careful separation from the intended central pharmacology." },
    ],
    deprioritised_endpoints: [
      { endpoint: "Skin_Reaction", note: "Sensitisation is not a decision endpoint for an oral central agent." },
    ],
    layers: ["L2", "L3", "L4"],
    endpoints: [
      { key: "brain_plasma_ratio", name: "Brain:plasma AUC ratio", kind: "efficacy", layer: "L3", unit: "ratio", direction: "higher_is_better", rationale: "Total brain exposure relative to plasma, from the simulated brain compartment.", threshold: { comparator: "≥", value: 0.3, basis: "Minimum total partition supporting central target engagement", citation: "Di et al., J Med Chem (2013)", is_regulatory: false }, source_kind: "computed" },
      { key: "kp_uu_brain", name: "Unbound brain:plasma partition (Kp,uu)", kind: "efficacy", layer: "L3", unit: "ratio", direction: "higher_is_better", rationale: "The efflux-corrected free-drug ratio; the only brain-exposure quantity that predicts central occupancy.", threshold: { comparator: "≥", value: 0.3, basis: "Conventional threshold separating efflux-limited from freely penetrant compounds", citation: "Hammarlund-Udenaes et al., Pharm Res (2008)", is_regulatory: false }, source_kind: "computed" },
      { key: "cns_safety_battery", name: "ICH S7A CNS core battery assessment", kind: "safety", layer: "L3", unit: "categorical", direction: "lower_is_better", rationale: "Functional observational battery equivalent, driven by predicted central activity and simulated brain exposure.", threshold: { comparator: "≤", value: null, basis: "No adverse central finding at the projected exposure", citation: "ICH S7A (2000)", is_regulatory: true }, source_kind: "model" },
      ...commonPk("L3"), ...commonSafety("L3"),
    ],
  },
  {
    code: "CARDIOVASCULAR", label: "Cardiovascular", meddra_soc: "Cardiac disorders", icd11: "BA00–BE2Z",
    summary: "Agents for cardiac and vascular indications, where the ICH S7B repolarisation assessment sits directly on the mechanism of action.",
    severity: "serious", unmet_need: "moderate",
    risk_tolerance: "Low to moderate. Chronic prophylactic dosing in a population already at cardiovascular risk leaves very little room for a proarrhythmic signal.",
    profile: "cardiac-sensitive", profile_note: "A hERG flag in a cardiovascular programme has to be separated from the intended pharmacology before it can be interpreted at all.",
    predictions_note: "Selecting a therapeutic area changes nothing in the model outputs. It raises the weight of the cardiovascular safety-pharmacology deliverable and narrows the acceptable hERG margin.",
    decision_critical_endpoints: ["hERG", "NR-PPAR-gamma", "Clearance_Hepatocyte_AZ", "PPBR_AZ"],
    directional_endpoints: [
      { endpoint: "hERG", favourable_direction: "low", note: "For an anti-arrhythmic, channel activity may be the mechanism; the interpretation depends on which channel and which programme intent." },
    ],
    windowed_endpoints: [
      { endpoint: "Half_Life_Obach", note: "Chronic once-daily prophylaxis needs a half-life long enough to hold trough coverage without excessive accumulation." },
    ],
    mechanism_candidates: [
      { endpoint: "hERG", note: "Class III anti-arrhythmic activity is deliberate potassium-channel blockade. Confirm the programme intent before treating the flag as a hazard." },
    ],
    deprioritised_endpoints: [
      { endpoint: "BBB_Martins", note: "Central penetration is neither required nor a primary concern for a peripherally acting cardiovascular agent." },
    ],
    layers: ["L2", "L3", "L4"],
    endpoints: [
      { key: "qt_margin", name: "Repolarisation safety margin", kind: "safety", layer: "L3", unit: "fold", direction: "higher_is_better", rationale: "Separation between the hERG IC50 and the projected free peak concentration.", threshold: { comparator: "≥", value: 30, basis: "ICH S7B / CiPA practice", citation: "ICH S7B (2005)", is_regulatory: true }, source_kind: "computed" },
      { key: "haemodynamic_signal", name: "Haemodynamic assessment", kind: "safety", layer: "L3", unit: "categorical", direction: "lower_is_better", rationale: "Blood-pressure and heart-rate effects expected from the mechanistic panel at the simulated exposure.", threshold: { comparator: "≤", value: null, basis: "No adverse haemodynamic finding at the projected exposure", citation: "ICH S7A (2000)", is_regulatory: true }, source_kind: "model" },
      ...commonPk("L3"), ...commonSafety("L3"),
    ],
  },
  {
    code: "INFECTIOUS_DISEASE", label: "Infectious disease", meddra_soc: "Infections and infestations", icd11: "1A00–1H0Z",
    summary: "Anti-infective agents where the efficacy anchor is a pathogen MIC rather than a host-target affinity, and exposure above MIC is the driver.",
    severity: "serious", unmet_need: "high",
    risk_tolerance: "Moderate. Short courses widen the acceptable envelope, but resistance considerations impose their own exposure requirements.",
    profile: "time-above-mic", profile_note: "For a β-lactam-like agent the driver is the fraction of the dosing interval above MIC; for a fluoroquinolone-like agent it is AUC/MIC. The panel reports both.",
    predictions_note: "Selecting a therapeutic area changes nothing in the model outputs. It selects the pharmacodynamic index the exposure projection is read against.",
    decision_critical_endpoints: ["Solubility_AqSolDB", "Half_Life_Obach", "PPBR_AZ", "hERG"],
    directional_endpoints: [
      { endpoint: "PPBR_AZ", favourable_direction: "low", note: "Only unbound drug is microbiologically active; high protein binding directly reduces the effective exposure against MIC." },
    ],
    windowed_endpoints: [
      { endpoint: "Half_Life_Obach", note: "The half-life must support the fraction of the interval above MIC that the pharmacodynamic index requires." },
    ],
    mechanism_candidates: [],
    deprioritised_endpoints: [
      { endpoint: "Carcinogens_Lagunin", note: "A two-year bioassay is not expected for a short-course anti-infective under ICH S1A." },
    ],
    layers: ["L2", "L3", "L4"],
    endpoints: [
      { key: "mic_potency", name: "Minimum inhibitory concentration", kind: "efficacy", layer: "L2", unit: "µg/mL", direction: "lower_is_better", rationale: "The primary microbiological potency anchor.", threshold: { comparator: "≤", value: 2, basis: "Conventional susceptibility breakpoint for a systemic agent", citation: "EUCAST clinical breakpoint tables", is_regulatory: true }, source_kind: "measured" },
      { key: "auc_over_mic", name: "Free AUC/MIC", kind: "efficacy", layer: "L3", unit: "ratio", direction: "higher_is_better", rationale: "The pharmacodynamic index for concentration-dependent agents.", threshold: { comparator: "≥", value: 100, basis: "Conventional target for bacterial stasis to 1-log kill", citation: "Craig, Clin Infect Dis (1998)", is_regulatory: false }, source_kind: "computed" },
      { key: "time_above_mic", name: "Fraction of interval above MIC", kind: "efficacy", layer: "L3", unit: "%", direction: "higher_is_better", rationale: "The pharmacodynamic index for time-dependent agents.", threshold: { comparator: "≥", value: 50, basis: "Conventional target for a β-lactam-class agent", citation: "Craig, Clin Infect Dis (1998)", is_regulatory: false }, source_kind: "computed" },
      ...commonPk("L3"), ...commonSafety("L3"),
    ],
  },
  {
    code: "IMMUNOLOGY", label: "Immunology & inflammation", meddra_soc: "Immune system disorders", icd11: "4A00–4B4Z",
    summary: "Immunomodulatory agents for chronic inflammatory disease, where immunosuppression is both the mechanism and the principal safety concern.",
    severity: "moderate", unmet_need: "moderate",
    risk_tolerance: "Low. Chronic dosing in a non-life-threatening indication makes an infection or malignancy signal difficult to accept.",
    profile: "immunomodulatory", profile_note: "The ICH S8 immunotoxicity assessment is not an off-target screen here; it is the direct read on the intended pharmacology.",
    predictions_note: "Selecting a therapeutic area changes nothing in the model outputs. It reframes the immunotoxicity domain from a hazard into the mechanism, and raises the weight of chronic-exposure endpoints.",
    decision_critical_endpoints: ["DILI", "Half_Life_Obach", "Clearance_Hepatocyte_AZ", "hERG"],
    directional_endpoints: [],
    windowed_endpoints: [
      { endpoint: "Half_Life_Obach", note: "Chronic dosing requires an accumulation ratio that reaches steady state well inside the study duration." },
    ],
    mechanism_candidates: [
      { endpoint: "SR-ARE", note: "Nrf2 pathway activation is the intended mechanism of several approved immunomodulators." },
    ],
    deprioritised_endpoints: [],
    layers: ["L2", "L3", "L4"],
    endpoints: [
      { key: "cytokine_modulation", name: "Cytokine pathway modulation", kind: "efficacy", layer: "L2", unit: "nM", direction: "lower_is_better", rationale: "Functional potency in the pathway the programme intends to modulate.", threshold: { comparator: "≤", value: 50, basis: "Lead-optimisation potency bar for a cellular functional assay", citation: "Internal operating point — not a regulatory threshold", is_regulatory: false }, source_kind: "model" },
      { key: "immunotoxicity_signal", name: "ICH S8 immunotoxicity assessment", kind: "safety", layer: "L3", unit: "categorical", direction: "lower_is_better", rationale: "Immune-system effects beyond the intended pharmacology, at the simulated exposure.", threshold: { comparator: "≤", value: null, basis: "No unintended immunosuppression beyond the intended mechanism", citation: "ICH S8 (2005)", is_regulatory: true }, source_kind: "model" },
      ...commonPk("L3"), ...commonSafety("L3"),
    ],
  },
  {
    code: "METABOLIC", label: "Metabolic & endocrine", meddra_soc: "Metabolism and nutrition disorders", icd11: "5A00–5D46",
    summary: "Agents for diabetes, obesity and lipid disorders, dosed chronically in large ambulatory populations with a very low tolerance for idiosyncratic risk.",
    severity: "moderate", unmet_need: "moderate",
    risk_tolerance: "Very low. Chronic prophylactic dosing in millions of patients means a rare hepatic or cardiovascular event dominates the benefit–risk arithmetic.",
    profile: "chronic-ambulatory", profile_note: "The two-year carcinogenicity bioassay is expected under ICH S1A, so the carcinogenicity and endocrine domains carry unusual weight.",
    predictions_note: "Selecting a therapeutic area changes nothing in the model outputs. It sharply lowers the acceptable hazard bands and brings the chronic-study requirements forward.",
    decision_critical_endpoints: ["DILI", "hERG", "Carcinogens_Lagunin", "NR-PPAR-gamma"],
    directional_endpoints: [
      { endpoint: "NR-PPAR-gamma", favourable_direction: "high", note: "PPARγ agonism is the mechanism of the thiazolidinedione class; here activity may be intended rather than a hazard." },
    ],
    windowed_endpoints: [],
    mechanism_candidates: [
      { endpoint: "NR-PPAR-gamma", note: "Confirm whether nuclear-receptor activity is the programme's mechanism before treating it as an endocrine flag." },
    ],
    deprioritised_endpoints: [],
    layers: ["L2", "L3", "L4"],
    endpoints: [
      { key: "target_engagement_chronic", name: "Trough target occupancy at steady state", kind: "efficacy", layer: "L3", unit: "%", direction: "higher_is_better", rationale: "Chronic indications require engagement to be maintained across the whole dosing interval, not only at peak.", threshold: { comparator: "≥", value: 50, basis: "Trough coverage required for a chronic once-daily agent", citation: "Internal operating point — not a regulatory threshold", is_regulatory: false }, source_kind: "computed" },
      { key: "endocrine_signal", name: "Endocrine disruption assessment", kind: "safety", layer: "L3", unit: "categorical", direction: "lower_is_better", rationale: "Nuclear-receptor activity joined onto reproductive-organ exposure.", threshold: { comparator: "≤", value: null, basis: "Domain hazard band", citation: "ICH S5(R3) (2020); OECD 421/443", is_regulatory: true }, source_kind: "model" },
      ...commonPk("L3"), ...commonSafety("L3"),
    ],
  },
  {
    code: "RESPIRATORY", label: "Respiratory", meddra_soc: "Respiratory, thoracic and mediastinal disorders", icd11: "CA00–CB7Z",
    summary: "Agents for asthma, COPD and pulmonary fibrosis, frequently delivered by inhalation, where local lung exposure and systemic escape are separate questions.",
    severity: "serious", unmet_need: "moderate",
    risk_tolerance: "Moderate. An inhaled route can hold systemic exposure low enough that a systemic hazard becomes manageable.",
    profile: "locally-delivered", profile_note: "For an inhaled agent, low oral bioavailability is favourable: it limits the systemic exposure that follows the swallowed fraction.",
    predictions_note: "Selecting a therapeutic area changes nothing in the model outputs. For an inhaled route it inverts the reading of the oral-absorption endpoints and raises the weight of the respiratory core battery.",
    decision_critical_endpoints: ["hERG", "Skin_Reaction", "Solubility_AqSolDB", "Half_Life_Obach"],
    directional_endpoints: [
      { endpoint: "Bioavailability_Ma", favourable_direction: "low", note: "For an inhaled agent, low oral bioavailability limits the systemic exposure from the swallowed fraction and is therefore favourable." },
      { endpoint: "HIA_Hou", favourable_direction: "low", note: "The same inversion applies to intestinal absorption for a locally delivered inhaled agent." },
    ],
    windowed_endpoints: [
      { endpoint: "Half_Life_Obach", note: "A long lung residence time with rapid systemic clearance is the ideal inhaled profile." },
    ],
    mechanism_candidates: [],
    deprioritised_endpoints: [
      { endpoint: "Caco2_Wang", note: "Intestinal permeability is not a decision endpoint for a locally delivered inhaled agent." },
    ],
    layers: ["L2", "L3", "L4"],
    endpoints: [
      { key: "lung_exposure_ratio", name: "Lung:plasma AUC ratio", kind: "efficacy", layer: "L3", unit: "ratio", direction: "higher_is_better", rationale: "Local pulmonary exposure relative to systemic, from the simulated lung compartment.", threshold: { comparator: "≥", value: 5, basis: "Separation supporting a locally acting inhaled agent", citation: "Internal operating point — not a regulatory threshold", is_regulatory: false }, source_kind: "computed" },
      { key: "respiratory_battery", name: "ICH S7A respiratory core battery", kind: "safety", layer: "L3", unit: "categorical", direction: "lower_is_better", rationale: "Respiratory-rate and tidal-volume effects expected at the projected exposure.", threshold: { comparator: "≤", value: null, basis: "No adverse respiratory finding at the projected exposure", citation: "ICH S7A (2000)", is_regulatory: true }, source_kind: "model" },
      ...commonPk("L3"), ...commonSafety("L3"),
    ],
  },
  {
    code: "RARE_DISEASE", label: "Rare & genetic disease", meddra_soc: "Congenital, familial and genetic disorders", icd11: "LD2F–LD9Z",
    summary: "Agents for small, genetically defined populations, where the unmet need is high, the trial population is small and the regulatory pathway is frequently accelerated.",
    severity: "life_threatening", unmet_need: "high",
    risk_tolerance: "High. A severe monogenic condition with no approved therapy shifts the acceptable-risk envelope substantially.",
    profile: "accelerated-pathway", profile_note: "Small populations make a first-in-patient rather than a first-in-healthy-volunteer design common, which changes the starting-dose argument.",
    predictions_note: "Selecting a therapeutic area changes nothing in the model outputs. It widens the acceptable hazard bands and changes the expected Phase 1 population.",
    decision_critical_endpoints: ["hERG", "DILI", "Half_Life_Obach"],
    directional_endpoints: [],
    windowed_endpoints: [],
    mechanism_candidates: [],
    deprioritised_endpoints: [
      { endpoint: "ClinTox", note: "A historical attrition prior carries little weight where no alternative therapy exists." },
    ],
    layers: ["L2", "L3", "L4"],
    endpoints: [
      { key: "biomarker_response", name: "Mechanistic biomarker response", kind: "biomarker", layer: "L4", unit: "%", direction: "higher_is_better", rationale: "A pharmacodynamic biomarker is usually the accelerated-approval surrogate in a rare-disease programme.", threshold: { comparator: "≥", value: 30, basis: "Minimum change conventionally accepted as evidence of target modulation", citation: "FDA Accelerated Approval guidance (2023)", is_regulatory: true }, source_kind: "computed" },
      ...commonPk("L4"), ...commonSafety("L3"),
    ],
  },
];

/* ── clinical routes ─────────────────────────────────────────────────────── */

export const CLINICAL_ROUTES = [
  { code: "ORAL", label: "Oral", oralEndpointsDecisive: true, gateNote: "Oral ADME endpoints — solubility, permeability, intestinal absorption and first-pass availability — may influence the Layer 1 gate.", requiredEvidence: ["Fasted/fed food-effect assessment", "Dissolution profile in biorelevant media", "Gastric-pH-dependence assessment"] },
  { code: "IV", label: "Intravenous", oralEndpointsDecisive: false, gateNote: "Oral absorption endpoints are reported as context only; they cannot influence the gate for a parenteral route.", requiredEvidence: ["Solubility in a parenterally acceptable vehicle", "Haemolysis and local tolerance at the infusion site", "Precipitation risk on dilution into plasma"] },
  { code: "SC", label: "Subcutaneous", oralEndpointsDecisive: false, gateNote: "Oral endpoints are context. Local tolerance and injection-site depot behaviour become decision-relevant instead.", requiredEvidence: ["Injection-site local tolerance", "Solubility at the formulation pH", "Depot dissolution and absorption rate"] },
  { code: "IM", label: "Intramuscular", oralEndpointsDecisive: false, gateNote: "Oral endpoints are context. Muscle local tolerance and depot release govern the exposure profile.", requiredEvidence: ["Muscle local tolerance and creatine-kinase response", "Depot release characterisation"] },
  { code: "INHALED", label: "Inhaled", oralEndpointsDecisive: false, gateNote: "Oral absorption becomes an inverted read: it governs the systemic exposure from the swallowed fraction rather than the therapeutic exposure.", requiredEvidence: ["Aerodynamic particle-size distribution", "Lung deposition modelling", "Respiratory local tolerance (ICH S7A)"] },
  { code: "TOPICAL", label: "Topical / local dermal", oralEndpointsDecisive: false, gateNote: "Systemic ADME endpoints become a systemic-escape question rather than an efficacy one.", requiredEvidence: ["In-vitro permeation through human skin", "Dermal local tolerance (OECD 404)", "Skin sensitisation (OECD 442)"] },
  { code: "OPHTHALMIC", label: "Ophthalmic", oralEndpointsDecisive: false, gateNote: "Ocular tissue exposure and local tolerance replace the oral ADME endpoints as the decision set.", requiredEvidence: ["Ocular irritation (OECD 405 / reconstructed cornea)", "Aqueous humour and retinal exposure", "Preservative compatibility"] },
  { code: "OTHER", label: "Other / route not yet modelled", oralEndpointsDecisive: false, gateNote: "No route-specific reading is applied. All ADME endpoints are reported as context.", requiredEvidence: ["Declare the intended route so the gate can apply the right endpoint set."] },
] as const;

/* ── Confirmation stage roster ───────────────────────────────────────────── */

export const L2_STAGES = [
  { id: "0", name: "Ingest Layer 1 outputs", mode: "server_contract", models: "Layer 1 persisted analysis", phase: "handoff" },
  { id: "1", name: "Target druggability", mode: "server_ml", models: "ProteinML druggability classifier", phase: "models" },
  { id: "2", name: "Molecular docking", mode: "server_async", models: "AutoDock Vina docking service", phase: "physical" },
  { id: "3", name: "Binding, ADME + disposition cross-check", mode: "server_ml", models: "BindingML; ADMET-AI; Caco2-ML; SolubilityML; VDss-ML; HalfLife-ML", phase: "models" },
  { id: "4", name: "Safety + selectivity cross-check", mode: "server_ml", models: "Safety Triage; Tox21; CardioTox; DILI-ML; Ames-ML; reactive-metabolite alerts", phase: "models" },
  { id: "5", name: "Free-energy refinement", mode: "server_async", models: "TIES FEP / RunPod GPU worker", phase: "physical" },
  { id: "6", name: "IVIVE pharmacokinetic projection", mode: "server_ml", models: "Well-stirred hepatic clearance; ADMET-AI disposition inputs", phase: "models" },
  { id: "7", name: "Target engagement (PD coupling)", mode: "server_ml", models: "Equilibrium receptor occupancy (Clark/Hill) over the affinity and disposition anchors", phase: "models" },
  { id: "8", name: "Therapeutic-index ranking", mode: "server_ml", models: "Margin ranking over Stage 7 engagement and Stage 4 safety concentrations", phase: "models" },
  { id: "9", name: "Confirmation block", mode: "server_rollup", models: "Rollup of every executed Confirmation stage; runs no model of its own", phase: "decision" },
] as const;

export const L2_PHASES = [
  { id: "handoff", label: "Handoff", hint: "Evidence carried in from Layer 1.", stages: ["0"] },
  { id: "models", label: "Model checks", hint: "Run together, in dependency order.", stages: ["1", "3", "4", "6", "7", "8"] },
  { id: "physical", label: "Physical jobs", hint: "Explicitly dispatched; each needs its own inputs and compute budget.", stages: ["2", "5"] },
  { id: "decision", label: "Decision", hint: "Rollup of everything that actually ran.", stages: ["9"] },
] as const;

export const VIRTUAL_TISSUE_MODELS = [
  { id: "hpa_tissue", name: "Human Protein Atlas tissue expression", engine: "HPA consensus RNA + protein", requires: "Resolved UniProt accession" },
  { id: "gtex", name: "GTEx bulk tissue expression", engine: "GTEx v8 median TPM", requires: "Resolved gene symbol" },
  { id: "celltype_aggregation", name: "Cell-type aggregation (Tabula Sapiens)", engine: "Drug2cell over Tabula Sapiens", requires: "Resolved gene symbol" },
  { id: "patient_line", name: "Patient-line projection (oncology only)", engine: "DepMap / CCLE dependency", requires: "Oncology project and a resolved gene symbol" },
] as const;

/* ── extended assay bench ────────────────────────────────────────────────── */

export type BenchAssay = {
  id: string; name: string; group: string; engine: string; description: string; remote?: boolean;
  fields: Array<{ label: string; kind: "probability" | "value" | "class" | "text"; unit?: string; range?: [number, number]; options?: string[] }>;
};

export const BENCH_GROUPS = [
  { id: "permeability", name: "Permeability & transport", description: "Passive permeability, efflux liability and brain penetration." },
  { id: "disposition", name: "Disposition second opinion", description: "Independent regressions for the parameters that drive IVIVE." },
  { id: "metabolism", name: "Metabolism & interaction", description: "CYP inhibition and reactive-metabolite structural liability." },
  { id: "safety", name: "Safety & toxicology", description: "Organ toxicity, mutagenicity and the Tox21 assay panel." },
  { id: "identity", name: "Identity & context", description: "Known-drug lookup, computed properties and structural review." },
] as const;

export const BENCH_ASSAYS: BenchAssay[] = [
  { id: "pampa", name: "PAMPA passive permeability", group: "permeability", engine: "ADMETlab 3.0", remote: true, description: "Parallel artificial membrane permeability, a passive-diffusion surrogate.", fields: [{ label: "Permeability", kind: "value", unit: "log Papp (cm/s)", range: [-7.5, -4.2] }, { label: "Class", kind: "class", options: ["low", "moderate", "high"] }, { label: "Units", kind: "text" }] },
  { id: "caco2", name: "Caco-2 apparent permeability", group: "permeability", engine: "Caco2-ML (TDC Wang)", description: "Monolayer apparent permeability regression, log Papp.", fields: [{ label: "log Papp", kind: "value", unit: "log₁₀ cm/s", range: [-7.2, -4.3] }, { label: "Permeability class", kind: "class", options: ["low", "moderate", "high"] }] },
  { id: "pgp_substrate", name: "P-glycoprotein substrate", group: "permeability", engine: "ADMETlab 3.0", remote: true, description: "Efflux-transporter substrate liability, a common cause of low exposure.", fields: [{ label: "Probability", kind: "probability" }, { label: "Class", kind: "class", options: ["non-substrate", "substrate"] }] },
  { id: "bbb", name: "Blood–brain barrier penetration", group: "permeability", engine: "BBB-ML (TDC Martins)", description: "CNS penetration classification; relevant to both efficacy and CNS safety.", fields: [{ label: "Probability", kind: "probability" }, { label: "Penetration class", kind: "class", options: ["non-penetrant", "borderline", "penetrant"] }] },
  { id: "solubility", name: "Aqueous solubility", group: "disposition", engine: "SolubilityML (TDC AqSolDB)", description: "log S regression. Low solubility limits both assay validity and oral exposure.", fields: [{ label: "Predicted logS", kind: "value", unit: "log mol/L", range: [-8, -1] }, { label: "Solubility class", kind: "class", options: ["insoluble", "poorly soluble", "soluble", "highly soluble"] }] },
  { id: "vdss", name: "Steady-state volume of distribution", group: "disposition", engine: "VDss-ML (TDC Lombardo)", description: "Independent VDss estimate; it is one of the two terms that set half-life.", fields: [{ label: "VDss", kind: "value", unit: "L/kg", range: [0.1, 25] }, { label: "Distribution class", kind: "class", options: ["plasma-restricted", "moderate", "extensive"] }] },
  { id: "half_life", name: "Plasma half-life", group: "disposition", engine: "HalfLife-ML (TDC Obach)", description: "Direct half-life regression, used as a cross-check on the IVIVE projection.", fields: [{ label: "Half-life", kind: "value", unit: "h", range: [0.4, 60] }, { label: "Half-life class", kind: "class", options: ["short", "intermediate", "long"] }] },
  { id: "cyp_inhibition", name: "CYP isoform inhibition", group: "metabolism", engine: "CYP-ML (TDC Veith)", description: "Per-isoform inhibition probability; the basis of a victim/perpetrator DDI call.", fields: [{ label: "Isoforms evaluated", kind: "value", range: [5, 5] }, { label: "Highest-risk isoform", kind: "class", options: ["CYP3A4", "CYP2D6", "CYP2C9", "CYP1A2", "CYP2C19"] }, { label: "Highest probability", kind: "probability" }] },
  { id: "reactive_metabolites", name: "Reactive-metabolite alerts", group: "metabolism", engine: "Structural alert set", description: "Bioactivation substructures associated with idiosyncratic toxicity.", fields: [{ label: "Alert class", kind: "class", options: ["none", "low", "moderate", "high"] }, { label: "Alert count", kind: "value", range: [0, 4] }] },
  { id: "tox21", name: "Tox21 assay panel", group: "safety", engine: "Tox21 qHTS heads", description: "Nuclear-receptor and stress-response panel with per-assay applicability.", fields: [{ label: "Assays evaluated", kind: "value", range: [12, 12] }, { label: "In-domain flags", kind: "value", range: [0, 6] }, { label: "Top liability", kind: "class", options: ["SR-MMP", "NR-AhR", "SR-p53", "NR-ER", "SR-ARE"] }] },
  { id: "ames", name: "Ames mutagenicity", group: "safety", engine: "Ames-ML (TDC Xu)", description: "Bacterial reverse-mutation probability. A hazard call, not a potency.", fields: [{ label: "Mutagenic probability", kind: "probability" }, { label: "Applicability domain", kind: "class", options: ["in_domain", "borderline", "out_of_domain"] }] },
  { id: "cardiotox", name: "hERG cardiotoxicity", group: "safety", engine: "CardioTox local model", description: "hERG blocker probability. Returns a probability band, never an IC50.", fields: [{ label: "Blocker probability", kind: "probability" }, { label: "Risk class", kind: "class", options: ["Low", "Moderate", "High"] }, { label: "IC50 band", kind: "class", options: ["> 30 µM", "10 – 30 µM", "1 – 10 µM", "< 1 µM"] }] },
  { id: "dili", name: "Drug-induced liver injury", group: "safety", engine: "DILI-ML (TDC) + conformal veto", description: "Binary DILI probability with a conformal abstention. No severity class is predicted.", fields: [{ label: "DILI probability", kind: "probability" }, { label: "Applicability domain", kind: "class", options: ["in_domain", "borderline", "out_of_domain"] }, { label: "Conformal decision", kind: "class", options: ["accepted", "abstained"] }] },
  { id: "bsep", name: "BSEP inhibition (structural)", group: "safety", engine: "Local substructure model", description: "Bile-salt export pump liability, a cholestatic hepatotoxicity mechanism.", fields: [{ label: "Risk class", kind: "class", options: ["low", "moderate", "high"] }, { label: "Rationale", kind: "text" }] },
  { id: "bsep_inhibition_remote", name: "BSEP inhibition (ADMETlab)", group: "safety", engine: "ADMETlab 3.0", remote: true, description: "Independent remote BSEP call, used as a second opinion on the local model.", fields: [{ label: "Probability", kind: "probability" }, { label: "Class", kind: "class", options: ["non-inhibitor", "inhibitor"] }] },
  { id: "phospholipidosis", name: "Phospholipidosis", group: "safety", engine: "ADMETlab 3.0", remote: true, description: "Cationic amphiphilic drug liability; a common finding in repeat-dose studies.", fields: [{ label: "Probability", kind: "probability" }, { label: "Class", kind: "class", options: ["negative", "positive"] }] },
  { id: "cytotoxicity", name: "General cytotoxicity", group: "safety", engine: "Ersilia Model Hub", remote: true, description: "Cell-viability CC50. The only bench assay that can yield a numeric safety margin.", fields: [{ label: "CC50", kind: "value", unit: "µM", range: [0.4, 180] }, { label: "Cell line", kind: "class", options: ["HepG2", "HEK293", "A549"] }, { label: "Source", kind: "text" }] },
  { id: "known_drug", name: "Known-drug identity lookup", group: "identity", engine: "InChIKey / ECFP4 index", description: "Exact, stereo-variant or near-neighbour match against the indexed drug set.", fields: [{ label: "Matched", kind: "class", options: ["yes", "no"] }, { label: "Name", kind: "text" }, { label: "Match type", kind: "class", options: ["exact", "stereo_variant", "near_neighbour", "none"] }, { label: "Similarity", kind: "probability" }] },
  { id: "properties", name: "Computed molecular properties", group: "identity", engine: "RDKit derived", description: "Estimated pKa, charge state, synthetic accessibility and derived properties.", fields: [{ label: "Estimated pKa", kind: "value", range: [1.5, 12] }, { label: "Charge at pH 7.4", kind: "value", range: [-2, 2] }, { label: "Synthetic accessibility", kind: "value", range: [1, 10] }] },
  { id: "assay_reliability", name: "Structural interference review", group: "identity", engine: "PAINS / Brenk alert sets", description: "Substructures that make a screening readout unreliable. Not measured interference.", fields: [{ label: "Summary", kind: "text" }, { label: "Alert level", kind: "class", options: ["none", "low", "moderate", "high"] }, { label: "Recommendation", kind: "text" }] },
];

export const BENCH_DEFAULT_SELECTION = ["pampa", "caco2", "pgp_substrate", "solubility", "cyp_inhibition", "reactive_metabolites", "tox21", "ames", "known_drug"];

/* ── study types and guideline envelopes ─────────────────────────────────── */

export type StudyType = {
  id: string; name: string; purpose: string;
  duration_window_h: [number, number]; suggested_duration_h: number;
  animals_per_sex_per_group: number; min_dose_groups: number;
  control_required: boolean; both_sexes_expected: boolean;
  allowed_species: string[] | null; allowed_routes: string[] | null;
  recovery_policy: "conditional" | "not_standard"; recovery_typical_days: number;
  satellite_tk_policy: "conditional_in_small_rodents" | "case_by_case";
  guideline: string;
};

export const STUDY_TYPES: StudyType[] = [
  { id: "single_dose_tox", name: "Single-dose toxicity", purpose: "Establish the acute tolerability and the approximate maximum tolerated dose before repeat dosing.", duration_window_h: [24, 336], suggested_duration_h: 168, animals_per_sex_per_group: 3, min_dose_groups: 3, control_required: true, both_sexes_expected: false, allowed_species: ["rat", "mouse"], allowed_routes: ["ORAL", "IV"], recovery_policy: "not_standard", recovery_typical_days: 0, satellite_tk_policy: "case_by_case", guideline: "ICH M3(R2) §5; OECD 420/423/425" },
  { id: "dose_range_finding", name: "Dose range-finding (non-GLP)", purpose: "Select the dose levels for the pivotal repeat-dose study and confirm exposure separation.", duration_window_h: [96, 336], suggested_duration_h: 168, animals_per_sex_per_group: 3, min_dose_groups: 3, control_required: true, both_sexes_expected: false, allowed_species: null, allowed_routes: null, recovery_policy: "not_standard", recovery_typical_days: 0, satellite_tk_policy: "conditional_in_small_rodents", guideline: "ICH M3(R2) §4 supporting study" },
  { id: "repeat_dose_14d", name: "14-day repeat-dose toxicity", purpose: "Characterise target organs and establish a NOAEL supporting a short first-in-human exposure.", duration_window_h: [312, 360], suggested_duration_h: 336, animals_per_sex_per_group: 5, min_dose_groups: 3, control_required: true, both_sexes_expected: true, allowed_species: null, allowed_routes: null, recovery_policy: "conditional", recovery_typical_days: 14, satellite_tk_policy: "conditional_in_small_rodents", guideline: "ICH M3(R2) Table 1; OECD 407 (adapted)" },
  { id: "repeat_dose_28d", name: "28-day repeat-dose toxicity", purpose: "The standard pivotal study supporting a Phase 1 single- and multiple-ascending-dose programme.", duration_window_h: [648, 700], suggested_duration_h: 672, animals_per_sex_per_group: 10, min_dose_groups: 3, control_required: true, both_sexes_expected: true, allowed_species: null, allowed_routes: null, recovery_policy: "conditional", recovery_typical_days: 14, satellite_tk_policy: "conditional_in_small_rodents", guideline: "OECD 407; ICH M3(R2) Table 1" },
  { id: "repeat_dose_90d", name: "90-day repeat-dose toxicity", purpose: "Support dosing durations beyond one month and characterise slower-developing target-organ effects.", duration_window_h: [2100, 2250], suggested_duration_h: 2160, animals_per_sex_per_group: 10, min_dose_groups: 3, control_required: true, both_sexes_expected: true, allowed_species: null, allowed_routes: null, recovery_policy: "conditional", recovery_typical_days: 28, satellite_tk_policy: "conditional_in_small_rodents", guideline: "OECD 408; ICH M3(R2) Table 1" },
  { id: "safety_pharm_cv", name: "Cardiovascular safety pharmacology", purpose: "Assess blood pressure, heart rate and electrocardiographic parameters in a conscious telemetered animal.", duration_window_h: [24, 72], suggested_duration_h: 48, animals_per_sex_per_group: 4, min_dose_groups: 3, control_required: true, both_sexes_expected: false, allowed_species: ["dog", "monkey", "minipig"], allowed_routes: null, recovery_policy: "not_standard", recovery_typical_days: 0, satellite_tk_policy: "case_by_case", guideline: "ICH S7A / S7B (core battery)" },
  { id: "toxicokinetics", name: "Dedicated toxicokinetic study", purpose: "Characterise systemic exposure across the dose range in support of the toxicology package.", duration_window_h: [24, 672], suggested_duration_h: 168, animals_per_sex_per_group: 3, min_dose_groups: 3, control_required: false, both_sexes_expected: true, allowed_species: null, allowed_routes: null, recovery_policy: "not_standard", recovery_typical_days: 0, satellite_tk_policy: "conditional_in_small_rodents", guideline: "ICH S3A (1994)" },
  { id: "reproductive_screen", name: "Reproductive toxicity screen", purpose: "Screen for fertility and early embryonic-development effects before a definitive ICH S5 study.", duration_window_h: [1000, 1400], suggested_duration_h: 1176, animals_per_sex_per_group: 8, min_dose_groups: 3, control_required: true, both_sexes_expected: true, allowed_species: ["rat"], allowed_routes: null, recovery_policy: "not_standard", recovery_typical_days: 0, satellite_tk_policy: "conditional_in_small_rodents", guideline: "ICH S5(R3); OECD 421" },
];

export const GUIDELINES = STUDY_TYPES.map((type) => ({
  id: type.id, name: `${type.name} — ${type.guideline}`,
  duration_window_h: type.duration_window_h,
  animals_per_sex_per_group: type.animals_per_sex_per_group,
  min_dose_groups: type.min_dose_groups,
  control_required: type.control_required,
}));

/* ── toxicology domains ──────────────────────────────────────────────────── */

export type ToxDomain = {
  id: string; name: string; guideline: string; organ: string | null; mechanism: string;
  drivers: Array<{ endpoint: string; label: string }>;
  findings: Record<string, string[]>;
};

export const TOX_DOMAINS: ToxDomain[] = [
  { id: "acute_systemic", name: "Acute systemic toxicity", guideline: "OECD 420/423/425 — acute oral toxicity", organ: null, mechanism: "Single-dose lethality in the rat, expressed as the oral LD50.", drivers: [{ endpoint: "LD50_Zhu", label: "Predicted rat oral LD50" }], findings: { "Clinical observations": ["Mortality and moribundity", "Body-weight loss > 10%", "Piloerection, hypoactivity, ataxia"], "Terminal": ["Gross necropsy of all major organs"] } },
  { id: "hepatotoxicity", name: "Hepatotoxicity", guideline: "OECD 407/408 — repeat-dose toxicity (liver endpoints)", organ: "liver", mechanism: "Hepatocellular injury via reactive metabolite formation, bile-salt export pump inhibition and mitochondrial dysfunction.", drivers: [{ endpoint: "DILI", label: "DILI hazard probability" }, { endpoint: "bsep", label: "BSEP inhibition score" }, { endpoint: "SR-MMP", label: "Mitochondrial membrane potential" }, { endpoint: "reactive_metabolites", label: "Reactive-metabolite alert score" }], findings: { "Clinical chemistry": ["ALT, AST elevation", "Alkaline phosphatase and total bilirubin", "Bile-acid panel"], "Histopathology": ["Hepatocellular hypertrophy", "Single-cell necrosis", "Bile-duct hyperplasia", "Microvesicular steatosis"], "Organ weight": ["Absolute and relative liver weight"] } },
  { id: "cardiotoxicity", name: "Cardiovascular safety", guideline: "ICH S7A/S7B — safety pharmacology core battery (cardiovascular)", organ: "heart", mechanism: "hERG-mediated delayed ventricular repolarisation and direct myocardial effects.", drivers: [{ endpoint: "hERG", label: "hERG blocker probability" }, { endpoint: "SR-MMP", label: "Cardiac mitochondrial liability" }], findings: { "In-life": ["Telemetered QTc, PR and QRS intervals", "Heart rate and arterial pressure"], "Histopathology": ["Myocardial degeneration and necrosis", "Cardiomyocyte vacuolation"], "Clinical chemistry": ["Cardiac troponin I"] } },
  { id: "genetic_toxicology", name: "Genetic toxicology", guideline: "ICH S2(R1); OECD 471 / 474 / 487 / 489", organ: null, mechanism: "Direct DNA reactivity and clastogenic or aneugenic chromosomal damage.", drivers: [{ endpoint: "AMES", label: "Ames mutagenicity probability" }, { endpoint: "SR-ATAD5", label: "ATAD5 genotoxic stress reporter" }, { endpoint: "SR-p53", label: "p53 activation" }], findings: { "In-vitro": ["Bacterial reverse mutation ± S9", "Mammalian cell micronucleus"], "In-vivo": ["Rodent bone-marrow micronucleus", "Comet assay in liver and stomach"] } },
  { id: "carcinogenicity", name: "Carcinogenicity", guideline: "ICH S1B; OECD 451/453 — 2-year rodent bioassay", organ: null, mechanism: "Genotoxic and non-genotoxic tumour promotion, including receptor-mediated and hormonal mechanisms.", drivers: [{ endpoint: "Carcinogens_Lagunin", label: "Carcinogenicity structural prior" }, { endpoint: "NR-AhR", label: "Aryl hydrocarbon receptor activation" }, { endpoint: "AMES", label: "Genotoxicity contribution" }], findings: { "Chronic study": ["Tumour incidence by organ and sex", "Time to first tumour"], "Weight of evidence": ["Genotoxicity outcome", "Hormonal perturbation", "Chronic-study preneoplastic lesions"] } },
  { id: "nephrotoxicity", name: "Renal toxicity", guideline: "OECD 407/408 — repeat-dose toxicity (kidney endpoints)", organ: "kidney", mechanism: "Proximal tubular accumulation and transporter-mediated injury; crystalluria at high exposure.", drivers: [{ endpoint: "Solubility_AqSolDB", label: "Crystalluria risk from low solubility" }, { endpoint: "SR-MMP", label: "Tubular mitochondrial liability" }], findings: { "Clinical chemistry": ["Blood urea nitrogen and creatinine", "Urinary KIM-1 and NGAL"], "Histopathology": ["Proximal tubular degeneration", "Tubular casts and regeneration", "Papillary necrosis"], "Urinalysis": ["Specific gravity, protein, glucose, sediment"] } },
  { id: "neurotoxicity", name: "CNS / neurotoxicity", guideline: "ICH S7A — safety pharmacology core battery (CNS); OECD 424", organ: "brain", mechanism: "Central receptor engagement and neuronal injury in a compartment reached through the blood–brain barrier.", drivers: [{ endpoint: "BBB_Martins", label: "Blood–brain barrier penetration" }, { endpoint: "SR-MMP", label: "Neuronal mitochondrial liability" }], findings: { "In-life": ["Functional observational battery", "Motor activity", "Grip strength and landing foot splay"], "Histopathology": ["Brain, spinal cord and peripheral nerve", "Neuronal necrosis and gliosis"] } },
  { id: "endocrine_reproductive", name: "Endocrine & reproductive toxicity", guideline: "ICH S5(R3); OECD 407 endocrine endpoints / 421 / 443", organ: null, mechanism: "Nuclear-receptor modulation of steroidogenesis and gonadal function.", drivers: [{ endpoint: "NR-AR", label: "Androgen receptor activity" }, { endpoint: "NR-ER", label: "Oestrogen receptor activity" }, { endpoint: "NR-Aromatase", label: "Aromatase inhibition" }, { endpoint: "NR-AR-LBD", label: "Androgen receptor (LBD) activity" }], findings: { "Organ weight": ["Testes, epididymides, ovaries, uterus, adrenals"], "Histopathology": ["Spermatogenic staging", "Oestrous cyclicity", "Adrenal cortical changes"], "Hormones": ["Testosterone, oestradiol, LH, FSH, TSH"] } },
  { id: "metabolic", name: "Metabolic / body-weight effects", guideline: "OECD 407/408 — body weight, food consumption, clinical chemistry", organ: "adipose", mechanism: "PPARγ-mediated adipogenic and lipid-handling effects.", drivers: [{ endpoint: "NR-PPAR-gamma", label: "PPARγ activation" }], findings: { "In-life": ["Body weight and body-weight gain", "Food and water consumption"], "Clinical chemistry": ["Glucose, triglycerides, cholesterol", "Insulin"] } },
  { id: "hematotoxicity", name: "Haematotoxicity", guideline: "OECD 407/408 — haematology and bone-marrow evaluation", organ: "spleen", mechanism: "Bone-marrow suppression of proliferating haematopoietic precursors.", drivers: [{ endpoint: "SR-ATAD5", label: "Proliferating-cell genotoxic stress" }, { endpoint: "SR-p53", label: "p53-mediated cell-cycle arrest" }], findings: { "Haematology": ["Red and white cell counts", "Reticulocytes and platelets", "Differential leucocyte count"], "Histopathology": ["Bone marrow cellularity and myeloid:erythroid ratio", "Splenic red and white pulp"] } },
  { id: "immunotoxicity", name: "Immunotoxicity", guideline: "ICH S8 — immunotoxicity studies for human pharmaceuticals", organ: "spleen", mechanism: "Suppression or inappropriate activation of adaptive and innate immune function.", drivers: [{ endpoint: "SR-ARE", label: "Nrf2 antioxidant response" }, { endpoint: "SR-p53", label: "Lymphocyte proliferative stress" }], findings: { "Organ weight": ["Spleen, thymus, lymph nodes"], "Histopathology": ["Lymphoid depletion or hyperplasia", "Thymic cortical atrophy"], "Functional": ["T-cell dependent antibody response, if triggered"] } },
  { id: "respiratory", name: "Respiratory safety", guideline: "ICH S7A — safety pharmacology core battery (respiratory)", organ: "lung", mechanism: "Direct pulmonary irritation and phospholipidosis in alveolar macrophages.", drivers: [{ endpoint: "phospholipidosis", label: "Phospholipidosis liability" }], findings: { "In-life": ["Respiratory rate, tidal volume, minute volume (plethysmography)"], "Histopathology": ["Alveolar macrophage accumulation", "Foamy-cell infiltration", "Bronchiolar epithelial change"] } },
  { id: "dermal_local", name: "Local tolerance / dermal reaction", guideline: "OECD 404 (irritation) / OECD 429 (skin sensitisation)", organ: "skin", mechanism: "Haptenation and local irritant response at the site of contact.", drivers: [{ endpoint: "Skin_Reaction", label: "Skin sensitisation probability" }], findings: { "In-life": ["Erythema and oedema scoring", "Injection- or application-site observations"], "Histopathology": ["Site-of-administration inflammation and necrosis"] } },
  { id: "mitochondrial", name: "Mitochondrial toxicity", guideline: "Mechanistic (supports hepatic and muscular findings)", organ: "liver", mechanism: "Loss of mitochondrial membrane potential and impaired oxidative phosphorylation.", drivers: [{ endpoint: "SR-MMP", label: "Mitochondrial membrane potential disruption" }], findings: { "Mechanistic": ["Seahorse oxygen-consumption rate", "Glucose–galactose cytotoxicity shift"], "Histopathology": ["Microvesicular steatosis", "Skeletal-muscle degeneration"] } },
  { id: "oxidative_proteotoxic", name: "Oxidative & proteotoxic stress", guideline: "Mechanistic (supports target-organ findings)", organ: null, mechanism: "Nrf2/ARE antioxidant response and heat-shock (proteotoxic) response activation.", drivers: [{ endpoint: "SR-ARE", label: "Nrf2/ARE activation" }, { endpoint: "SR-HSE", label: "Heat-shock response activation" }], findings: { "Mechanistic": ["Glutathione depletion", "Heat-shock protein induction"], "Histopathology": ["Cellular swelling and vacuolation in the exposed organ"] } },
];

export const HAZARD_THRESHOLDS = { high: 0.70, moderate: 0.45, low: 0.0 };

/* ── safety pharmacology core battery ────────────────────────────────────── */

export const SAFETY_PHARM_SYSTEMS = [
  {
    system: "Cardiovascular",
    guideline: "ICH S7A core battery + ICH S7B (delayed ventricular repolarisation)",
    study_equivalent: "Conscious telemetered dog or minipig with continuous blood-pressure, heart-rate and electrocardiographic recording, plus an in-vitro hERG patch-clamp assay.",
    target_margin: 30,
    next_measurement: "Manual patch-clamp hERG IC50, then a telemetered cardiovascular study in a non-rodent species.",
  },
  {
    system: "Central nervous system",
    guideline: "ICH S7A core battery (CNS)",
    study_equivalent: "Irwin screen or functional observational battery in the rat, covering motor activity, coordination, behavioural change and body temperature.",
    target_margin: 10,
    next_measurement: "Rat functional observational battery at the projected clinical exposure multiple.",
  },
  {
    system: "Respiratory",
    guideline: "ICH S7A core battery (respiratory)",
    study_equivalent: "Whole-body plethysmography in the conscious rat measuring respiratory rate, tidal volume and minute volume.",
    target_margin: 10,
    next_measurement: "Rat plethysmography study, with lung histopathology if a phospholipidosis signal persists.",
  },
] as const;

/* ── drug–drug interaction ───────────────────────────────────────────────── */

export const CYP_ISOFORMS = [
  { id: "CYP1A2", endpoint: "CYP1A2_Veith", indexSubstrate: "Caffeine / tizanidine", fractionMetabolised: 0.09 },
  { id: "CYP2C9", endpoint: "CYP2C9_Veith", indexSubstrate: "S-warfarin / tolbutamide", fractionMetabolised: 0.16 },
  { id: "CYP2C19", endpoint: "CYP2C19_Veith", indexSubstrate: "Omeprazole / S-mephenytoin", fractionMetabolised: 0.12 },
  { id: "CYP2D6", endpoint: "CYP2D6_Veith", indexSubstrate: "Dextromethorphan / desipramine", fractionMetabolised: 0.20 },
  { id: "CYP3A4", endpoint: "CYP3A4_Veith", indexSubstrate: "Midazolam / triazolam", fractionMetabolised: 0.43 },
] as const;

export const DDI_CUTOFFS = { hepatic_R1: 1.02, intestinal_R1_CYP3A: 11.0, basic_model_reference: "FDA In Vitro Drug Interaction Studies guidance (January 2020)" };

/* ── external data sources ───────────────────────────────────────────────── */

export const EXTERNAL_PANELS = {
  target: {
    title: "Target biology — external databases",
    subtitle: "STRING functional network, KEGG pathway/disease/drug annotation and Reactome reaction membership for the resolved target.",
    catalogue: [
      { key: "string", name: "STRING — functional interaction network", requires: "Resolved gene symbol" },
      { key: "kegg", name: "KEGG — pathways, diseases and annotated drugs", requires: "Resolved gene symbol" },
      { key: "reactome", name: "Reactome — curated reaction membership", requires: "Resolved UniProt accession" },
    ],
    limitations: "These are annotation databases. A pathway membership is evidence about the target, never about the submitted compound.",
  },
  hazard: {
    title: "Measured toxicology — external databases",
    subtitle: "EPA ToxRefDB/ToxValDB in-vivo hazard values, ECOTOX environmental endpoints and the ToxCast/Tox21 in-vitro battery.",
    catalogue: [
      { key: "toxref", name: "EPA ToxRefDB / ToxValDB — measured in-vivo hazard", requires: "InChIKey or CAS registry number" },
      { key: "ecotox", name: "EPA ECOTOX — environmental toxicology", requires: "InChIKey or CAS registry number" },
      { key: "toxcast", name: "EPA ToxCast / Tox21 — in-vitro screening battery", requires: "DSSTox substance identifier" },
    ],
    limitations: "An empty result is an absence of a public record for this structure. It is not evidence of safety.",
  },
  clinical: {
    title: "Clinical & population evidence — external databases",
    subtitle: "ClinicalTrials.gov landscape, PharmGKB pharmacogenomics, DisGeNET gene–disease associations and gnomAD population constraint.",
    catalogue: [
      { key: "clinical_trials", name: "ClinicalTrials.gov — registered trial landscape", requires: "Target or indication" },
      { key: "pharmgkb", name: "PharmGKB — pharmacogenomics", requires: "Resolved gene symbol" },
      { key: "disgenet", name: "DisGeNET — gene–disease associations", requires: "Resolved gene symbol" },
      { key: "gnomad", name: "gnomAD — population constraint and variation", requires: "Resolved gene symbol" },
    ],
    limitations: "Population constraint describes the tolerance of the gene to loss of function in the general population; it is a target-risk signal, not a compound-risk signal.",
  },
} as const;

export const L3_DATA_SOURCES = [
  { name: "EPA ToxRefDB", category: "Regulatory toxicology", role: "Measured in-vivo NOAEL/LOAEL anchors", priority: "primary", integration_mode: "live query", url: "https://www.epa.gov/chemical-research/toxicity-forecasting" },
  { name: "EPA ToxValDB", category: "Regulatory toxicology", role: "Curated point-of-departure values across study types", priority: "primary", integration_mode: "live query", url: "https://www.epa.gov/comptox-tools" },
  { name: "EPA ToxCast / Tox21", category: "Mechanistic screening", role: "In-vitro bioactivity battery for hazard-domain drivers", priority: "primary", integration_mode: "live query", url: "https://www.epa.gov/comptox-tools" },
  { name: "ChEMBL", category: "Bioactivity", role: "Target potency, selectivity read-across and clinical-phase annotation", priority: "primary", integration_mode: "live query", url: "https://www.ebi.ac.uk/chembl/" },
  { name: "PubChem", category: "Chemistry", role: "Structural neighbours, assay summaries and identity resolution", priority: "primary", integration_mode: "live query", url: "https://pubchem.ncbi.nlm.nih.gov/" },
  { name: "PK-DB", category: "Pharmacokinetics", role: "Observed clinical pharmacokinetic anchors for projection grading", priority: "primary", integration_mode: "live query", url: "https://pk-db.com/" },
  { name: "openFDA Drugs@FDA", category: "Regulatory", role: "Approval precedent, labelling and boxed-warning context", priority: "primary", integration_mode: "live query", url: "https://open.fda.gov/" },
  { name: "UniProt", category: "Protein", role: "Canonical protein identity, sequence and organism", priority: "primary", integration_mode: "live query", url: "https://www.uniprot.org/" },
  { name: "RCSB PDB", category: "Structure", role: "Experimental structures for docking and pocket definition", priority: "secondary", integration_mode: "live query", url: "https://www.rcsb.org/" },
  { name: "AlphaFold DB", category: "Structure", role: "Predicted structure where no experimental one exists", priority: "secondary", integration_mode: "live query", url: "https://alphafold.ebi.ac.uk/" },
  { name: "ICH guidelines", category: "Reporting standard", role: "Study-design envelopes, exposure tables and safety-pharmacology scope", priority: "standard", integration_mode: "embedded reference", url: "https://www.ich.org/" },
  { name: "OECD test guidelines", category: "Reporting standard", role: "Repeat-dose, genotoxicity and local-tolerance study definitions", priority: "standard", integration_mode: "embedded reference", url: "https://www.oecd.org/chemicalsafety/testing/" },
  { name: "EU Directive 2010/63", category: "Welfare standard", role: "Prospective severity classification and humane-endpoint framework", priority: "standard", integration_mode: "embedded reference", url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32010L0063" },
  { name: "ARRIVE 2.0", category: "Reporting standard", role: "Required protocol elements for an animal-study report", priority: "standard", integration_mode: "embedded reference", url: "https://arriveguidelines.org/" },
];

/* ── first-in-human regulatory context ───────────────────────────────────── */

export const FDA_RISK_FACTORS = [
  { id: "steep_dose_response", label: "Steep dose–response in the toxicology species", additional_factor: 3 },
  { id: "severe_irreversible_toxicity", label: "Severe or irreversible toxicity observed", additional_factor: 3 },
  { id: "nonmonitorable_toxicity", label: "Toxicity without a monitorable prodrome", additional_factor: 3 },
  { id: "variable_bioavailability", label: "Highly variable bioavailability", additional_factor: 2 },
  { id: "nonlinear_pk", label: "Non-linear pharmacokinetics over the studied range", additional_factor: 2 },
  { id: "novel_target", label: "Novel target class with no clinical precedent", additional_factor: 2 },
  { id: "inadequate_dose_response", label: "Inadequate dose–response characterisation", additional_factor: 2 },
  { id: "poor_animal_model", label: "Animal model of limited relevance to human", additional_factor: 3 },
] as const;

export const REGULATORY_REGIONS = [
  { id: "FDA", name: "United States FDA", application: "Investigational New Drug (IND)", framework: "21 CFR 312; ICH M3(R2)", region_specific: ["A 30-day IND safety review must elapse before dosing.", "A dedicated pre-IND meeting is strongly advised for a novel target class.", "Nonclinical studies supporting the IND must be conducted under 21 CFR Part 58 GLP."] },
  { id: "EMA", name: "European Medicines Agency", application: "Clinical Trial Application (CTA)", framework: "Regulation (EU) 536/2014; EMA/CHMP/SWP/28367/07 Rev.1", region_specific: ["The MABEL approach must be presented alongside the NOAEL/HED route, with the lower value governing.", "An integrated first-in-human protocol combining SAD and MAD parts requires explicit stopping rules.", "Sentinel dosing is expected for the first cohort."] },
  { id: "PMDA", name: "Japan PMDA", application: "Clinical Trial Notification (CTN)", framework: "PMD Act; ICH M3(R2)", region_specific: ["A 30-day CTN review period applies for the first trial of a new active substance.", "Japanese-population pharmacokinetic bridging is normally expected before a pivotal trial.", "Consultation with the PMDA before the CTN is customary."] },
  { id: "MHRA", name: "United Kingdom MHRA", application: "Clinical Trial Authorisation (CTA)", framework: "UK SI 2004/1031; MHRA Phase 1 accreditation scheme", region_specific: ["Phase 1 units handling higher-risk agents must hold MHRA accreditation.", "The Combined Ways of Working route allows a joint MHRA and ethics review."] },
  { id: "NMPA", name: "China NMPA", application: "Investigational New Drug (IND)", framework: "Drug Administration Law; CDE technical guidance", region_specific: ["A 60-working-day implied-licence review applies.", "Studies must be conducted in NMPA-recognised GLP facilities."] },
] as const;

export const IND_CHECKLIST = [
  { id: "pharmacology_primary", requirement: "Primary pharmacodynamics — target engagement and mechanism", guideline: "ICH M3(R2) §3", satisfiable_by_simulation: true, contribution: "Layer 2 target engagement and the affinity anchor" },
  { id: "safety_pharmacology", requirement: "Safety pharmacology core battery (cardiovascular, CNS, respiratory)", guideline: "ICH S7A / S7B", satisfiable_by_simulation: false, contribution: "Layer 3 projects the assessment; the study itself must be conducted" },
  { id: "pharmacokinetics", requirement: "Absorption, distribution, metabolism and excretion characterisation", guideline: "ICH M3(R2) §4", satisfiable_by_simulation: true, contribution: "Layer 3 PBPK exposure and biodistribution" },
  { id: "toxicokinetics", requirement: "Toxicokinetic exposure across the dose range", guideline: "ICH S3A", satisfiable_by_simulation: true, contribution: "Layer 3 ICH S3A exposure table" },
  { id: "repeat_dose_tox", requirement: "Repeat-dose toxicity in a rodent and a non-rodent species", guideline: "ICH M3(R2) Table 1", satisfiable_by_simulation: false, contribution: "Layer 3 designs and projects it; the GLP study must be conducted" },
  { id: "genotoxicity", requirement: "Genotoxicity battery (Ames + in-vitro mammalian)", guideline: "ICH S2(R1)", satisfiable_by_simulation: false, contribution: "Layer 1 predicts the hazard; the battery must be run" },
  { id: "local_tolerance", requirement: "Local tolerance at the intended route of administration", guideline: "ICH M3(R2) §12", satisfiable_by_simulation: false, contribution: "Layer 3 flags the domain; the study must be conducted" },
  { id: "reproductive_tox", requirement: "Reproductive toxicity appropriate to the enrolled population", guideline: "ICH S5(R3)", satisfiable_by_simulation: false, contribution: "Required only for the population actually enrolled" },
  { id: "impurity_qualification", requirement: "Impurity identification and qualification", guideline: "ICH Q3A/Q3B; M7(R2) for mutagenic impurities", satisfiable_by_simulation: false, contribution: "Chemistry, manufacturing and controls — outside this platform" },
  { id: "cmc", requirement: "Chemistry, manufacturing and controls package", guideline: "21 CFR 312.23(a)(7)", satisfiable_by_simulation: false, contribution: "Outside this platform" },
  { id: "starting_dose_rationale", requirement: "Justification of the proposed starting dose", guideline: "FDA (2005); EMA/CHMP/SWP/28367/07 Rev.1", satisfiable_by_simulation: true, contribution: "Layer 4 NOAEL/HED and MABEL reconciliation" },
  { id: "protocol", requirement: "Clinical protocol with escalation and stopping rules", guideline: "21 CFR 312.23(a)(6)", satisfiable_by_simulation: true, contribution: "Layer 4 SAD/MAD design and stopping rules" },
];

export const PHASE1_SUBSTUDIES = [
  { id: "food_effect", name: "Food-effect assessment", guideline: "FDA Food-Effect Bioavailability guidance (2022)", gating_input: "Oral route with solubility- or permeability-limited absorption" },
  { id: "ddi_victim", name: "Drug–drug interaction (victim)", guideline: "FDA In Vitro Drug Interaction Studies (2020)", gating_input: "Fraction metabolised by a single CYP isoform above 0.25" },
  { id: "ddi_perpetrator", name: "Drug–drug interaction (perpetrator)", guideline: "FDA In Vitro Drug Interaction Studies (2020)", gating_input: "A flagged CYP inhibition probability at the projected unbound exposure" },
  { id: "qt_thorough", name: "Concentration–QTc assessment", guideline: "ICH E14 Q&A (R3) — concentration–QTc in Phase 1", gating_input: "A hERG flag or a cardiovascular safety-pharmacology signal" },
  { id: "hepatic_impairment", name: "Hepatic impairment study", guideline: "FDA Pharmacokinetics in Hepatic Impairment (2003)", gating_input: "Hepatic clearance fraction above 0.5" },
  { id: "renal_impairment", name: "Renal impairment study", guideline: "FDA Pharmacokinetics in Renal Impairment (2020)", gating_input: "Renal clearance fraction above 0.3" },
  { id: "mass_balance", name: "Radiolabelled mass balance", guideline: "ICH M3(R2) §4; EMA metabolite guidance", gating_input: "Any programme proceeding to Phase 2" },
  { id: "pgx", name: "Pharmacogenomic sampling", guideline: "FDA Clinical Pharmacogenomics (2013)", gating_input: "Substrate of a polymorphic isoform (CYP2D6, CYP2C19, CYP2C9)" },
] as const;

/* ── welfare ─────────────────────────────────────────────────────────────── */

export const HUMANE_ENDPOINTS = [
  { trigger: "Body-weight loss", threshold: "≥ 20% from the study baseline, or ≥ 15% sustained for 72 h", action: "Humane euthanasia; record as an unscheduled death", source: "EU Directive 2010/63 Annex VIII; OECD GD 19" },
  { trigger: "Moribund condition", threshold: "Inability to reach food or water; loss of righting reflex", action: "Immediate humane euthanasia", source: "OECD Guidance Document 19 (2000)" },
  { trigger: "Clinical score", threshold: "Composite welfare score above the protocol-defined intervention threshold on two consecutive assessments", action: "Veterinary review and consideration of euthanasia", source: "EU Directive 2010/63 Article 15" },
  { trigger: "Persistent hypothermia", threshold: "Core temperature below 34 °C", action: "Immediate humane euthanasia", source: "OECD Guidance Document 19 (2000)" },
  { trigger: "Uncontrolled convulsions", threshold: "More than two tonic-clonic episodes within 24 h", action: "Immediate humane euthanasia", source: "EU Directive 2010/63 Annex VIII" },
  { trigger: "Injection- or application-site reaction", threshold: "Ulceration or necrosis exceeding the protocol-defined area", action: "Discontinue dosing at that site; veterinary review", source: "OECD 404 severity criteria" },
];

export const BLOOD_SAMPLING_LIMITS: Record<string, { bloodVolumeMlPerKg: number; source: string }> = {
  rat: { bloodVolumeMlPerKg: 64, source: "Diehl et al., J Appl Toxicol (2001) — recommended blood-sampling volumes" },
  mouse: { bloodVolumeMlPerKg: 72, source: "Diehl et al., J Appl Toxicol (2001)" },
  dog: { bloodVolumeMlPerKg: 85, source: "Diehl et al., J Appl Toxicol (2001)" },
  monkey: { bloodVolumeMlPerKg: 65, source: "Diehl et al., J Appl Toxicol (2001)" },
  rabbit: { bloodVolumeMlPerKg: 70, source: "Diehl et al., J Appl Toxicol (2001)" },
  minipig: { bloodVolumeMlPerKg: 65, source: "Diehl et al., J Appl Toxicol (2001)" },
  human: { bloodVolumeMlPerKg: 70, source: "Not applicable — human sampling follows the clinical protocol" },
};

/* ── validation evidence ─────────────────────────────────────────────────── */

export const VALIDATION_STUDIES = [
  {
    id: "pbpk_rat_iv", title: "Rat intravenous PBPK exposure validation", status: "qualified", use_decision: "Qualified for rat intravenous AUC and Cmax projection within a 3-fold band.",
    input_mode: "measured disposition", endpoint: "Plasma AUC0–∞ and Cmax", species: "rat", n_test: 68, n_skipped: 7,
    metrics: { median_fold_error: 1.62, within_2x: 0.74, within_3x: 0.91, raw_interval_coverage: 0.61, calibrated_coverage: 0.90, calibrated_halfwidth_fold: 3.4 },
    interpretation: "With measured fu and CLint the projection sits inside 2-fold for three quarters of the held-out set. Predicted-input runs degrade to a median 2.8-fold error and are reported separately.",
    benchmark: "validation/datasets/rat_iv_pk_holdout_v3.csv", report: "validation/reports/pbpk_rat_iv_2026-06.md", reproduce: "make validate-pbpk SPECIES=rat ROUTE=IV",
  },
  {
    id: "pbpk_rat_oral", title: "Rat oral PBPK exposure validation", status: "qualified_with_limitations", use_decision: "Qualified for rank-ordering oral exposure; absolute AUC carries a wider band than the intravenous route.",
    input_mode: "measured disposition", endpoint: "Plasma AUC0–t after oral gavage", species: "rat", n_test: 51, n_skipped: 14,
    metrics: { median_fold_error: 2.31, within_2x: 0.53, within_3x: 0.78, raw_interval_coverage: 0.55, calibrated_coverage: 0.88, calibrated_halfwidth_fold: 5.1 },
    interpretation: "Oral exposure inherits the absorption-model uncertainty on top of the disposition uncertainty. Formulation effects are not modelled at all, which is the dominant residual.",
    benchmark: "validation/datasets/rat_oral_pk_holdout_v2.csv", report: "validation/reports/pbpk_rat_oral_2026-06.md", reproduce: "make validate-pbpk SPECIES=rat ROUTE=ORAL",
  },
  {
    id: "human_cl_projection", title: "Human clearance projection from in-vitro inputs", status: "qualified_with_limitations", use_decision: "Qualified for a first-in-human clearance estimate with an explicit 3-fold band, not for dose setting on its own.",
    input_mode: "measured human hepatocyte CLint and fu", endpoint: "Plasma clearance", species: "human", n_test: 94, n_skipped: 11,
    metrics: { median_fold_error: 1.94, within_2x: 0.62, within_3x: 0.84, raw_interval_coverage: 0.58, calibrated_coverage: 0.91, calibrated_halfwidth_fold: 4.2 },
    interpretation: "Well-stirred IVIVE systematically under-predicts clearance for high-extraction and transporter-dependent compounds; both classes are flagged in the projection rather than corrected.",
    benchmark: "validation/datasets/human_cl_obach_holdout.csv", report: "validation/reports/human_cl_2026-05.md", reproduce: "make validate-ivive SPECIES=human",
  },
  {
    id: "tissue_kp", title: "Tissue:plasma partition coefficient validation", status: "indicative", use_decision: "Indicative only. Adequate for ranking tissues, not for an absolute tissue-concentration claim.",
    input_mode: "predicted logP and fu", endpoint: "Tissue:plasma AUC ratio", species: "rat", n_test: 29, n_skipped: 3,
    metrics: { median_fold_error: 2.85, within_2x: 0.41, within_3x: 0.66, raw_interval_coverage: 0.47, calibrated_coverage: 0.82, calibrated_halfwidth_fold: 7.8 },
    interpretation: "Adipose and brain are the two worst-predicted compartments: adipose because the partition is exquisitely logP-sensitive, brain because efflux is not captured by a passive partition model.",
    benchmark: "validation/datasets/rodgers_rowland_kp_holdout.csv", report: "validation/reports/tissue_kp_2026-04.md", reproduce: "make validate-kp",
  },
];

export const VALIDATION_ENDPOINT_COVERAGE = [
  { endpoint: "Plasma AUC and Cmax (IV, rodent)", status: "qualified", coverage: "Held-out validation with measured disposition inputs; median 1.6-fold error." },
  { endpoint: "Plasma AUC and Cmax (oral, rodent)", status: "qualified_with_limitations", coverage: "Held-out validation; formulation effects are outside the model." },
  { endpoint: "Human clearance projection", status: "qualified_with_limitations", coverage: "Held-out validation against the Obach curated set with an explicit 3-fold band." },
  { endpoint: "Tissue:plasma partition", status: "indicative", coverage: "Ranking only. No absolute tissue-concentration claim is supported." },
  { endpoint: "NOAEL prediction", status: "not_qualified", coverage: "No validation set exists. The platform reports points of departure and their provenance rather than predicting a NOAEL." },
  { endpoint: "Human dose-limiting toxicity rate", status: "not_qualified", coverage: "Out of scope. The platform predicts hazard mechanisms, not clinical DLT incidence." },
  { endpoint: "Histopathological finding incidence", status: "not_qualified", coverage: "Out of scope. Anticipated findings are a mechanism-to-endpoint mapping, not a prediction of occurrence." },
];

export const VALIDATION_METHODOLOGY = [
  "Held-out compounds are selected by scaffold split, so a close analogue of a test compound never appears in training.",
  "Fold error is reported as the median of |predicted / observed| and its complement, so over- and under-prediction are weighted equally.",
  "Interval coverage is the fraction of observations falling inside the reported 90% band, before and after conformal calibration.",
  "Runs where a required input was unavailable are skipped and counted, never imputed — an imputed input would inflate the apparent accuracy.",
];

export const VALIDATION_LIMITATIONS = [
  "Every validation set is retrospective and drawn from published literature, which is biased toward compounds that progressed.",
  "Non-human clearance derived from a human-trained model is flagged low confidence and is not covered by any of these validation sets.",
  "No validation exists for the toxicology hazard domains, because no held-out set of matched in-vivo outcomes was available at the required scale.",
];
