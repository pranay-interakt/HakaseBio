/**
 * FDA Product-Specific Guidance (PSG) intelligence route
 *
 * Queries openFDA's public JSON APIs to surface bioequivalence context
 * for any drug — reference listed drug (RLD) status, TE codes, dosage forms,
 * clinical pharmacology, BCS class hints, and the recommended BE methodology.
 * Also returns a direct link to the FDA PSG search page for the compound.
 *
 * Endpoints:
 *   GET /api/fda-psg/search?drug=IBUPROFEN
 *   GET /api/fda-psg/label?drug=IBUPROFEN          (clinical pharmacology from label)
 *   GET /api/fda-psg/be-methodology?form=TABLET&route=ORAL&nti=false
 */

import { Router, type IRouter } from "express";

const router: IRouter = Router();

const OPENFDA_BASE = "https://api.fda.gov";
const PSG_SEARCH_BASE =
  "https://www.accessdata.fda.gov/scripts/cder/psg/index.cfm?action=Search&SearchKey=drugname&SearchTerm=";
const DISSOLUTION_DB_BASE =
  "https://www.accessdata.fda.gov/scripts/cder/dissolution/index.cfm?action=Search&DrugName=";

// ---------------------------------------------------------------------------
// BCS classification context (built from FDA BCS biowaiver guidance)
// ---------------------------------------------------------------------------
const BCS_CONTEXT: Record<string, {
  solubility: string; permeability: string; be_approach: string; biowaiver_eligible: boolean;
}> = {
  I:   { solubility: "High", permeability: "High", be_approach: "Biowaiver often possible (in vitro dissolution if rapid dissolution ≥85% in 30 min at pH 1.2/4.5/6.8)", biowaiver_eligible: true },
  II:  { solubility: "Low",  permeability: "High", be_approach: "In vivo PK BE study required; dissolution-rate limited absorption", biowaiver_eligible: false },
  III: { solubility: "High", permeability: "Low",  be_approach: "In vivo PK BE study required; membrane-permeation limited; API properties and excipients critical", biowaiver_eligible: false },
  IV:  { solubility: "Low",  permeability: "Low",  be_approach: "In vivo PK BE study required; both dissolution and permeation are limiting; most challenging class", biowaiver_eligible: false },
};

// ---------------------------------------------------------------------------
// BE methodology by dosage form + route (FDA PSG general rules)
// ---------------------------------------------------------------------------
function beMethodology(dosageForm: string, route: string, isNTI = false): {
  methodology: string; study_type: string; be_window: string;
  fasting: boolean; fed: boolean; notes: string;
} {
  const form  = (dosageForm || "").toUpperCase();
  const rt    = (route     || "").toUpperCase();
  const window = isNTI ? "90.00–111.11%" : "80.00–125.00%";

  // Oral solid
  if (["TABLET","CAPSULE","CAPLET","FILM-COATED TABLET","DELAYED-RELEASE TABLET",
       "EXTENDED-RELEASE TABLET","EXTENDED-RELEASE CAPSULE"].some(f => form.includes(f))) {
    if (rt.includes("ORAL")) {
      return {
        methodology: "In vivo pharmacokinetic BE study",
        study_type:  "Two-period, two-sequence crossover",
        be_window:   window,
        fasting:     true,
        fed:         form.includes("EXTENDED") || form.includes("DELAYED"),
        notes: isNTI
          ? "NTI drug — tighter 90–111% window; within-subject variability must be characterised"
          : form.includes("EXTENDED") || form.includes("DELAYED")
            ? "Both fasting and fed arms required; steady-state study may be needed for ER formulations"
            : "Fasting arm required; fed arm recommended if label specifies food effect",
      };
    }
  }

  // Oral solution / suspension
  if (["SOLUTION","SUSPENSION","SYRUP","ELIXIR","EMULSION"].some(f => form.includes(f))) {
    if (rt.includes("ORAL")) {
      return {
        methodology: "In vitro dissolution / biowaiver",
        study_type:  "Comparative dissolution profile (f2 ≥ 50) or in vivo PK if formulation differs",
        be_window:   window,
        fasting:     false,
        fed:         false,
        notes: "Oral solutions are generally biowaiver-eligible if same active moiety, concentration, and no excipients affecting absorption",
      };
    }
  }

  // Topical
  if (rt.includes("TOPICAL") || rt.includes("TRANSDERMAL")) {
    return {
      methodology: "In vitro / pharmacodynamic BE",
      study_type:  form.includes("TRANSDERMAL")
        ? "In vivo PK (AUC, Cmax) + in vitro release testing"
        : "Dermatopharmacokinetic (DPK) tape-strip study or clinical endpoint BE study",
      be_window:   window,
      fasting:     false,
      fed:         false,
      notes: "Many topical PSGs now specify DPK tape-strip as the recommended approach (FDA 2019 guidance)",
    };
  }

  // Inhalation
  if (rt.includes("INHAL") || form.includes("INHALER") || form.includes("AEROSOL")) {
    return {
      methodology: "In vitro aerosol characterisation + PK study",
      study_type:  "Device-specific in vitro (impactor) + single-dose PK crossover",
      be_window:   window,
      fasting:     true,
      fed:         false,
      notes: "Highly product-specific — refer to individual PSG PDF; lung deposition and device performance are critical",
    };
  }

  // Nasal
  if (rt.includes("NASAL")) {
    return {
      methodology: "In vitro + optional PK study",
      study_type:  "Spray pattern/plume geometry + droplet size distribution + PK if systemic absorption",
      be_window:   window,
      fasting:     false,
      fed:         false,
      notes: "PSG-specific — many nasal products require both in vitro and in vivo data",
    };
  }

  // Ophthalmic
  if (rt.includes("OPHTHALM")) {
    return {
      methodology: "In vitro / clinical endpoint BE study",
      study_type:  "Comparative clinical endpoint or PK (aqueous humor sampling)",
      be_window:   window,
      fasting:     false,
      fed:         false,
      notes: "Generally waived for simple solutions; complex suspensions or emulsions require additional in vitro characterization",
    };
  }

  // Injectable
  if (rt.includes("INJECT") || rt.includes("INTRAVENOUS") || rt.includes("INTRAMUSCULAR")) {
    return {
      methodology: "Biowaiver (typically)",
      study_type:  "In vitro physicochemical testing; in vivo PK only if formulation differences affect PK",
      be_window:   window,
      fasting:     false,
      fed:         false,
      notes: "Injectable solutions with same formulation as RLD are generally waiver-eligible; complex injectables (liposomal, nanoparticle) require full PK + in vitro characterisation",
    };
  }

  // Default
  return {
    methodology: "Refer to product-specific FDA PSG",
    study_type:  "Determined by individual PSG",
    be_window:   window,
    fasting:     false,
    fed:         false,
    notes: "No generic rule applies — check the FDA PSG database for this dosage form and route combination",
  };
}

// ---------------------------------------------------------------------------
// Helper: fetch JSON from openFDA with timeout + error handling
// ---------------------------------------------------------------------------
async function fetchFDA(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/fda-psg/search?drug=NAME
// ---------------------------------------------------------------------------
router.get("/fda-psg/search", async (req, res) => {
  const drug = String(req.query.drug || "").trim();
  if (!drug) {
    return res.status(400).json({ error: "drug query parameter is required" });
  }

  const encoded = encodeURIComponent(drug.toUpperCase());

  // Parallel: FDA applications (RLD/TE data) + drug label (clinical pharmacology)
  const [fdaApps, fdaLabel] = await Promise.all([
    fetchFDA(
      `${OPENFDA_BASE}/drug/drugsfda.json?search=openfda.generic_name:"${encoded}"&limit=20`
    ),
    fetchFDA(
      `${OPENFDA_BASE}/drug/label.json?search=openfda.generic_name:"${encoded}"&limit=5`
    ),
  ]);

  // ── Parse RLD / reference standard products ─────────────────────────────
  const rldProducts: any[] = [];
  const allProducts: any[] = [];

  if (fdaApps?.results) {
    for (const app of fdaApps.results) {
      for (const prod of (app.products || [])) {
        const entry = {
          application_number: app.application_number,
          application_type:   app.application_number?.startsWith("ANDA") ? "ANDA (Generic)" :
                              app.application_number?.startsWith("NDA")  ? "NDA (Brand)"  :
                              app.application_number?.startsWith("BLA")  ? "BLA (Biologic)" : "Other",
          sponsor:            app.sponsor_name,
          brand_name:         prod.brand_name,
          dosage_form:        prod.dosage_form,
          route:              prod.route,
          active_ingredients: prod.active_ingredients,
          te_code:            prod.te_code,
          te_description:     teCodeDescription(prod.te_code),
          reference_drug:     prod.reference_drug === "Yes",
          reference_standard: prod.reference_standard === "Yes",
          marketing_status:   prod.marketing_status,
          be_methodology:     beMethodology(prod.dosage_form, prod.route),
        };
        allProducts.push(entry);
        if (prod.reference_drug === "Yes" || prod.reference_standard === "Yes") {
          rldProducts.push(entry);
        }
      }
    }
  }

  // ── Parse clinical pharmacology from label ────────────────────────────────
  const pkInfo: string[] = [];
  const bcsHints: string[] = [];

  if (fdaLabel?.results) {
    for (const label of fdaLabel.results.slice(0, 3)) {
      const cpParagraph = (label.clinical_pharmacology || label.pharmacokinetics || [])[0] || "";
      if (cpParagraph) pkInfo.push(cpParagraph.slice(0, 800));

      // BCS hints from description or clinical_pharmacology
      const desc = [(label.description || [])[0], cpParagraph].join(" ").toLowerCase();
      if (desc.includes("bcs class i") || (desc.includes("highly soluble") && desc.includes("highly permeable"))) bcsHints.push("I");
      else if (desc.includes("bcs class ii") || (desc.includes("poorly soluble") && desc.includes("highly permeable"))) bcsHints.push("II");
      else if (desc.includes("bcs class iii") || (desc.includes("highly soluble") && desc.includes("poorly permeable"))) bcsHints.push("III");
      else if (desc.includes("bcs class iv") || (desc.includes("poorly soluble") && desc.includes("poorly permeable"))) bcsHints.push("IV");
    }
  }

  const bcsClass = bcsHints[0] || null;

  return res.json({
    drug_name:        drug.toUpperCase(),
    total_apps_found: fdaApps?.meta?.results?.total ?? 0,

    reference_listed_drugs: rldProducts,
    all_products_sample:    allProducts.slice(0, 10),

    // BCS context (from label text parsing; confirm with Hakase ADMET predictions)
    bcs_class:        bcsClass,
    bcs_context:      bcsClass ? BCS_CONTEXT[bcsClass] : null,
    bcs_note:         bcsClass
      ? `BCS Class ${bcsClass} identified from FDA label text.`
      : "BCS class not found in label text — use Hakase solubility + permeability predictions to estimate.",

    // Clinical pharmacology snippet
    clinical_pharmacology_snippet: pkInfo[0]?.slice(0, 600) || null,

    // Direct links to FDA databases
    psg_search_url:       PSG_SEARCH_BASE + encodeURIComponent(drug),
    dissolution_db_url:   DISSOLUTION_DB_BASE + encodeURIComponent(drug),
    drugs_at_fda_url:     `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=`,

    // Bioequivalence context summary
    be_window_standard:   "80.00–125.00% (90% CI for Cmax and AUC)",
    be_window_nti:        "90.00–111.11% (Narrow Therapeutic Index drugs — tighter window)",
    be_standard_ref:      "21 CFR 320.26, FDA Guidance on Bioequivalence Studies with PK Endpoints (2013)",
  });
});

// ---------------------------------------------------------------------------
// GET /api/fda-psg/be-methodology?form=TABLET&route=ORAL&nti=false
// ---------------------------------------------------------------------------
router.get("/fda-psg/be-methodology", (req, res) => {
  const form = String(req.query.form || "");
  const route = String(req.query.route || "");
  const nti  = req.query.nti === "true";

  return res.json({
    dosage_form: form,
    route,
    is_nti: nti,
    ...beMethodology(form, route, nti),
    bcs_classes: BCS_CONTEXT,
    guidance_ref: "FDA Guidance for Industry: Bioequivalence Studies with Pharmacokinetic Endpoints (2013); 21 CFR Part 320",
  });
});

// ---------------------------------------------------------------------------
// GET /api/fda-psg/label?drug=NAME   (full clinical pharmacology detail)
// ---------------------------------------------------------------------------
router.get("/fda-psg/label", async (req, res) => {
  const drug = String(req.query.drug || "").trim();
  if (!drug) return res.status(400).json({ error: "drug query parameter is required" });

  const data = await fetchFDA(
    `${OPENFDA_BASE}/drug/label.json?search=openfda.generic_name:"${encodeURIComponent(drug.toUpperCase())}"&limit=3`
  );

  if (!data?.results?.length) {
    return res.status(404).json({ error: "No label data found for this drug", drug });
  }

  const labels = data.results.map((r: any) => ({
    brand_name:             (r.openfda?.brand_name || [])[0],
    generic_name:           (r.openfda?.generic_name || [])[0],
    manufacturer:           (r.openfda?.manufacturer_name || [])[0],
    route:                  (r.openfda?.route || [])[0],
    clinical_pharmacology:  (r.clinical_pharmacology || [])[0]?.slice(0, 1200),
    pharmacokinetics:       (r.pharmacokinetics || [])[0]?.slice(0, 1200),
    description:            (r.description || [])[0]?.slice(0, 600),
    indications:            (r.indications_and_usage || [])[0]?.slice(0, 400),
    effective_time:         r.effective_time,
  }));

  return res.json({ drug, labels });
});

// ---------------------------------------------------------------------------
// TE code lookup
// ---------------------------------------------------------------------------
function teCodeDescription(code: string | null | undefined): string {
  if (!code) return "No TE code (may be NDA reference drug or not yet rated)";
  const prefix = code[0];
  const map: Record<string, string> = {
    A: "Therapeutically equivalent — substitutable (A-rated)",
    B: "NOT therapeutically equivalent — not substitutable without prescriber approval (B-rated)",
  };
  const detail: Record<string, string> = {
    AB:  "AB — Bioequivalence demonstrated (in vivo study); most common oral solid TE code",
    AA:  "AA — No known or suspected bioequivalence problem; conventional dosage forms",
    AN:  "AN — Solutions or powders for aerosolisation",
    AO:  "AO — Injectable oil solutions",
    AP:  "AP — Injectable aqueous solutions",
    AT:  "AT — Topical products; no bioequivalence concern",
    BC:  "BC — Extended-release formulations; BE not yet established",
    BD:  "BD — Active ingredient/dosage form differences; data insufficient",
    BE:  "BE — Enteric-coated products; data insufficient",
    BN:  "BN — Aerosol-nebuliser products",
    BP:  "BP — Potential bioequivalence problems",
    BR:  "BR — Suppositories or enemas; BE not established",
    BS:  "BS — Drug standard deficiencies",
    BT:  "BT — Topical products with potential BE problems",
    BX:  "BX — Insufficient data to rate; bioequivalence problem potential",
  };
  return detail[code] || map[prefix] || `TE code ${code}`;
}

export default router;
