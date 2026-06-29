// ── EPA CompTox / ToxCast Integration ──────────────────────────────────────
// CompTox Chemicals Dashboard REST API (CORS-enabled, no auth)
// https://api-ccte.epa.gov/  (v2)
// ToxCast in-vitro high-throughput screening: 10,000+ chemicals, 900+ assays

export interface CompToxChemical {
  dtxsid:      string;   // DSSTox substance ID
  casrn:       string;
  preferredName:string;
  smiles:      string;
  mw:          number;
  inchiKey:    string;
}

export interface ToxCastAssayHit {
  assayName:   string;
  endpoint:    string;   // AC50, EC50, etc.
  value_uM:    number;
  hitCall:     "Active" | "Inactive" | "Inconclusive";
  source:      string;
}

export interface ToxCastResult {
  chemical:    CompToxChemical | null;
  assayHits:   ToxCastAssayHit[];
  totalAssays: number;
  activeCount: number;
  hitRate:     number;    // 0–1
  ld50_mgKg:  number | null;   // Oral LD50 from ToxRefDB if available
  status:      "live" | "unavailable" | "error";
}

// CompTox search by SMILES (structure search) or name
export async function fetchCompTox(
  smiles: string,
  inchiKey?: string,
): Promise<ToxCastResult> {
  const base: ToxCastResult = {
    chemical: null, assayHits: [], totalAssays: 0,
    activeCount: 0, hitRate: 0, ld50_mgKg: null, status: "unavailable",
  };

  try {
    // Step 1: Resolve DTXSID from InChIKey or SMILES
    const searchKey = inchiKey || smiles.slice(0, 50);
    const searchUrl = `https://api-ccte.epa.gov/chemical/search/by-dtxsid/start-with/${encodeURIComponent(searchKey)}`;
    const chemRes = await fetch(searchUrl, {
      headers: { Accept: "application/json" },
    });

    // CompTox also supports InChIKey lookup
    let dtxsid: string | null = null;
    if (chemRes.ok) {
      const chemJson: any[] = await chemRes.json();
      dtxsid = chemJson?.[0]?.dtxsid ?? null;
    }

    // Fallback: try name search
    if (!dtxsid) {
      const fallbackRes = await fetch(
        `https://api-ccte.epa.gov/chemical/search/by-dtxsid/start-with/DTXSID`,
        { headers: { Accept: "application/json" } },
      );
      if (!fallbackRes.ok) return base;
    }

    if (!dtxsid) return { ...base, status: "unavailable" };

    // Step 2: Get ToxCast assay data for this DTXSID
    const [detailRes, assayRes] = await Promise.all([
      fetch(`https://api-ccte.epa.gov/chemical/detail/search/by-dtxsid/${dtxsid}`, {
        headers: { Accept: "application/json" },
      }),
      fetch(`https://api-ccte.epa.gov/bioactivity/data/search/by-dtxsid/${dtxsid}`, {
        headers: { Accept: "application/json" },
      }),
    ]);

    const chemical: CompToxChemical | null = detailRes.ok ? (() => {
      const d = detailRes.json() as any;
      return {
        dtxsid:       d?.dtxsid ?? dtxsid,
        casrn:        d?.casrn ?? "—",
        preferredName:d?.preferredName ?? "—",
        smiles:       d?.smiles ?? smiles,
        mw:           d?.molWeight ?? 0,
        inchiKey:     d?.inchiKey ?? "",
      };
    })() : null;

    const assayData: any[] = assayRes.ok ? (await assayRes.json()) : [];
    const hits: ToxCastAssayHit[] = assayData.slice(0, 30).map((a: any) => ({
      assayName: a?.assayName ?? a?.aeid ?? "Unknown",
      endpoint:  a?.hitParam ?? "AC50",
      value_uM:  parseFloat(a?.hitValue ?? a?.ac50 ?? "0") || 0,
      hitCall:   a?.hitCall === 1 ? "Active" : a?.hitCall === 0 ? "Inactive" : "Inconclusive",
      source:    a?.assaySource ?? "ToxCast",
    }));

    const activeCount = hits.filter(h => h.hitCall === "Active").length;

    return {
      chemical,
      assayHits:   hits,
      totalAssays: assayData.length,
      activeCount,
      hitRate:     assayData.length > 0 ? activeCount / assayData.length : 0,
      ld50_mgKg:  null, // ToxRefDB oral LD50 would need a separate endpoint
      status:      "live",
    };
  } catch {
    return { ...base, status: "error" };
  }
}

// ── Tox21 (NTP/NCATS/EPA) ────────────────────────────────────────────────────
// Tox21 is incorporated in the ToxCast data pipeline above (assaySource includes Tox21 assays).
// For a direct Tox21 lookup, use the same CompTox endpoint — it includes 72 Tox21 assays.

export interface Tox21Summary {
  ahr:    boolean | null;  // Aryl hydrocarbon receptor
  ar:     boolean | null;  // Androgen receptor
  er:     boolean | null;  // Estrogen receptor
  p53:    boolean | null;  // Genotoxicity (p53 pathway)
  herg:   boolean | null;  // hERG channel
  nrf2:   boolean | null;  // Oxidative stress (Nrf2)
}

// Extract Tox21 panel results from CompTox bioactivity data
export function extractTox21Summary(assayHits: ToxCastAssayHit[]): Tox21Summary {
  const find = (keyword: string): boolean | null => {
    const hit = assayHits.find(h =>
      h.assayName.toLowerCase().includes(keyword.toLowerCase())
    );
    if (!hit) return null;
    return hit.hitCall === "Active";
  };

  return {
    ahr:  find("AhR") ?? find("ahr"),
    ar:   find("AR_") ?? find("androgen"),
    er:   find("ER_") ?? find("estrogen"),
    p53:  find("p53") ?? find("genotox"),
    herg: find("hERG") ?? find("KCNH2"),
    nrf2: find("Nrf2") ?? find("ARE"),
  };
}
