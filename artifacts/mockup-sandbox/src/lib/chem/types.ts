/**
 * Shared types for the chem-core engine.
 *
 * Every output value carries provenance so the UI can show *which* model produced
 * a number and what its applicability domain / confidence is. This is the
 * minimum bar for any decision-grade cheminformatics output.
 */

export type Provenance = {
  /** Stable identifier of the model that produced this value. */
  readonly model: string;
  /** Peer-reviewed reference for the model. */
  readonly reference: string;
  /** DOI / URL for the reference. */
  readonly doi?: string;
  /** Year published. */
  readonly year: number;
  /** Free-text note about applicability domain or caveats. */
  readonly note?: string;
};

export type Predicted<T> = {
  readonly value: T;
  /** 0-1 confidence; null if the model does not report one. */
  readonly confidence: number | null;
  /** Lower / upper 95 % CI when the model supports it. */
  readonly ci95?: readonly [number, number];
  readonly provenance: Provenance;
  /** True if the input is outside the training domain of the model. */
  readonly outOfDomain?: boolean;
  readonly warnings?: readonly string[];
};

export type Descriptors = {
  /** Average molecular weight in Da. */
  readonly mw: number;
  /** Exact (monoisotopic) mass in Da. */
  readonly exactMass: number;
  /** Molecular formula, e.g. "C13H18O2". */
  readonly formula: string;
  /** Wildman-Crippen calculated logP. */
  readonly clogP: number;
  /** Wildman-Crippen molar refractivity. */
  readonly mr: number;
  /** Topological polar surface area (Å²) — Ertl 2000. */
  readonly tpsa: number;
  /** Number of hydrogen-bond acceptors. */
  readonly hba: number;
  /** Number of hydrogen-bond donors. */
  readonly hbd: number;
  /** Number of rotatable bonds. */
  readonly rotatableBonds: number;
  readonly heavyAtoms: number;
  readonly aromaticRings: number;
  readonly aliphaticRings: number;
  readonly totalRings: number;
  /** Fraction of sp3 carbons (Lovering 2009). */
  readonly fsp3: number;
  readonly heteroatoms: number;
  readonly stereocenters: number;
};

export type DrugLikenessRule = {
  readonly name: string;
  readonly passes: boolean;
  readonly violations: readonly string[];
  readonly reference: string;
};

export type DrugLikeness = {
  readonly lipinski: DrugLikenessRule;
  readonly veber: DrugLikenessRule;
  readonly egan: DrugLikenessRule;
  readonly ghose: DrugLikenessRule;
  readonly muegge: DrugLikenessRule;
  readonly pfizer3_75: DrugLikenessRule;
  readonly gsk4_400: DrugLikenessRule;
  /** Composite overall verdict. */
  readonly overall: "drug-like" | "borderline" | "non-drug-like";
};

export type AlertHit = {
  readonly catalog: "PAINS_A" | "PAINS_B" | "PAINS_C" | "Brenk" | "NIH" | "Bickerton";
  readonly name: string;
  readonly smarts: string;
  readonly description: string;
};

export type StructuralAlerts = {
  readonly hits: readonly AlertHit[];
  readonly painsCount: number;
  readonly brenkCount: number;
  readonly nihCount: number;
};

export type ADMETValue = Predicted<number>;
export type ADMETClass = Predicted<"low" | "medium" | "high">;

export type ADMETProfile = {
  /** -------- Absorption -------- */
  /** Caco-2 apparent permeability log(Papp) [10⁻⁶ cm/s]. */
  readonly caco2: ADMETValue;
  /** Human intestinal absorption probability (0-1). */
  readonly hia: ADMETValue;
  /** Pgp substrate probability (0-1). */
  readonly pgpSubstrate: ADMETValue;
  readonly oralBioavailability30: ADMETValue;

  /** -------- Distribution -------- */
  /** logBB (brain/plasma partition). */
  readonly logBB: ADMETValue;
  /** Probability of BBB penetration (Clark 1999). */
  readonly bbbPenetrant: ADMETValue;
  /** Volume of distribution at steady state (L/kg) — Lombardo 2006. */
  readonly vss: ADMETValue;
  /** Plasma protein binding fraction (0-1). */
  readonly ppb: ADMETValue;

  /** -------- Metabolism -------- */
  readonly cyp1a2Inhibition: ADMETValue;
  readonly cyp2c9Inhibition: ADMETValue;
  readonly cyp2c19Inhibition: ADMETValue;
  readonly cyp2d6Inhibition: ADMETValue;
  readonly cyp3a4Inhibition: ADMETValue;

  /** -------- Excretion -------- */
  /** Total clearance (mL/min/kg). */
  readonly clearance: ADMETValue;
  /** Elimination half-life (h). */
  readonly halfLife: ADMETValue;

  /** -------- Toxicity -------- */
  /** hERG inhibition probability (Aronov 2005). */
  readonly hergRisk: ADMETValue;
  /** Drug-induced liver injury probability. */
  readonly dili: ADMETValue;
  /** AMES mutagenicity probability. */
  readonly ames: ADMETValue;
  /** Acute oral toxicity LD50 in rat (mg/kg). */
  readonly ld50: ADMETValue;
  /** Skin sensitization probability. */
  readonly skinSens: ADMETValue;

  /** Aggregated 0-1 ADMET scores for the radar chart, derived from above. */
  readonly aggregate: {
    readonly absorption: number;
    readonly distribution: number;
    readonly metabolism: number;
    readonly excretion: number;
    readonly toxicity: number;
  };
};

export type Solubility = Predicted<number>; // logS (mol/L)

export type BindingMeasurement = {
  readonly type: "Ki" | "Kd" | "IC50" | "EC50";
  /** nM. */
  readonly value: number;
  readonly target: string;
  readonly targetUniprot?: string;
  readonly assayId: string;
  readonly chemblId: string;
  readonly reference?: string;
};

export type MolecularProfile = {
  readonly smiles: string;
  readonly canonicalSmiles: string;
  readonly inchi: string;
  readonly inchiKey: string;
  readonly descriptors: Descriptors;
  readonly druglikeness: DrugLikeness;
  readonly qed: Predicted<number>;
  readonly saScore: Predicted<number>;
  readonly alerts: StructuralAlerts;
  readonly solubility: Solubility;
  readonly admet: ADMETProfile;
};

export type RankingWeights = {
  readonly qed: number;
  readonly toxicity: number;
  readonly binding: number;
  readonly sa: number;
};
