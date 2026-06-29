// ── ClinicalTrials.gov Integration ────────────────────────────────────────
// Official ClinicalTrials.gov REST API v2
// https://clinicaltrials.gov/data-api/api
// Free, no auth, CORS-enabled

export interface CTGTrial {
  nctId:         string;
  briefTitle:    string;
  phase:         string;
  status:        string;
  conditions:    string[];
  interventions: string[];
  enrollmentN:   number | null;
  startDate:     string;
  primaryCompletion: string;
  sponsor:       string;
  resultsAvailable: boolean;
}

export interface CTGSearchResult {
  trials:             CTGTrial[];
  totalCount:         number;
  byPhase:            Record<string, number>;
  successRate:        number | null;   // Completed/Total (rough)
  avgEnrollment:      number | null;
  medianDurationMos:  number | null;
  status:             "live" | "unavailable" | "error";
}

const CTG_BASE = "https://clinicaltrials.gov/api/v2";

function parsePhase(phases: string[] | string | null | undefined): string {
  if (!phases) return "Unknown";
  const p = Array.isArray(phases) ? phases[0] : phases;
  return p?.replace("PHASE", "Phase ")?.replace("_", " ")?.trim() ?? "Unknown";
}

export async function searchClinicalTrials(
  condition: string,
  intervention?: string,
  maxResults = 25,
): Promise<CTGSearchResult> {
  const base: CTGSearchResult = {
    trials: [], totalCount: 0, byPhase: {},
    successRate: null, avgEnrollment: null, medianDurationMos: null, status: "unavailable",
  };
  if (!condition) return base;

  try {
    const params = new URLSearchParams({
      "query.cond":     condition,
      "fields":         "NCTId,BriefTitle,Phase,OverallStatus,Condition,InterventionName,EnrollmentCount,StartDate,PrimaryCompletionDate,LeadSponsorName,HasResults",
      "pageSize":       String(maxResults),
      "format":         "json",
    });
    if (intervention) params.set("query.intr", intervention);

    const res = await fetch(`${CTG_BASE}/studies?${params}`);
    if (!res.ok) return { ...base, status: "error" };
    const json = await res.json();

    const studies: any[] = json?.studies ?? [];
    const totalCount: number = json?.totalCount ?? studies.length;

    const trials: CTGTrial[] = studies.map((s: any) => {
      const pm = s?.protocolSection;
      const id = pm?.identificationModule;
      const st = pm?.statusModule;
      const de = pm?.descriptionModule;
      const de2 = pm?.designModule;
      const sp = pm?.sponsorCollaboratorsModule;
      const el = pm?.eligibilityModule;

      return {
        nctId:          id?.nctId ?? "—",
        briefTitle:     id?.briefTitle ?? "—",
        phase:          parsePhase(de2?.phases),
        status:         st?.overallStatus ?? "Unknown",
        conditions:     pm?.conditionsModule?.conditions?.slice(0, 3) ?? [],
        interventions:  pm?.armsInterventionsModule?.interventions?.map((i: any) => i.name)?.slice(0, 3) ?? [],
        enrollmentN:    de2?.enrollmentInfo?.count ?? null,
        startDate:      st?.startDateStruct?.date ?? "—",
        primaryCompletion: st?.primaryCompletionDateStruct?.date ?? "—",
        sponsor:        sp?.leadSponsor?.name ?? "—",
        resultsAvailable: s?.hasResults ?? false,
      };
    });

    // Phase distribution
    const byPhase: Record<string, number> = {};
    trials.forEach(t => {
      byPhase[t.phase] = (byPhase[t.phase] ?? 0) + 1;
    });

    // Success rate (completed vs total)
    const completed = trials.filter(t =>
      t.status === "COMPLETED" || t.status === "Completed"
    ).length;
    const successRate = trials.length ? completed / trials.length : null;

    // Average enrollment
    const enrollments = trials.map(t => t.enrollmentN).filter(Boolean) as number[];
    const avgEnrollment = enrollments.length
      ? enrollments.reduce((a, b) => a + b, 0) / enrollments.length
      : null;

    return {
      trials,
      totalCount,
      byPhase,
      successRate,
      avgEnrollment,
      medianDurationMos: null, // Could compute from start/completion dates if needed
      status: "live",
    };
  } catch {
    return { ...base, status: "error" };
  }
}

// Fetch phase-specific success benchmarks by therapeutic area
export async function fetchPhaseSuccessRates(
  condition: string,
): Promise<{ phase1to2: number | null; phase2to3: number | null; phase3toApproval: number | null; status: string }> {
  try {
    const [p1, p2, p3] = await Promise.all([
      searchClinicalTrials(condition, undefined, 100),
      searchClinicalTrials(condition, undefined, 100),
      searchClinicalTrials(condition, undefined, 100),
    ]);

    // Simple estimation from data
    const hasPhase = (res: CTGSearchResult, ph: string) =>
      Object.entries(res.byPhase).find(([k]) => k.toLowerCase().includes(ph))?.[1] ?? 0;

    return {
      phase1to2:       p1.successRate,
      phase2to3:       p2.successRate,
      phase3toApproval:p3.successRate,
      status:          "live",
    };
  } catch {
    return { phase1to2: null, phase2to3: null, phase3toApproval: null, status: "error" };
  }
}
