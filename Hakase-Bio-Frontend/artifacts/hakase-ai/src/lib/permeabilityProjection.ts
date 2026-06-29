/**
 * Stage 5 — Permeability projection (deterministic L1 surfacing).
 *
 * Pulls the L1 in-vitro Caco-2 Papp value (×10⁻⁶ cm/s) into the Ex-Vivo Stage 5
 * envelope. Optional brain Kp,uu override accepts measured MDR1-MDCK efflux
 * ratio derivation or PET imaging — surfaced verbatim, NEVER imputed.
 *
 * Pure function, no I/O. The brain Kp,uu value is opt-in: when undefined the
 * envelope reports "unmeasured (user override available)" honestly rather
 * than fabricating a CNS prediction from clogP / TPSA.
 */

import type { InVitroResults } from "./inVitroSim";

export interface PermeabilityProjection {
  caco2Papp_x10minus6: number;
  brainKpUu_override?: number;
}

export function projectPermeability(
  l1: InVitroResults,
  brainKpUu_override?: number,
): PermeabilityProjection {
  return {
    caco2Papp_x10minus6: l1.permeability.caco2Papp,
    brainKpUu_override,
  };
}
