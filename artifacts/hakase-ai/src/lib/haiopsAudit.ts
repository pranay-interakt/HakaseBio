/**
 * HAIOps audit log.
 *
 * Append-only, hash-chained record of every governance-relevant event in a
 * simulation session. Each event holds:
 *   - a typed payload (flag raised, flag acknowledged, override applied,
 *     applicability-domain breach, database degraded, evidence signed,
 *     model-drift detected)
 *   - an attestation (actor identity + role + reason) for any human action
 *   - a `prevHash` linking to the previous event
 *   - a `hash` over the canonical-JSON of the rest of the record
 *
 * Properties guaranteed by the construction:
 *   1. Tamper-evidence: any modification to a past event breaks the chain;
 *      `verifyChain` detects this and reports the first broken link.
 *   2. Deterministic identity: identical events on identical predecessors
 *      produce identical hashes.
 *   3. Ordering: events are strictly sequential — no concurrent appends.
 *
 * Compatibility:
 *   The hashing is the same FNV-1a 64-bit fingerprint used elsewhere in L1
 *   (`fingerprint64`), so the entire audit chain is verifiable synchronously
 *   in the browser. A SHA-256 chain over the same canonical-JSON is also
 *   provided for export to regulatory systems that require cryptographic
 *   strength.
 */

import {
  canonicalJSON,
  fingerprint64,
  sha256Hex,
} from "./uncertainty";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type AuditActorRole =
  | "user"            // logged-in operator
  | "reviewer"        // designated clinical / scientific reviewer
  | "system"          // automated event from the platform itself
  | "dsmb"            // data safety monitoring board signoff
  | "regulator";      // external auditor

export interface AuditActor {
  /** Stable identifier — userId, system component name, or "anonymous". */
  id: string;
  /** Display name shown in audit views. */
  displayName: string;
  role: AuditActorRole;
  /** Optional credential string (e.g. ORCID, DEA, FDA reviewer ID). */
  credential?: string;
}

export interface AuditAttestation {
  actor: AuditActor;
  /** Free-text rationale — required for overrides and acknowledgements. */
  reason: string;
  /** ISO timestamp of the attestation, separate from the event timestamp. */
  attestedAt: string;
}

export type AuditEventType =
  | "session_started"
  | "flag_raised"
  | "flag_acknowledged"
  | "verdict_overridden"
  | "ad_breach"
  | "db_degraded"
  | "evidence_signed"
  | "model_drift_detected"
  | "model_drift_cleared"
  | "session_closed";

export interface AuditEvent {
  /** Sequence number, starts at 0 for genesis. */
  seq: number;
  /** ISO timestamp the event was emitted. */
  timestamp: string;
  type: AuditEventType;
  /** Which layer (1/2/3/4) emitted the event; 0 for cross-cutting events. */
  layer: number;
  /** Stable id of the artefact the event refers to (flag id, model version, etc.). */
  subjectId?: string;
  /** Free-form structured payload. Must be canonicalJSON-serializable. */
  payload: unknown;
  /** Attestation, required for any human-initiated event. */
  attestation?: AuditAttestation;
  /** Hash of the prior event; "GENESIS" for the first one. */
  prevHash: string;
  /** Hash over the canonical-JSON of this event with `hash` field omitted. */
  hash: string;
}

export interface AuditChain {
  events: AuditEvent[];
  /** Hash of the most recent event ("GENESIS" if empty). */
  headHash: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Construction
// ────────────────────────────────────────────────────────────────────────────

export function createAuditChain(): AuditChain {
  return { events: [], headHash: "GENESIS" };
}

interface DraftEvent {
  type: AuditEventType;
  layer: number;
  subjectId?: string;
  payload: unknown;
  attestation?: AuditAttestation;
}

const HUMAN_EVENT_TYPES = new Set<AuditEventType>([
  "flag_acknowledged",
  "verdict_overridden",
]);

/**
 * Compute the canonical-form hash for an event. The `hash` field itself is
 * excluded from the canonical form so we get a stable digest.
 */
function hashEvent(e: Omit<AuditEvent, "hash">): string {
  return fingerprint64(canonicalJSON(e));
}

/**
 * Append a new event to the chain. Returns a *new* chain — the input is not
 * mutated (functional updates make React/Zustand integration safe).
 *
 * Throws if a human-action event arrives without an attestation: HAIOps
 * requires explicit accountability for every override or acknowledgement.
 */
export function appendEvent(chain: AuditChain, draft: DraftEvent): AuditChain {
  if (HUMAN_EVENT_TYPES.has(draft.type) && !draft.attestation) {
    throw new Error(`HAIOps: ${draft.type} requires an attestation`);
  }
  const seq = chain.events.length;
  const base: Omit<AuditEvent, "hash"> = {
    seq,
    timestamp: new Date().toISOString(),
    type: draft.type,
    layer: draft.layer,
    subjectId: draft.subjectId,
    payload: draft.payload,
    attestation: draft.attestation,
    prevHash: chain.headHash,
  };
  const hash = hashEvent(base);
  const event: AuditEvent = { ...base, hash };
  return {
    events: [...chain.events, event],
    headHash: hash,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Verification
// ────────────────────────────────────────────────────────────────────────────

export interface ChainVerification {
  ok: boolean;
  /** Index of the first broken event, if any. */
  brokenAt?: number;
  /** Human-readable reason for the break. */
  reason?: string;
}

/**
 * Re-derive every event's hash and check the chain. Detects: tampering with
 * past payloads, deleted events, reordered events, mismatched prevHash.
 */
export function verifyChain(chain: AuditChain): ChainVerification {
  let prev = "GENESIS";
  for (let i = 0; i < chain.events.length; i++) {
    const e = chain.events[i];
    if (e.seq !== i) {
      return { ok: false, brokenAt: i, reason: `seq mismatch (expected ${i}, got ${e.seq})` };
    }
    if (e.prevHash !== prev) {
      return { ok: false, brokenAt: i, reason: `prevHash mismatch` };
    }
    const { hash, ...rest } = e;
    const expected = hashEvent(rest);
    if (hash !== expected) {
      return { ok: false, brokenAt: i, reason: `payload hash mismatch (event tampered)` };
    }
    if (HUMAN_EVENT_TYPES.has(e.type) && !e.attestation) {
      return { ok: false, brokenAt: i, reason: `human action without attestation` };
    }
    prev = hash;
  }
  if (chain.headHash !== prev) {
    return { ok: false, brokenAt: chain.events.length, reason: "headHash mismatch" };
  }
  return { ok: true };
}

/**
 * Produce a cryptographic-strength digest of the audit chain by re-hashing
 * with SHA-256. Use this when exporting an audit trail to a regulator —
 * FNV-1a is fast and tamper-evident within a session, but SHA-256 is the
 * standard accepted by external audit systems.
 */
export async function chainSha256(chain: AuditChain): Promise<string> {
  return sha256Hex(canonicalJSON(chain.events));
}

// ────────────────────────────────────────────────────────────────────────────
// Typed payload constructors (DSL — guarantees canonical, schema-stable JSON)
// ────────────────────────────────────────────────────────────────────────────

export const Events = {
  sessionStarted(meta: { sessionId: string; molName?: string; smiles?: string }): DraftEvent {
    return {
      type: "session_started",
      layer: 0,
      subjectId: meta.sessionId,
      payload: { schemaVersion: "audit.session/1", ...meta },
    };
  },
  flagRaised(flag: { id: string; type: string; severity: string; label: string; originLayer: number; value?: string }): DraftEvent {
    return {
      type: "flag_raised",
      layer: flag.originLayer,
      subjectId: flag.id,
      payload: { schemaVersion: "audit.flag/1", ...flag },
    };
  },
  flagAcknowledged(
    flagId: string,
    layer: number,
    attestation: AuditAttestation,
  ): DraftEvent {
    return {
      type: "flag_acknowledged",
      layer,
      subjectId: flagId,
      payload: { schemaVersion: "audit.ack/1", flagId },
      attestation,
    };
  },
  verdictOverridden(
    fromVerdict: string,
    toVerdict: string,
    layer: number,
    attestation: AuditAttestation,
    flagsAtTime: string[],
  ): DraftEvent {
    return {
      type: "verdict_overridden",
      layer,
      subjectId: `verdict@L${layer}`,
      payload: {
        schemaVersion: "audit.override/1",
        fromVerdict,
        toVerdict,
        flagsAtTime,
      },
      attestation,
    };
  },
  adBreach(
    modelVersion: string,
    layer: number,
    details: { descriptor: string; value: number; trainingRange: [number, number] }[],
  ): DraftEvent {
    return {
      type: "ad_breach",
      layer,
      subjectId: modelVersion,
      payload: { schemaVersion: "audit.adbreach/1", modelVersion, details },
    };
  },
  dbDegraded(
    database: string,
    status: "failed" | "cached" | "skipped",
    detail?: string,
  ): DraftEvent {
    return {
      type: "db_degraded",
      layer: 0,
      subjectId: database,
      payload: { schemaVersion: "audit.db/1", database, status, detail },
    };
  },
  evidenceSigned(
    layer: number,
    evidenceHash: string,
    fingerprint: string,
    modelVersions: string[],
  ): DraftEvent {
    return {
      type: "evidence_signed",
      layer,
      subjectId: `evt://l${layer}/${evidenceHash}`,
      payload: { schemaVersion: "audit.evidence/1", evidenceHash, fingerprint, modelVersions },
    };
  },
  modelDriftDetected(
    modelVersion: string,
    reason: string,
    expectedHash: string,
    observedHash?: string,
  ): DraftEvent {
    return {
      type: "model_drift_detected",
      layer: 0,
      subjectId: modelVersion,
      payload: { schemaVersion: "audit.drift/1", modelVersion, reason, expectedHash, observedHash },
    };
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Queries
// ────────────────────────────────────────────────────────────────────────────

export function eventsOfType(chain: AuditChain, type: AuditEventType): AuditEvent[] {
  return chain.events.filter(e => e.type === type);
}

export function eventsForSubject(chain: AuditChain, subjectId: string): AuditEvent[] {
  return chain.events.filter(e => e.subjectId === subjectId);
}

/**
 * Has a given flag id been acknowledged? Returns the attesting event, if any.
 */
export function findAcknowledgement(chain: AuditChain, flagId: string): AuditEvent | null {
  for (let i = chain.events.length - 1; i >= 0; i--) {
    const e = chain.events[i];
    if (e.type === "flag_acknowledged" && e.subjectId === flagId) return e;
  }
  return null;
}

/**
 * Has the operator overridden a NO-GO at a given layer? Returns the latest
 * override event for that layer, if any. Downstream layers should surface
 * a "downstream-watch" advisory when this returns non-null.
 */
export function findActiveOverride(chain: AuditChain, layer: number): AuditEvent | null {
  for (let i = chain.events.length - 1; i >= 0; i--) {
    const e = chain.events[i];
    if (e.type === "verdict_overridden" && e.layer === layer) return e;
  }
  return null;
}
