// ── EPA ECOTOX Database Integration ──────────────────────────────────────
// Ecotoxicology data for chemicals across species
// REST API: https://cfpub.epa.gov/ecotox/
// Policy: NO synthetic fallbacks. If the live API is unavailable, status
// "unavailable"|"error" is returned with empty studies[]; downstream code
// must treat the source as missing — never substitute reference values.

export interface ECOTOXResult {
  casrn:       string;
  chemName:    string;
  studies:     ECOTOXStudy[];
  totalStudies:number;
  lowestNoaec: number | null;   // mg/kg/day (lowest NOAEC across species)
  lowestLoaec: number | null;   // Lowest LOAEC
  status:      "live" | "unavailable" | "error";
}

export interface ECOTOXStudy {
  species:     string;
  endpoint:    string;   // NOAEC, LOAEC, LD50, LC50
  value:       number;
  unit:        string;
  duration:    string;
  route:       string;
  reference:   string;
}

export async function fetchEcotox(casrn: string, chemicalName?: string): Promise<ECOTOXResult> {
  const base: ECOTOXResult = {
    casrn, chemName: chemicalName ?? casrn,
    studies: [], totalStudies: 0,
    lowestNoaec: null, lowestLoaec: null, status: "unavailable",
  };
  if (!casrn && !chemicalName) return base;

  try {
    // ECOTOX REST endpoint (may have CORS limitations in browser)
    const query = casrn
      ? `cas_number:${encodeURIComponent(casrn)}`
      : `name:${encodeURIComponent(chemicalName ?? "")}`;

    const res = await fetch(
      `https://cfpub.epa.gov/ecotox/services/v2/study/?${query}&limit=20`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return { ...base, status: "error" };

    const json = await res.json();
    const records: any[] = json?.data ?? json?.studies ?? [];

    if (!records.length) return { ...base, status: "unavailable" };

    const studies: ECOTOXStudy[] = records.map((r: any) => ({
      species:   r?.species?.commonName ?? r?.species?.scientificName ?? "—",
      endpoint:  r?.endpoint?.code ?? r?.endpoint ?? "—",
      value:     parseFloat(r?.conc1Mean ?? r?.concentration ?? "0") || 0,
      unit:      r?.conc1Unit ?? r?.unit ?? "mg/kg",
      duration:  `${r?.observDuration ?? "—"} ${r?.observDurationUnit ?? ""}`.trim(),
      route:     r?.exposureType ?? r?.route ?? "—",
      reference: r?.reference?.title ?? r?.reference ?? "ECOTOX",
    }));

    const noaecStudies = studies
      .filter(s => s.endpoint.includes("NOAEC") || s.endpoint.includes("NOAEL"))
      .map(s => s.value).filter(v => v > 0);
    const loaecStudies = studies
      .filter(s => s.endpoint.includes("LOAEC") || s.endpoint.includes("LOAEL"))
      .map(s => s.value).filter(v => v > 0);

    return {
      casrn,
      chemName: chemicalName ?? casrn,
      studies,
      totalStudies: records.length,
      lowestNoaec: noaecStudies.length ? Math.min(...noaecStudies) : null,
      lowestLoaec: loaecStudies.length ? Math.min(...loaecStudies) : null,
      status: "live",
    };
  } catch {
    return { ...base, status: "error" };
  }
}
