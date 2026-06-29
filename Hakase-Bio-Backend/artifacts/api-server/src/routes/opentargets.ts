/**
 * Open Targets Platform proxy — target-disease associations for Layer 1.
 *
 * Open Targets aggregates genetic, genomic, and literature evidence linking
 * targets to diseases. This feeds the twin's target context panel with:
 *  - Disease associations (therapeutic area, score, evidence breakdown)
 *  - Target tractability (small molecule, antibody, PROTAC suitability)
 *  - Genetic constraint (gnomAD loss-of-function intolerance)
 *  - Drug pipeline (approved drugs, clinical candidates hitting this target)
 *  - Mouse phenotypes (KO data for safety assessment)
 *
 * Routes:
 *  GET /opentargets/target/:ensemblId      — full target profile
 *  GET /opentargets/target-by-gene/:gene   — resolve gene symbol → Ensembl → profile
 *  GET /opentargets/diseases/:ensemblId    — top disease associations
 *  GET /opentargets/drugs/:ensemblId       — approved + clinical drugs for this target
 */

import { Router } from "express";

const router  = Router();
const OT_API  = "https://api.platform.opentargets.org/api/v4/graphql";
const HEADERS = { "Content-Type": "application/json", "User-Agent": "HakaseAI-BioTwin/2.0" };
const TIMEOUT = 15_000;

// ── GraphQL helper ────────────────────────────────────────────────────────────

async function gql(query: string, variables: Record<string, any> = {}): Promise<any> {
  const resp = await fetch(OT_API, {
    method:  "POST",
    headers: HEADERS,
    body:    JSON.stringify({ query, variables }),
    signal:  AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw Object.assign(new Error(`Open Targets HTTP ${resp.status}`), { status: resp.status });
  const json = (await resp.json()) as any;
  if (json.errors?.length) throw new Error(json.errors[0].message ?? "GraphQL error");
  return json.data;
}

// ── GraphQL fragments ─────────────────────────────────────────────────────────

const TARGET_CORE = `
  id
  approvedSymbol
  approvedName
  biotype
  functionDescriptions
  constraint {
    upperBin
    constraintType
    score
  }
  tractability {
    label
    modality
    value
  }
  pathways {
    pathway
    pathwayId
    topLevelTerm
  }
`;

const DISEASE_ASSOC = `
  id
  score
  datatypeScores {
    componentId
    score
  }
  disease {
    id
    name
    description
    therapeuticAreas {
      id
      name
    }
  }
`;

// ── Routes ────────────────────────────────────────────────────────────────────

/** Full target profile by Ensembl gene ID. */
router.get("/opentargets/target/:ensemblId", async (req, res) => {
  const { ensemblId } = req.params;
  const Q = `query TargetProfile($id: String!) {
    target(ensemblId: $id) {
      ${TARGET_CORE}
      associatedDiseases(page: { index: 0, size: 10 }) {
        count
        rows { ${DISEASE_ASSOC} }
      }
    }
  }`;
  try {
    const data = await gql(Q, { id: ensemblId });
    const t = data?.target;
    if (!t) { res.status(404).json({ error: "Target not found", ensemblId }); return; }
    res.json(shapeTarget(t));
  } catch (err: any) {
    res.status(err?.status ?? 502).json({ error: err?.message ?? "Open Targets query failed", ensemblId });
  }
});

/** Resolve a gene symbol to Ensembl ID, then fetch the full target profile. */
router.get("/opentargets/target-by-gene/:gene", async (req, res) => {
  const { gene } = req.params;
  const Q = `query TargetByGene($q: String!) {
    search(queryString: $q, entityNames: ["target"]) {
      hits {
        id
        score
        object {
          ... on Target {
            ${TARGET_CORE}
            associatedDiseases(page: { index: 0, size: 10 }) {
              count
              rows { ${DISEASE_ASSOC} }
            }
          }
        }
      }
    }
  }`;
  try {
    const data = await gql(Q, { q: gene });
    const hits  = data?.search?.hits ?? [];
    const hit   = hits.find((h: any) => h.object?.approvedSymbol?.toLowerCase() === gene.toLowerCase())
                  ?? hits[0];
    if (!hit?.object) { res.status(404).json({ error: "Gene not found", gene }); return; }
    res.json({ searchScore: hit.score, ...shapeTarget(hit.object) });
  } catch (err: any) {
    res.status(err?.status ?? 502).json({ error: err?.message ?? "Open Targets gene search failed", gene });
  }
});

/** Disease associations for a target — larger page. */
router.get("/opentargets/diseases/:ensemblId", async (req, res) => {
  const { ensemblId } = req.params;
  const size = Math.min(25, parseInt((req.query.size as string) ?? "15") || 15);
  const Q = `query TargetDiseases($id: String!, $size: Int!) {
    target(ensemblId: $id) {
      approvedSymbol
      associatedDiseases(page: { index: 0, size: $size }, orderByScore: "score") {
        count
        rows { ${DISEASE_ASSOC} }
      }
    }
  }`;
  try {
    const data = await gql(Q, { id: ensemblId, size });
    const t = data?.target;
    if (!t) { res.status(404).json({ error: "Target not found", ensemblId }); return; }
    const rows = t.associatedDiseases?.rows ?? [];
    res.json({
      ensemblId,
      gene:             t.approvedSymbol,
      totalDiseases:    t.associatedDiseases?.count ?? 0,
      diseases:         rows.map((r: any) => ({
        diseaseId:        r.disease?.id,
        diseaseName:      r.disease?.name,
        description:      r.disease?.description ?? null,
        therapeuticAreas: (r.disease?.therapeuticAreas ?? []).map((a: any) => a.name),
        overallScore:     r.score,
        evidenceBreakdown: Object.fromEntries(
          (r.datatypeScores ?? []).map((d: any) => [d.componentId, d.score])
        ),
      })),
    });
  } catch (err: any) {
    res.status(err?.status ?? 502).json({ error: err?.message ?? "Open Targets diseases query failed" });
  }
});

/** Drugs in the pipeline hitting this target — approved + clinical. */
router.get("/opentargets/drugs/:ensemblId", async (req, res) => {
  const { ensemblId } = req.params;
  const Q = `query TargetDrugs($id: String!) {
    target(ensemblId: $id) {
      approvedSymbol
      knownDrugs(size: 50) {
        count
        rows {
          drug {
            id
            name
            maximumClinicalTrialPhase
            isApproved
            mechanismsOfAction {
              rows {
                actionType
                mechanismOfAction
              }
            }
          }
          disease {
            id
            name
          }
          phase
          status
          urls {
            niceName
            url
          }
        }
      }
    }
  }`;
  try {
    const data = await gql(Q, { id: ensemblId });
    const t = data?.target;
    if (!t) { res.status(404).json({ error: "Target not found", ensemblId }); return; }
    const rows = t.knownDrugs?.rows ?? [];
    const drugs = rows.map((r: any) => ({
      drugId:       r.drug?.id,
      drugName:     r.drug?.name,
      phase:        r.phase,
      status:       r.status,
      isApproved:   r.drug?.isApproved,
      maxPhase:     r.drug?.maximumClinicalTrialPhase,
      indication:   r.disease?.name ?? null,
      indicationId: r.disease?.id ?? null,
      mechanisms:   (r.drug?.mechanismsOfAction?.rows ?? []).map((m: any) => ({
        actionType: m.actionType,
        mechanism:  m.mechanismOfAction,
      })),
      trialUrls:    (r.urls ?? []).filter((u: any) => u.niceName?.includes("ClinicalTrials")),
    }));
    res.json({
      ensemblId,
      gene:       t.approvedSymbol,
      totalDrugs: t.knownDrugs?.count ?? 0,
      drugs,
    });
  } catch (err: any) {
    res.status(err?.status ?? 502).json({ error: err?.message ?? "Open Targets drugs query failed" });
  }
});

// ── Shape helper ──────────────────────────────────────────────────────────────

function shapeTarget(t: any) {
  // Tractability: group by modality (small_molecule, antibody, other_modalities)
  const tractability: Record<string, { label: string; value: boolean }[]> = {};
  for (const tr of (t.tractability ?? [])) {
    const mod = tr.modality ?? "other";
    if (!tractability[mod]) tractability[mod] = [];
    tractability[mod].push({ label: tr.label, value: tr.value });
  }

  // LoF constraint — upperBin 0 = unconstrained, 9 = essential (high intolerance)
  const lof = (t.constraint ?? []).find((c: any) => c.constraintType === "lof");

  const diseases = (t.associatedDiseases?.rows ?? []).map((r: any) => ({
    diseaseId:        r.disease?.id,
    diseaseName:      r.disease?.name,
    therapeuticAreas: (r.disease?.therapeuticAreas ?? []).map((a: any) => a.name),
    overallScore:     r.score,
  }));

  return {
    ensemblId:           t.id,
    gene:                t.approvedSymbol,
    proteinName:         t.approvedName,
    biotype:             t.biotype,
    function:            (t.functionDescriptions ?? []).join(" "),
    lofConstraint: lof ? {
      upperBin:    lof.upperBin,
      score:       lof.score,
      interpretation: lof.upperBin >= 8
        ? "Highly constrained — LoF likely lethal; essential gene; high safety risk"
        : lof.upperBin >= 5
        ? "Moderately constrained — some tolerance to LoF; moderate safety signal"
        : "Tolerant to LoF — lower on-target safety risk",
    } : null,
    tractability,
    topDiseases:  diseases,
    totalDiseases: t.associatedDiseases?.count ?? 0,
    pathways:     (t.pathways ?? []).slice(0, 10).map((p: any) => ({
      name:      p.pathway,
      id:        p.pathwayId,
      topLevel:  p.topLevelTerm,
    })),
  };
}

export default router;
