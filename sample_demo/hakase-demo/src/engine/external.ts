/**
 * External public-database evidence panels.
 *
 * The point of this block in the real platform is that it shows the negative
 * states as loudly as the positive ones: a registry that returned nothing, a
 * source that needs a credential, and a source skipped for want of an
 * identifier are three different facts, and collapsing them into a blank panel
 * would quietly imply the evidence does not exist. The demonstration build
 * reproduces all four states.
 */

import { EXTERNAL_PANELS } from "../lib/catalogs";
import { round } from "../lib/format";
import { chance, logSpan, pick, span, unit } from "../lib/rng";

export type PanelKind = "target" | "hazard" | "clinical";
export type SourceBlock = Record<string, any> & { status: "live" | "no-data" | "skipped" | "unavailable" | "error"; reason?: string; remediation?: string; source?: string; url?: string; limitations?: string };

const seed = (key: string, channel: string) => `${key}::ext::${channel}`;

export function externalPanel(panel: PanelKind, identifiers: Record<string, string | null>) {
  const key = JSON.stringify(identifiers);
  const meta = EXTERNAL_PANELS[panel];
  const sources: Record<string, SourceBlock> = {};

  const gene = identifiers.gene_symbol;
  const uniprot = identifiers.uniprot_id;
  const inchikey = identifiers.inchikey;

  if (panel === "target") {
    sources.string = gene
      ? chance(seed(key, "string"), 0.88)
        ? {
          status: "live", source: "STRING v12.0", url: `https://string-db.org/network/${gene}`,
          interpretation: `${gene} sits in a functional network whose strongest partners are dominated by ${pick(seed(key, "stringmode"), ["co-expression and curated database evidence", "experimental interaction evidence", "text-mining and co-expression evidence"])}. A dense, experimentally supported neighbourhood usually means a well-characterised target; it says nothing about the compound.`,
          interactions: Array.from({ length: 12 }, (_, index) => {
            const combined = round(span(seed(key, `si${index}`), 0.45, 0.999) * 1000, 0);
            return {
              partner: pick(seed(key, `sp${index}`), ["CDK1", "CCNE1", "RB1", "TP53", "MYC", "AKT1", "MAPK1", "EGFR", "SRC", "STAT3", "GRB2", "PIK3CA", "MDM2", "CDKN1A", "CCND1", "HSP90AA1"]),
              combined_score: combined,
              experimental: round(span(seed(key, `se${index}`), 0.0, 0.95), 3),
              database: round(span(seed(key, `sd${index}`), 0.0, 0.9), 3),
              coexpression: round(span(seed(key, `sc${index}`), 0.0, 0.85), 3),
              textmining: round(span(seed(key, `st${index}`), 0.1, 0.95), 3),
              dominant_evidence: pick(seed(key, `sv${index}`), ["experimental", "curated database", "co-expression", "text mining"]),
            };
          }).sort((a, b) => b.combined_score - a.combined_score),
          n_interactions: 12,
          limitations: "A functional-association network. An association is not a physical interaction and is not evidence about the compound.",
        }
        : { status: "no-data", reason: `STRING returned no network for ${gene}. That is unusual for a human protein and may indicate an identifier-mapping problem rather than a genuine absence.` }
      : { status: "skipped", reason: "No gene symbol was resolved, so STRING was not queried." };

    sources.kegg = gene
      ? chance(seed(key, "kegg"), 0.8)
        ? (() => {
          const pathways = Array.from({ length: Math.floor(span(seed(key, "kp"), 3, 14)) }, (_, index) => ({ id: `hsa0${4000 + index * 37}`, name: pick(seed(key, `kpn${index}`), ["Cell cycle", "p53 signalling pathway", "PI3K-Akt signalling pathway", "MAPK signalling pathway", "Pathways in cancer", "Apoptosis", "Focal adhesion", "Cellular senescence", "Drug metabolism — cytochrome P450", "Insulin signalling pathway", "Calcium signalling pathway", "Neuroactive ligand-receptor interaction"]) }));
          const diseases = Array.from({ length: Math.floor(span(seed(key, "kd"), 0, 6)) }, (_, index) => ({ id: `H0${100 + index * 13}`, name: pick(seed(key, `kdn${index}`), ["Non-small cell lung cancer", "Chronic myeloid leukaemia", "Type 2 diabetes mellitus", "Hypertension", "Alzheimer disease", "Rheumatoid arthritis"]) }));
          const drugs = Array.from({ length: Math.floor(span(seed(key, "kdr"), 0, 9)) }, (_, index) => ({ id: `D0${2000 + index * 41}`, name: pick(seed(key, `kdrn${index}`), ["Imatinib", "Gefitinib", "Celecoxib", "Atorvastatin", "Sildenafil", "Losartan", "Omeprazole", "Metformin"]) }));
          return {
            status: "live", source: "KEGG (release 110.0)", url: `https://www.kegg.jp/entry/hsa:${gene}`,
            interpretation: `${gene} is annotated in ${pathways.length} KEGG pathway${pathways.length === 1 ? "" : "s"}${diseases.length ? `, ${diseases.length} disease entr${diseases.length === 1 ? "y" : "ies"}` : ""}${drugs.length ? ` and ${drugs.length} annotated drug${drugs.length === 1 ? "" : "s"}` : ""}. Pathway breadth is a proxy for how many downstream systems a modulator could perturb.`,
            pathways, diseases, drugs,
            n_pathways: pathways.length, n_diseases: diseases.length, n_drugs: drugs.length,
            limitations: "KEGG annotation is manually curated but incomplete, and pathway membership is not a statement about the strength of the target's role in it.",
          };
        })()
        : { status: "no-data", reason: `No KEGG entry was found for ${gene}.` }
      : { status: "skipped", reason: "No gene symbol was resolved, so KEGG was not queried." };

    sources.reactome = uniprot
      ? chance(seed(key, "reactome"), 0.82)
        ? {
          status: "live", source: "Reactome v88", url: `https://reactome.org/content/query?q=${uniprot}`,
          n_pathways_total: Math.floor(span(seed(key, "rp"), 4, 40)),
          n_reactions: Math.floor(span(seed(key, "rr"), 6, 90)),
          top_level_processes: ["Cell Cycle", "Signal Transduction", "Metabolism of proteins", "Immune System", "Gene expression (Transcription)"].slice(0, Math.floor(span(seed(key, "rt"), 2, 5))),
          pathways: Array.from({ length: 10 }, (_, index) => ({
            st_id: `R-HSA-${Math.floor(span(seed(key, `rid${index}`), 100000, 999999))}`,
            name: pick(seed(key, `rn${index}`), ["Cyclin A/B1/B2 associated events during G2/M transition", "G0 and Early G1", "RAF/MAP kinase cascade", "PI3K/AKT Signaling in Cancer", "Transcriptional Regulation by TP53", "Interleukin-4 and Interleukin-13 signaling", "Cytochrome P450 - arranged by substrate type", "Neurotransmitter receptors and postsynaptic signal transmission"]),
            is_inferred: chance(seed(key, `ri${index}`), 0.2),
            url: "https://reactome.org/",
          })),
          limitations: "Reactome membership is curated from the literature. An inferred entry is projected by orthology rather than directly curated in human.",
        }
        : { status: "no-data", reason: `No Reactome reaction membership was found for UniProt ${uniprot}.` }
      : { status: "skipped", reason: "No UniProt accession was resolved, so Reactome was not queried." };
  }

  if (panel === "hazard") {
    const hasIdentity = Boolean(inchikey || identifiers.compound_name || identifiers.casrn);
    sources.toxref = hasIdentity
      ? chance(seed(key, "toxref"), 0.5)
        ? (() => {
          const records = Array.from({ length: Math.floor(span(seed(key, "trn"), 3, 16)) }, (_, index) => {
            const type = pick(seed(key, `trt${index}`), ["NOAEL", "LOAEL", "LD50"]);
            return {
              species: pick(seed(key, `trs${index}`), ["rat", "mouse", "dog", "rabbit"]),
              study_type: pick(seed(key, `trst${index}`), ["Subchronic 90-day oral", "Chronic 2-year oral", "Developmental", "Acute oral", "Subchronic 28-day oral"]),
              tox_val_type: type,
              value_mg_kg_day: round(logSpan(seed(key, `trv${index}`), 2, 2400), 2),
              units: type === "LD50" ? "mg/kg" : "mg/kg/day",
              exposure_route: pick(seed(key, `trr${index}`), ["oral gavage", "dietary", "oral capsule", "intravenous"]),
              critical_effect: pick(seed(key, `trc${index}`), ["Hepatocellular hypertrophy", "Reduced body-weight gain", "Renal tubular degeneration", "Thyroid follicular hypertrophy", "Decreased haemoglobin", "Adrenal cortical vacuolation", "No adverse effect observed"]),
              source_study: `EPA ToxRefDB study ${Math.floor(span(seed(key, `trid${index}`), 1000, 9999))}`,
            };
          });
          const noaels = records.filter((record) => record.tox_val_type === "NOAEL");
          const loaels = records.filter((record) => record.tox_val_type === "LOAEL");
          const ld50s = records.filter((record) => record.tox_val_type === "LD50");
          return {
            status: "live", display_name: "EPA ToxRefDB / ToxValDB — measured in-vivo hazard", source: "EPA CompTox Chemicals Dashboard", url: "https://comptox.epa.gov/dashboard",
            records,
            n_records: records.length,
            most_conservative_noael_mg_kg_day: noaels.length ? Math.min(...noaels.map((record) => record.value_mg_kg_day)) : null,
            most_conservative_loael_mg_kg_day: loaels.length ? Math.min(...loaels.map((record) => record.value_mg_kg_day)) : null,
            lowest_ld50_mg_kg: ld50s.length ? Math.min(...ld50s.map((record) => record.value_mg_kg_day)) : null,
            species_covered: [...new Set(records.map((record) => record.species))],
            limitations: "These are measured values on a structure, not necessarily on the same salt or stereoisomer. Confirm the identity of the matched record before using it as an anchor.",
          };
        })()
        : { status: "no-data", reason: "No ToxRefDB or ToxValDB record matched this structure. That is an absence of a regulatory-toxicology record, not evidence of safety." }
      : { status: "skipped", reason: "No InChIKey, CAS registry number or preferred name was available, so the EPA hazard databases were not queried." };

    sources.ecotox = hasIdentity
      ? chance(seed(key, "ecotox"), 0.4)
        ? {
          status: "live", display_name: "EPA ECOTOX — environmental toxicology", source: "EPA ECOTOX Knowledgebase", url: "https://cfpub.epa.gov/ecotox/",
          n_studies: Math.floor(span(seed(key, "en"), 4, 40)),
          lowest_noec: round(logSpan(seed(key, "enoec"), 0.01, 12), 4),
          lowest_lc50_ec50: round(logSpan(seed(key, "elc50"), 0.05, 80), 3),
          studies: Array.from({ length: 10 }, (_, index) => ({
            species: pick(seed(key, `es${index}`), ["Daphnia magna", "Danio rerio", "Pimephales promelas", "Oncorhynchus mykiss", "Selenastrum capricornutum", "Lemna minor"]),
            endpoint: pick(seed(key, `ee${index}`), ["LC50", "EC50", "NOEC", "LOEC"]),
            value: round(logSpan(seed(key, `ev${index}`), 0.01, 90), 4),
            units: "mg/L",
            duration: Math.floor(span(seed(key, `ed${index}`), 24, 96)),
            duration_units: "h",
            exposure_route: "aquatic — static renewal",
          })),
          limitations: "Environmental endpoints inform the environmental risk assessment required at marketing authorisation. They do not bear on human safety.",
        }
        : { status: "no-data", reason: "No ECOTOX record matched this structure." }
      : { status: "skipped", reason: "No chemical identifier was available, so ECOTOX was not queried." };

    sources.toxcast = hasIdentity
      ? chance(seed(key, "toxcast"), 0.62)
        ? (() => {
          const screened = Math.floor(span(seed(key, "tcn"), 180, 1100));
          const active = Math.floor(screened * span(seed(key, "tca"), 0.01, 0.16));
          return {
            status: "live", display_name: "EPA ToxCast / Tox21 — in-vitro screening battery", source: "EPA InvitroDB v4.1", url: "https://comptox.epa.gov/dashboard",
            n_assays_screened: screened,
            n_active: active,
            hit_rate: round(active / screened, 4),
            most_potent_active: { assay_name: pick(seed(key, "tcp"), ["TOX21_MMP_ratio_down", "ATG_PPARg_TRANS_up", "NVS_ENZ_hPDE4A1", "TOX21_ERa_LUC_BG1_Agonist", "APR_HepG2_MitoMass_24h_dn"]), ac50_uM: round(logSpan(seed(key, "tcac"), 0.05, 22), 4) },
            assay_hits: Array.from({ length: 15 }, (_, index) => {
              const isActive = index < Math.min(active, 8);
              return {
                assay_name: pick(seed(key, `tcan${index}`), ["TOX21_MMP_ratio_down", "ATG_PPARg_TRANS_up", "NVS_ENZ_hPDE4A1", "TOX21_ERa_LUC_BG1_Agonist", "APR_HepG2_MitoMass_24h_dn", "TOX21_AhR_LUC_Agonist", "TOX21_p53_BLA_p1_ratio", "NVS_ADME_hCYP3A4", "ATG_NRF2_ARE_CIS_up", "TOX21_AR_BLA_Antagonist_ratio"]),
                gene: pick(seed(key, `tcg${index}`), ["ESR1", "AR", "PPARG", "AHR", "NFE2L2", "TP53", "CYP3A4", null]),
                active: isActive,
                ac50_uM: isActive ? round(logSpan(seed(key, `tcv${index}`), 0.05, 60), 4) : null,
                cytotoxicity_flag: isActive ? pick(seed(key, `tcc${index}`), ["none", "borderline — activity within 3× of the cytotoxicity burst", "confounded by cytotoxicity"]) : "not applicable",
              };
            }),
            limitations: "A hit at a concentration close to the cytotoxicity burst is usually a cytotoxicity artefact rather than a specific pathway effect. The flag column reports that judgement.",
          };
        })()
        : { status: "no-data", reason: "This structure has not been screened in the ToxCast or Tox21 libraries." }
      : { status: "skipped", reason: "No DSSTox substance identifier could be resolved, so the screening battery was not queried." };
  }

  if (panel === "clinical") {
    const target = identifiers.gene_symbol ?? identifiers.target_protein;
    sources.clinical_trials = target || identifiers.therapeutic_area
      ? chance(seed(key, "ct"), 0.9)
        ? (() => {
          const total = Math.floor(span(seed(key, "ctn"), 6, 240));
          const completed = Math.floor(total * span(seed(key, "ctc"), 0.3, 0.6));
          const terminated = Math.floor(total * span(seed(key, "ctt"), 0.03, 0.14));
          return {
            status: "live", source: "ClinicalTrials.gov API v2", url: "https://clinicaltrials.gov/",
            total_matching: total, completed, terminated_or_withdrawn: terminated,
            median_enrollment: Math.floor(span(seed(key, "cte"), 28, 420)),
            by_phase: { "Phase 1": Math.floor(total * 0.32), "Phase 2": Math.floor(total * 0.34), "Phase 3": Math.floor(total * 0.22), "Phase 4": Math.floor(total * 0.12) },
            trials: Array.from({ length: 10 }, (_, index) => ({
              nct_id: `NCT0${Math.floor(span(seed(key, `ctid${index}`), 1000000, 9999999))}`,
              title: `${pick(seed(key, `ctp${index}`), ["A Phase 1 Study of", "A Randomised Phase 2 Study of", "An Open-Label Extension Study of", "A Dose-Escalation Study of"])} a ${target ?? "novel"} ${pick(seed(key, `ctm${index}`), ["inhibitor", "antagonist", "modulator"])} in ${identifiers.therapeutic_area ?? "adult participants"}`,
              phase: pick(seed(key, `ctph${index}`), ["Phase 1", "Phase 1/2", "Phase 2", "Phase 3"]),
              status: pick(seed(key, `cts${index}`), ["Completed", "Recruiting", "Active, not recruiting", "Terminated", "Withdrawn"]),
              why_stopped: chance(seed(key, `ctw${index}`), 0.14) ? pick(seed(key, `ctwr${index}`), ["Business decision", "Insufficient efficacy at interim analysis", "Sponsor decision — portfolio reprioritisation", "Slow accrual"]) : null,
              enrollment: Math.floor(span(seed(key, `ctne${index}`), 12, 620)),
              sponsor: pick(seed(key, `ctsp${index}`), ["Novartis", "Pfizer", "AstraZeneca", "Merck", "Roche", "Bristol Myers Squibb", "National Cancer Institute", "Academic consortium"]),
              url: "https://clinicaltrials.gov/",
            })),
            limitations: "Registry entries are self-reported and are frequently not updated after study completion. A terminated status without a stated reason carries no information about why.",
          };
        })()
        : { status: "no-data", reason: "No registered study matched this target or indication." }
      : { status: "skipped", reason: "No target or indication was supplied, so ClinicalTrials.gov was not queried." };

    sources.pharmgkb = gene
      ? chance(seed(key, "pgkb"), 0.35)
        ? {
          status: "live", source: "PharmGKB", url: `https://www.pharmgkb.org/gene/${gene}`,
          interpretation: `${gene} carries curated clinical variant annotations. Where a target or a metabolising enzyme is an established pharmacogene, genotype contributes materially to exposure or response variability.`,
          n_variants: Math.floor(span(seed(key, "pgn"), 2, 40)),
          n_actionable: Math.floor(span(seed(key, "pga"), 0, 8)),
          n_guidelines: Math.floor(span(seed(key, "pgg"), 0, 4)),
          is_established_pharmacogene: chance(seed(key, "pge"), 0.4),
          variants: Array.from({ length: 8 }, (_, index) => ({
            name: pick(seed(key, `pgv${index}`), ["rs1801252", "rs4149056", "*2", "*3", "*17", "rs1057910", "rs776746", "rs4244285"]),
            level_of_evidence: pick(seed(key, `pgl${index}`), ["1A", "1B", "2A", "2B", "3"]),
            significance: pick(seed(key, `pgs${index}`), ["Actionable", "Informative", "Not significant"]),
            phenotype: pick(seed(key, `pgp${index}`), ["Altered metabolism", "Increased exposure", "Reduced response", "Increased toxicity risk"]),
            chemicals: [pick(seed(key, `pgc${index}`), ["warfarin", "clopidogrel", "simvastatin", "codeine", "tamoxifen"])],
          })),
          guidelines: Array.from({ length: Math.floor(span(seed(key, "pggn"), 0, 3)) }, (_, index) => ({ name: `Dosing guideline for ${pick(seed(key, `pggd${index}`), ["warfarin", "clopidogrel", "simvastatin"])}`, source: pick(seed(key, `pggs${index}`), ["CPIC", "DPWG", "FDA label"]) })),
          limitations: "Pharmacogenomic annotations describe the gene, not the compound. They matter here only where the gene is on this compound's clearance or response pathway.",
        }
        : { status: "no-data", reason: `No curated PharmGKB clinical annotation exists for ${gene}.` }
      : { status: "skipped", reason: "No gene symbol was resolved, so PharmGKB was not queried." };

    sources.disgenet = gene
      ? chance(seed(key, "dgn"), 0.7)
        ? (() => {
          const diseases = Array.from({ length: 12 }, (_, index) => ({
            disease_name: pick(seed(key, `dgd${index}`), ["Breast carcinoma", "Non-small cell lung carcinoma", "Type 2 diabetes mellitus", "Alzheimer disease", "Rheumatoid arthritis", "Schizophrenia", "Hypertension", "Colorectal carcinoma", "Idiopathic pulmonary fibrosis", "Major depressive disorder"]),
            score: round(span(seed(key, `dgs${index}`), 0.05, 0.92), 3),
            evidence_index: round(span(seed(key, `dge${index}`), 0.3, 1.0), 3),
            n_publications: Math.floor(span(seed(key, `dgp${index}`), 1, 340)),
            disease_type: pick(seed(key, `dgt${index}`), ["disease", "phenotype", "group"]),
          })).sort((a, b) => b.score - a.score);
          return {
            status: "live", display_name: "DisGeNET — gene–disease associations", source: "DisGeNET v24.2", url: `https://www.disgenet.org/search`,
            n_diseases: diseases.length,
            disease_specificity_index: round(span(seed(key, "dsi"), 0.25, 0.85), 3),
            disease_pleiotropy_index: round(span(seed(key, "dpi"), 0.15, 0.9), 3),
            strongest_association: diseases[0].disease_name,
            diseases,
            limitations: "A high pleiotropy index means the gene is associated with many unrelated conditions, which usually predicts a broader on-target effect profile for any modulator of it.",
          };
        })()
        : { status: "no-data", reason: `No gene–disease association is curated for ${gene}.` }
      : { status: "skipped", reason: "No gene symbol was resolved, so DisGeNET was not queried." };

    sources.gnomad = gene
      ? chance(seed(key, "gnomad"), 0.85)
        ? (() => {
          const pLI = round(span(seed(key, "pli"), 0, 1), 3);
          const call = pLI > 0.9 ? "loss_of_function_intolerant" : pLI < 0.1 ? "loss_of_function_tolerant" : "indeterminate";
          return {
            status: "live", source: "gnomAD v4.1", url: `https://gnomad.broadinstitute.org/gene/${gene}`,
            constraint: {
              call, pLI,
              oe_lof: round(span(seed(key, "oelof"), 0.02, 1.4), 3),
              loeuf: round(span(seed(key, "loeuf"), 0.08, 1.9), 3),
              missense_z: round(span(seed(key, "misz"), -1.5, 5.2), 2),
              note: call === "loss_of_function_intolerant"
                ? "The gene is intolerant of loss of function in the general population, which usually means that complete inhibition of the target would be poorly tolerated. It is a target-risk signal, not a compound-risk signal."
                : call === "loss_of_function_tolerant"
                  ? "Loss-of-function variants are observed at the expected rate, so complete inhibition of the target is likely to be tolerated at the level of the gene."
                  : "Constraint is indeterminate at the current sample size. No inference about the tolerability of target inhibition is supported.",
            },
            n_variants_returned: Math.floor(span(seed(key, "nvar"), 40, 900)),
            n_loss_of_function: Math.floor(span(seed(key, "nlof"), 0, 40)),
            n_missense: Math.floor(span(seed(key, "nmis"), 20, 500)),
            variants: Array.from({ length: 10 }, (_, index) => ({
              variant_id: `${Math.floor(span(seed(key, `vc${index}`), 1, 22))}-${Math.floor(span(seed(key, `vp${index}`), 100000, 99999999))}-${pick(seed(key, `vr${index}`), ["A", "C", "G", "T"])}-${pick(seed(key, `va${index}`), ["A", "C", "G", "T"])}`,
              rsid: chance(seed(key, `vrs${index}`), 0.7) ? `rs${Math.floor(span(seed(key, `vrsn${index}`), 1000000, 999999999))}` : null,
              consequence: pick(seed(key, `vcs${index}`), ["missense_variant", "synonymous_variant", "stop_gained", "frameshift_variant", "splice_donor_variant"]),
              allele_frequency: round(span(seed(key, `vaf${index}`), 0.0000012, 0.04), 7),
              is_loss_of_function: chance(seed(key, `vlof${index}`), 0.18),
            })),
            limitations: "Population constraint describes tolerance of the gene to loss of function. A pharmacological inhibitor is usually partial and reversible, so constraint bounds the risk rather than defining it.",
          };
        })()
        : { status: "no-data", reason: `No gnomAD constraint metrics are available for ${gene}.` }
      : { status: "skipped", reason: "No gene symbol was resolved, so gnomAD was not queried." };
  }

  const catalogue = meta.catalogue.map((entry) => ({ ...entry }));
  const blocks = catalogue.map((entry) => sources[entry.key]).filter(Boolean);
  return {
    panel,
    available: blocks.some((block) => block.status === "live"),
    identifiers,
    catalogue,
    sources,
    sources_with_data: catalogue.filter((entry) => sources[entry.key]?.status === "live").map((entry) => entry.key),
    sources_empty: catalogue.filter((entry) => sources[entry.key]?.status === "no-data").map((entry) => entry.key),
    sources_skipped: catalogue.filter((entry) => sources[entry.key]?.status === "skipped").map((entry) => entry.key),
    sources_failed: catalogue.filter((entry) => ["error", "unavailable"].includes(sources[entry.key]?.status ?? "")).map((entry) => entry.key),
    limitations: meta.limitations,
  };
}

/* ── FDA product-specific guidance ───────────────────────────────────────── */

export function fdaPsg(drugName: string | null) {
  if (!drugName) return null;
  const key = `psg::${drugName}`;
  const apps = Math.floor(span(seed(key, "apps"), 1, 12));
  return {
    available: true,
    drug: drugName,
    total_apps_found: apps,
    bcs_class: pick(seed(key, "bcs"), ["I (high solubility, high permeability)", "II (low solubility, high permeability)", "III (high solubility, low permeability)", "IV (low solubility, low permeability)", null]),
    bcs_note: "The BCS class is read from the FDA label where it is stated. Where the label is silent, no class is asserted — a computed class would not carry the same regulatory meaning.",
    be_window_standard: "80.00 – 125.00% for the 90% confidence interval of the geometric mean ratio of AUC and Cmax",
    reference_listed_drugs: Array.from({ length: Math.min(apps, 6) }, (_, index) => ({
      brand_name: pick(seed(key, `brand${index}`), ["Gleevec", "Lipitor", "Celebrex", "Cozaar", "Iressa", "Prilosec", "Cipro"]),
      application_number: `${pick(seed(key, `apptype${index}`), ["NDA", "ANDA"])}${Math.floor(span(seed(key, `appno${index}`), 20000, 21999))}`,
      application_type: pick(seed(key, `apptype2${index}`), ["NDA", "ANDA"]),
      sponsor: pick(seed(key, `sponsor${index}`), ["Novartis", "Pfizer", "AstraZeneca", "Merck", "Teva", "Sandoz"]),
      dosage_form: pick(seed(key, `form${index}`), ["TABLET, FILM COATED", "CAPSULE", "TABLET", "SOLUTION"]),
      route: pick(seed(key, `route${index}`), ["ORAL", "INTRAVENOUS"]),
      te_code: pick(seed(key, `te${index}`), ["AB", "AB1", "AP", "BX", null]),
      te_description: "Therapeutic equivalence code from the Orange Book. AB indicates demonstrated bioequivalence to the reference-listed drug.",
      marketing_status: pick(seed(key, `status${index}`), ["Prescription", "Discontinued", "Over-the-counter"]),
    })),
    clinical_pharmacology_snippet: `Following oral administration, ${drugName} is absorbed with a median time to peak plasma concentration of ${round(span(seed(key, "tmax"), 0.5, 4), 1)} hours. Plasma protein binding is approximately ${round(span(seed(key, "ppb"), 88, 99.5), 1)}%. Elimination is predominantly ${pick(seed(key, "elim"), ["hepatic, via CYP3A4-mediated oxidation", "renal, as unchanged drug", "hepatic, with a minor renal contribution"])}, with a terminal half-life of approximately ${round(span(seed(key, "thalf"), 2, 30), 1)} hours.`,
    psg_search_url: "https://www.accessdata.fda.gov/scripts/cder/psg/",
    dissolution_db_url: "https://www.accessdata.fda.gov/scripts/cder/dissolution/",
    limitation: "The FDA publishes product-specific guidance documents as PDFs with no machine-readable index, so this panel returns the approval and label record that surrounds them plus a direct search link. It does not assert the contents of a guidance document it has not read.",
  };
}
