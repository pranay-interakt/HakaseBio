export interface ClinicalSite {
  facilityName: string;
  city: string;
  state: string;
  country: string;
  region: string;
  trialCount: number;
  recentTrials: number;
  phases: string[];
  statuses: string[];
}

export interface RankedSite {
  rank: number;
  site: string;
  city: string;
  country: string;
  region: string;
  enrollPerMonth: number;
  quality: number;
  experience: number;
  composite: number;
  trialCount: number;
  recentActivity: number;
  mcIterations: number;
}

const REGION_MAP: Record<string, string> = {
  "United States": "North America",
  "Canada": "North America",
  "Mexico": "North America",
  "United Kingdom": "Europe",
  "Germany": "Europe",
  "France": "Europe",
  "Italy": "Europe",
  "Spain": "Europe",
  "Netherlands": "Europe",
  "Switzerland": "Europe",
  "Belgium": "Europe",
  "Sweden": "Europe",
  "Denmark": "Europe",
  "Norway": "Europe",
  "Finland": "Europe",
  "Austria": "Europe",
  "Poland": "Europe",
  "Czech Republic": "Europe",
  "Ireland": "Europe",
  "Portugal": "Europe",
  "Greece": "Europe",
  "Hungary": "Europe",
  "Romania": "Europe",
  "Japan": "Asia-Pacific",
  "China": "Asia-Pacific",
  "South Korea": "Asia-Pacific",
  "Taiwan": "Asia-Pacific",
  "India": "Asia-Pacific",
  "Australia": "Asia-Pacific",
  "New Zealand": "Asia-Pacific",
  "Singapore": "Asia-Pacific",
  "Thailand": "Asia-Pacific",
  "Malaysia": "Asia-Pacific",
  "Israel": "Middle East",
  "Turkey": "Middle East",
  "Saudi Arabia": "Middle East",
  "Brazil": "Latin America",
  "Argentina": "Latin America",
  "Colombia": "Latin America",
  "Chile": "Latin America",
  "South Africa": "Africa",
  "Egypt": "Africa",
  "Kenya": "Africa",
  "Nigeria": "Africa",
  "Russia": "Eastern Europe",
  "Ukraine": "Eastern Europe",
};

function mapConditionToQuery(indication: string): string {
  const lower = indication.toLowerCase();
  if (lower.includes("nsclc") || lower.includes("non-small-cell") || lower.includes("non-small cell"))
    return "non-small cell lung cancer";
  if (lower.includes("breast")) return "breast cancer";
  if (lower.includes("colorect")) return "colorectal cancer";
  if (lower.includes("melanoma")) return "melanoma";
  if (lower.includes("leukemia") || lower.includes("leukaemia")) return "leukemia";
  if (lower.includes("lymphoma")) return "lymphoma";
  if (lower.includes("myeloma")) return "multiple myeloma";
  if (lower.includes("glioma") || lower.includes("glioblastoma")) return "glioblastoma";
  if (lower.includes("pancrea")) return "pancreatic cancer";
  if (lower.includes("prostate")) return "prostate cancer";
  if (lower.includes("ovarian")) return "ovarian cancer";
  if (lower.includes("renal") || lower.includes("kidney")) return "renal cell carcinoma";
  if (lower.includes("hepato") || lower.includes("liver")) return "hepatocellular carcinoma";
  if (lower.includes("alzheimer")) return "alzheimer disease";
  if (lower.includes("parkinson")) return "parkinson disease";
  if (lower.includes("multiple sclerosis") || lower.includes("ms")) return "multiple sclerosis";
  if (lower.includes("als") || lower.includes("amyotrophic")) return "amyotrophic lateral sclerosis";
  if (lower.includes("diabetes")) return "diabetes mellitus";
  if (lower.includes("rheumatoid")) return "rheumatoid arthritis";
  if (lower.includes("crohn")) return "crohn disease";
  if (lower.includes("asthma")) return "asthma";
  if (lower.includes("copd")) return "chronic obstructive pulmonary disease";
  const dashIdx = lower.indexOf("–");
  if (dashIdx > 0) return indication.substring(dashIdx + 1).trim();
  return indication.trim();
}

function mapPhaseToQuery(phase: string): string {
  const lower = phase.toLowerCase();
  if (lower.includes("iii") || lower.includes("3")) return "PHASE3";
  if (lower.includes("ii") || lower.includes("2")) return "PHASE2";
  if (lower.includes("i") || lower.includes("1")) return "PHASE1";
  return "PHASE2";
}

interface CTGovStudy {
  protocolSection: {
    identificationModule?: {
      nctId?: string;
      briefTitle?: string;
    };
    statusModule?: {
      overallStatus?: string;
      startDateStruct?: { date?: string };
    };
    designModule?: {
      phases?: string[];
    };
    contactsLocationsModule?: {
      locations?: Array<{
        facility?: string;
        city?: string;
        state?: string;
        country?: string;
        status?: string;
      }>;
    };
  };
}

export async function fetchClinicalTrialSites(
  indication: string,
  phase: string,
  maxStudies: number = 50
): Promise<ClinicalSite[]> {
  const condition = mapConditionToQuery(indication);
  const phaseFilter = mapPhaseToQuery(phase);

  const params = new URLSearchParams({
    "query.cond": condition,
    "filter.phase": phaseFilter,
    "filter.overallStatus": "RECRUITING|ACTIVE_NOT_RECRUITING|COMPLETED",
    "fields": "protocolSection.identificationModule.nctId,protocolSection.statusModule.overallStatus,protocolSection.statusModule.startDateStruct,protocolSection.designModule.phases,protocolSection.contactsLocationsModule.locations",
    "pageSize": String(Math.min(maxStudies, 100)),
    "sort": "LastUpdatePostDate:desc",
  });

  const url = `https://clinicaltrials.gov/api/v2/studies?${params.toString()}`;

  const resp = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });

  if (!resp.ok) {
    throw new Error(`ClinicalTrials.gov API error: ${resp.status}`);
  }

  const data = await resp.json() as { studies?: CTGovStudy[] };
  const studies = data.studies ?? [];

  const facilityMap = new Map<string, {
    city: string;
    state: string;
    country: string;
    trialCount: number;
    recentTrials: number;
    phases: Set<string>;
    statuses: Set<string>;
  }>();

  const now = new Date();
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());

  for (const study of studies) {
    const ps = study.protocolSection;
    const locations = ps.contactsLocationsModule?.locations ?? [];
    const studyPhases = ps.designModule?.phases ?? [];
    const status = ps.statusModule?.overallStatus ?? "UNKNOWN";
    const startDateStr = ps.statusModule?.startDateStruct?.date;
    const isRecent = startDateStr
      ? new Date(startDateStr) >= twoYearsAgo
      : false;

    for (const loc of locations) {
      const name = loc.facility?.trim();
      if (!name || name.length < 3) continue;

      const key = `${name}||${loc.city ?? ""}||${loc.country ?? ""}`;
      const existing = facilityMap.get(key);
      if (existing) {
        existing.trialCount++;
        if (isRecent) existing.recentTrials++;
        studyPhases.forEach(p => existing.phases.add(p));
        existing.statuses.add(status);
      } else {
        facilityMap.set(key, {
          city: loc.city ?? "",
          state: loc.state ?? "",
          country: loc.country ?? "",
          trialCount: 1,
          recentTrials: isRecent ? 1 : 0,
          phases: new Set(studyPhases),
          statuses: new Set([status]),
        });
      }
    }
  }

  const sites: ClinicalSite[] = [];
  for (const [key, val] of facilityMap.entries()) {
    const [facilityName] = key.split("||");
    sites.push({
      facilityName,
      city: val.city,
      state: val.state,
      country: val.country,
      region: REGION_MAP[val.country] ?? "Other",
      trialCount: val.trialCount,
      recentTrials: val.recentTrials,
      phases: Array.from(val.phases),
      statuses: Array.from(val.statuses),
    });
  }

  return sites;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function boxMullerNormal(rng: () => number): number {
  let u1 = rng();
  let u2 = rng();
  while (u1 === 0) u1 = rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

export interface MonteCarloConfig {
  iterations: number;
  targetSampleSize: number;
  numSitesDesired: number;
  trialDurationMonths: number;
  dropoutRate: number;
  phase: string;
}

interface SiteScoreDistribution {
  enrollMean: number;
  enrollStd: number;
  qualityMean: number;
  qualityStd: number;
  experienceScore: number;
}

function computeSiteDistribution(
  site: ClinicalSite,
  config: MonteCarloConfig,
): SiteScoreDistribution {
  const isPhIII = config.phase.toLowerCase().includes("iii") || config.phase.includes("3");
  const isPhI = config.phase.toLowerCase().includes("i") && !config.phase.toLowerCase().includes("ii");

  const baseEnrollRate = isPhIII ? 3.5 : isPhI ? 1.5 : 2.5;
  const trialBonus = Math.min(site.trialCount / 20, 1.0) * 1.5;
  const recentBonus = Math.min(site.recentTrials / 5, 1.0) * 1.0;
  const recruitingBonus = site.statuses.includes("RECRUITING") ? 0.5 : 0;

  const enrollMean = baseEnrollRate + trialBonus + recentBonus + recruitingBonus;
  const enrollStd = enrollMean * 0.25;

  const experienceNorm = Math.min(site.trialCount / 30, 1.0);
  const recencyNorm = Math.min(site.recentTrials / 10, 1.0);
  const phaseMatch = site.phases.some(p =>
    p.toLowerCase().includes(config.phase.toLowerCase().replace("phase ", ""))
  ) ? 1.0 : 0.7;
  const activeBonus = site.statuses.includes("RECRUITING") ? 1.0 : 0.8;

  const experienceScore = experienceNorm * 0.35 + recencyNorm * 0.30 + phaseMatch * 0.20 + activeBonus * 0.15;

  const qualityMean = 5.0 + experienceScore * 4.5;
  const qualityStd = 0.6;

  return {
    enrollMean,
    enrollStd,
    qualityMean,
    qualityStd,
    experienceScore,
  };
}

export function runMonteCarloSiteRanking(
  sites: ClinicalSite[],
  config: MonteCarloConfig,
  seed: number = 42,
): RankedSite[] {
  if (sites.length === 0) return [];

  const N = config.iterations;
  const rng = seededRandom(seed);

  const siteDistributions = sites.map(s => ({
    site: s,
    dist: computeSiteDistribution(s, config),
  }));

  const compositeAccum = new Float64Array(sites.length);
  const enrollAccum = new Float64Array(sites.length);
  const qualityAccum = new Float64Array(sites.length);

  for (let iter = 0; iter < N; iter++) {
    for (let i = 0; i < siteDistributions.length; i++) {
      const { dist } = siteDistributions[i];

      const enrollSample = Math.max(0.5, dist.enrollMean + boxMullerNormal(rng) * dist.enrollStd);
      const qualitySample = Math.max(3.0, Math.min(10.0, dist.qualityMean + boxMullerNormal(rng) * dist.qualityStd));

      const enrollNorm = Math.min(enrollSample / 8.0, 1.0);
      const qualityNorm = qualitySample / 10.0;
      const expNorm = dist.experienceScore;

      const dropoutPenalty = 1.0 - config.dropoutRate * (1.0 - expNorm) * 0.5;

      const composite = (
        enrollNorm * 0.35 +
        qualityNorm * 0.30 +
        expNorm * 0.25 +
        dropoutPenalty * 0.10
      );

      compositeAccum[i] += composite;
      enrollAccum[i] += enrollSample;
      qualityAccum[i] += qualitySample;
    }
  }

  const ranked: RankedSite[] = siteDistributions.map((sd, i) => ({
    rank: 0,
    site: sd.site.facilityName,
    city: sd.site.city,
    country: sd.site.country,
    region: sd.site.region,
    enrollPerMonth: parseFloat((enrollAccum[i] / N).toFixed(1)),
    quality: parseFloat((qualityAccum[i] / N).toFixed(1)),
    experience: parseFloat((sd.dist.experienceScore * 10).toFixed(1)),
    composite: Math.round((compositeAccum[i] / N) * 100),
    trialCount: sd.site.trialCount,
    recentActivity: sd.site.recentTrials,
    mcIterations: N,
  }));

  ranked.sort((a, b) => b.composite - a.composite);
  ranked.forEach((s, i) => { s.rank = i + 1; });

  return ranked;
}
