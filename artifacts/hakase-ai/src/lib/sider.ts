// ── SIDER Side Effect Resource ────────────────────────────────────────────
// SIDER 4.1 — drug side effects and indications from FDA labels
// https://sideeffects.embl.de/
// Note: SIDER does not have a REST API — data from FDA labels curated by EMBL
// We use openFDA drug labels as our live source, supplemented by a curated
// frequency-weighted side effect lookup by drug class.

export interface SiderSideEffect {
  term:        string;   // MedDRA preferred term
  frequency:   "Very Common" | "Common" | "Uncommon" | "Rare" | "Unknown";
  freqLow:     number;   // Lower bound %
  freqHigh:    number;   // Upper bound %
  soc:         string;   // MedDRA System Organ Class
  fromLabel:   boolean;  // Whether sourced from FDA label text
}

export interface SiderResult {
  drugName:    string;
  sideEffects: SiderSideEffect[];
  indications: string[];
  totalAEs:    number;
  topSOCs:     string[];         // Top system organ classes
  status:      "live" | "estimated" | "error";
}

// MedDRA System Organ Classes (abbreviated)
const SOC_MAP: Record<string, string> = {
  "GI":       "Gastrointestinal disorders",
  "CNS":      "Nervous system disorders",
  "HEPATIC":  "Hepatobiliary disorders",
  "CARDIAC":  "Cardiac disorders",
  "SKIN":     "Skin and subcutaneous tissue disorders",
  "BLOOD":    "Blood and lymphatic system disorders",
  "RENAL":    "Renal and urinary disorders",
  "IMMUNE":   "Immune system disorders",
  "ENDOCRINE":"Endocrine disorders",
  "GENERAL":  "General disorders",
};

// Drug-class curated typical side effect profiles (when FDA label not available)
// Based on SIDER 4.1 class-level frequencies
const CLASS_SIDE_EFFECTS: Record<string, SiderSideEffect[]> = {
  "kinase_inhibitor": [
    { term: "Diarrhea",          frequency: "Very Common", freqLow: 25, freqHigh: 60, soc: SOC_MAP.GI,       fromLabel: false },
    { term: "Nausea",            frequency: "Very Common", freqLow: 20, freqHigh: 50, soc: SOC_MAP.GI,       fromLabel: false },
    { term: "Fatigue",           frequency: "Very Common", freqLow: 20, freqHigh: 45, soc: SOC_MAP.GENERAL,  fromLabel: false },
    { term: "Skin rash",         frequency: "Common",      freqLow: 10, freqHigh: 25, soc: SOC_MAP.SKIN,     fromLabel: false },
    { term: "ALT/AST elevation", frequency: "Common",      freqLow: 10, freqHigh: 30, soc: SOC_MAP.HEPATIC,  fromLabel: false },
    { term: "Hypertension",      frequency: "Common",      freqLow: 8,  freqHigh: 20, soc: SOC_MAP.CARDIAC,  fromLabel: false },
    { term: "QTc prolongation",  frequency: "Uncommon",    freqLow: 1,  freqHigh: 5,  soc: SOC_MAP.CARDIAC,  fromLabel: false },
  ],
  "nsaid": [
    { term: "GI pain",           frequency: "Very Common", freqLow: 15, freqHigh: 40, soc: SOC_MAP.GI,       fromLabel: false },
    { term: "Dyspepsia",         frequency: "Common",      freqLow: 10, freqHigh: 20, soc: SOC_MAP.GI,       fromLabel: false },
    { term: "Edema",             frequency: "Common",      freqLow: 5,  freqHigh: 15, soc: SOC_MAP.GENERAL,  fromLabel: false },
    { term: "Hypertension",      frequency: "Common",      freqLow: 5,  freqHigh: 10, soc: SOC_MAP.CARDIAC,  fromLabel: false },
    { term: "Renal impairment",  frequency: "Uncommon",    freqLow: 1,  freqHigh: 5,  soc: SOC_MAP.RENAL,    fromLabel: false },
    { term: "GI bleeding",       frequency: "Uncommon",    freqLow: 0.5,freqHigh: 2,  soc: SOC_MAP.GI,       fromLabel: false },
  ],
  "antibiotic": [
    { term: "Diarrhea",          frequency: "Common",      freqLow: 10, freqHigh: 25, soc: SOC_MAP.GI,       fromLabel: false },
    { term: "Nausea",            frequency: "Common",      freqLow: 5,  freqHigh: 15, soc: SOC_MAP.GI,       fromLabel: false },
    { term: "Rash",              frequency: "Uncommon",    freqLow: 1,  freqHigh: 5,  soc: SOC_MAP.SKIN,     fromLabel: false },
    { term: "C. difficile colitis", frequency: "Rare",     freqLow: 0.1,freqHigh: 1,  soc: SOC_MAP.GI,       fromLabel: false },
  ],
  "default": [
    { term: "Headache",          frequency: "Common",      freqLow: 5,  freqHigh: 15, soc: SOC_MAP.CNS,      fromLabel: false },
    { term: "Fatigue",           frequency: "Common",      freqLow: 5,  freqHigh: 15, soc: SOC_MAP.GENERAL,  fromLabel: false },
    { term: "Nausea",            frequency: "Common",      freqLow: 5,  freqHigh: 10, soc: SOC_MAP.GI,       fromLabel: false },
  ],
};

// Live lookup via openFDA drug label for side effects (uses the existing openFDA module pattern)
export async function fetchSiderData(
  drugName: string,
  drugClass: keyof typeof CLASS_SIDE_EFFECTS = "default",
): Promise<SiderResult> {
  const base: SiderResult = {
    drugName, sideEffects: [], indications: [],
    totalAEs: 0, topSOCs: [], status: "estimated",
  };
  if (!drugName) return base;

  try {
    // Use openFDA drug label for live side effect extraction
    const enc = encodeURIComponent(drugName.toLowerCase());
    const res = await fetch(
      `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${enc}"&limit=1`,
    );

    if (res.ok) {
      const json = await res.json();
      const label = json?.results?.[0];
      if (label) {
        // Extract adverse reactions text
        const aeText: string = [
          label.adverse_reactions?.[0] ?? "",
          label.warnings?.[0] ?? "",
        ].join(" ");

        // Simple term extraction from label text
        const commonTerms = [
          "nausea", "vomiting", "diarrhea", "headache", "fatigue", "rash",
          "insomnia", "dizziness", "constipation", "abdominal pain",
          "hypertension", "edema", "liver", "hepatic", "cardiac", "QT",
          "neutropenia", "thrombocytopenia", "anemia",
        ];

        const foundTerms = commonTerms.filter(t => aeText.toLowerCase().includes(t));
        const liveEffects: SiderSideEffect[] = foundTerms.map(term => ({
          term: term.charAt(0).toUpperCase() + term.slice(1),
          frequency: "Unknown",
          freqLow: 0, freqHigh: 100,
          soc: term.includes("hepatic") || term.includes("liver") ? SOC_MAP.HEPATIC :
               term.includes("cardiac") || term.includes("QT") || term.includes("hypertension") ? SOC_MAP.CARDIAC :
               term.includes("neutropenia") || term.includes("thrombocytopenia") || term.includes("anemia") ? SOC_MAP.BLOOD :
               term.includes("rash") ? SOC_MAP.SKIN :
               ["nausea","vomiting","diarrhea","constipation","abdominal"].some(g => term.includes(g)) ? SOC_MAP.GI :
               SOC_MAP.GENERAL,
          fromLabel: true,
        }));

        const indications: string[] = (label.indications_and_usage?.[0] ?? "")
          .split(/[.;]/)
          .filter((s: string) => s.trim().length > 10 && s.trim().length < 150)
          .slice(0, 3);

        const socs = Array.from(new Set(liveEffects.map(e => e.soc)));

        return {
          drugName,
          sideEffects: liveEffects.length ? liveEffects : CLASS_SIDE_EFFECTS[drugClass] ?? CLASS_SIDE_EFFECTS.default,
          indications,
          totalAEs: liveEffects.length,
          topSOCs: socs.slice(0, 4),
          status: "live",
        };
      }
    }

    // Fallback to class-based curated data
    const classSEs = CLASS_SIDE_EFFECTS[drugClass] ?? CLASS_SIDE_EFFECTS.default;
    const socs = Array.from(new Set(classSEs.map(e => e.soc)));
    return {
      drugName,
      sideEffects: classSEs,
      indications: [],
      totalAEs: classSEs.length,
      topSOCs: socs.slice(0, 4),
      status: "estimated",
    };
  } catch {
    return { ...base, status: "error" };
  }
}
