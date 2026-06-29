/**
 * Falsifier Registry — v2.0.0 §5.6 / §10.1.
 *
 * Versioned independently of the schema (the package carries
 * `falsifierRegistryVersion` so consumers can detect drift). Adding a new
 * entry is a registry version bump; deprecating one is a separate workflow
 * (out of scope for this build).
 *
 * The seed entries below cover the worked example in spec §9 (BSEP off-target
 * falsifier accepted → MABEL bias required) plus a representative spread
 * across the five PredictionDomains. `mabelBiasRequired` is the single
 * property `Phase1Planner.shouldApplyMabelBias()` branches on.
 */

import {
  asFalsifierId,
  type FalsifierRegistry,
  type FalsifierRegistryEntry,
} from "./v2_0_0.js";

export const FALSIFIER_REGISTRY_VERSION = "falsifier-registry-2026.05" as const;

const ENTRIES: FalsifierRegistryEntry[] = [
  {
    id: asFalsifierId("FX-OFFTARGET-BSEP-INHIB"),
    description:
      "BSEP inhibition IC50 < 25 µM — bile salt export pump signal indicates cholestatic DILI risk on top of any predicted off-target hit.",
    appliesTo: "off_target",
    defaultTriggerCondition: {
      expression: "bsep_ic50 < 25 µM",
      assayId: "bsep_inhibition",
      comparator: "lt",
      threshold: 25,
      unit: "µM",
    },
    regulatoryRelevance: ["FDA-DILI-guidance", "ICH-S7A"],
    mabelBiasRequired: true,
    introducedInVersion: FALSIFIER_REGISTRY_VERSION,
  },
  {
    id: asFalsifierId("FX-CLEARANCE-OVERPREDICT"),
    description:
      "Hepatocyte clearance > 3× predicted — in-silico clearance under-modelled; Phase1Planner cannot trust HED-based scaling without ex-vivo correction.",
    appliesTo: "clearance_fractions",
    defaultTriggerCondition: {
      expression: "measured_clearance > 3× predicted",
      assayId: "primary_hepatocyte_clearance",
      comparator: "fold_gt",
      threshold: 3,
      unit: "mL/min/kg",
    },
    regulatoryRelevance: ["ICH-M3R2"],
    mabelBiasRequired: false,
    introducedInVersion: FALSIFIER_REGISTRY_VERSION,
  },
  {
    id: asFalsifierId("FX-HERG-IC50-LT-3UM"),
    description:
      "ex-vivo hERG patch-clamp IC50 < 3 µM — hard ICH-S7B trigger; in-silico hERG-PBPK projection is falsified regardless of predicted Cmax margin.",
    appliesTo: "herg_pbpk",
    defaultTriggerCondition: {
      expression: "herg_patch_clamp_ic50 < 3 µM",
      assayId: "herg_patch_clamp",
      comparator: "lt",
      threshold: 3,
      unit: "µM",
    },
    regulatoryRelevance: ["ICH-S7B"],
    mabelBiasRequired: true,
    introducedInVersion: FALSIFIER_REGISTRY_VERSION,
  },
  {
    id: asFalsifierId("FX-CYP3A4-IC50-LT-1UM"),
    description:
      "CYP3A4 IC50 < 1 µM — strong index inhibitor signal; CYP-Transporter joint output cannot pass without override.",
    appliesTo: "cyp_transporter",
    defaultTriggerCondition: {
      expression: "cyp3a4_inhibition_ic50 < 1 µM",
      assayId: "cyp3a4_inhibition_panel",
      comparator: "lt",
      threshold: 1,
      unit: "µM",
    },
    regulatoryRelevance: ["FDA-DILI-guidance"],
    mabelBiasRequired: false,
    introducedInVersion: FALSIFIER_REGISTRY_VERSION,
  },
  {
    id: asFalsifierId("FX-DOSERESPONSE-FLAT"),
    description:
      "Ex-vivo dose-response is flat across 1000× concentration window — predicted potency curve falsified; on-target engagement cannot be confirmed.",
    appliesTo: "dose_response",
    defaultTriggerCondition: {
      expression: "fold_response < 1.5 over 1000× dose window",
      assayId: "primary_cellular_dose_response",
      comparator: "fold_lt",
      threshold: 1.5,
      unit: "fold",
    },
    regulatoryRelevance: ["EMA-MABEL-guidance"],
    mabelBiasRequired: true,
    introducedInVersion: FALSIFIER_REGISTRY_VERSION,
  },
];

export const FALSIFIER_REGISTRY: FalsifierRegistry = {
  version: FALSIFIER_REGISTRY_VERSION,
  entries: ENTRIES,
};

export function getFalsifierEntry(
  id: string,
): FalsifierRegistryEntry | null {
  return ENTRIES.find((e) => e.id === (id as FalsifierRegistryEntry["id"])) ?? null;
}

export function listFalsifiersForDomain(
  domain: FalsifierRegistryEntry["appliesTo"],
): FalsifierRegistryEntry[] {
  return ENTRIES.filter((e) => e.appliesTo === domain);
}
