import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import hakaseLogo from "@assets/image_1773504202272.png";
import {
  initChemistry,
  getMolecularProperties,
  generateFingerprint,
  isReady,
  type MolecularProperties,
  type FingerprintInfo,
  getRDKitInstance,
} from "@/lib/chemistry";
import { runAdmetSimulation, type SimResults, type ToxicityAlert, type OrganRisk, type AdmetScores, type BindingEstimate, type LipinskiAnalysis } from "@/lib/admet";
import { fetchCompoundFromApi, type ApiSource } from "@/lib/apiImport";
import {
  fetchUniProt, fetchPdbStructure, fetchAlphaFoldFull,
  type ProteinInfo, type PdbStructure, type AlphafoldPrediction,
} from "@/lib/proteinApi";
import { runCohortSimulation, type CohortResults, type L2PkOverrides } from "@/lib/cohortSim";
import { fetchFAERSSignals } from "@/lib/faersApi";
import { fetchPDParameters } from "@/lib/pdModel";
import { runTrialSimulation, runProcovaAnalysis, lookupVarianceReduction, type TrialResults, type ProcovaResults, type ProcovaConfig } from "@/lib/trialSim";
import {
  runAnimalCohortSimulation, type AnimalCohortResults,
  SPECIES_LIST, STUDY_TYPE_LIST, type SpeciesId, type StudyType,
  type FormulationType, type FormulationResult,
} from "@/lib/animalSim";
import { FORMULATION_LIST } from "@/lib/formulationDB";
import { fetchBindingDB, type BindingDBResult } from "@/lib/bindingDB";
import { fetchChEMBLMultiTarget, fetchChemblAnimalPk, validateAucPrediction, type ChEMBLMultiTargetResult, type ChEMBLAnimalPkResult } from "@/lib/chemblActivity";
import { fetchCompTox, type ToxCastResult } from "@/lib/toxcast";
import { fetchToxRef, validateNoaelPrediction, type ToxRefResult } from "@/lib/toxRef";
import { searchClinicalTrials, type CTGSearchResult } from "@/lib/clinicalTrials";
import { fetchOpenTargets, type OTTargetResult } from "@/lib/openTargets";
import { fetchStringInteractions, type StringResult } from "@/lib/stringApi";
import { fetchKEGGPathways, type KEGGResult } from "@/lib/kegg";
import { fetchReactomePathways, type ReactomeResult } from "@/lib/reactome";
import { fetchPharmGKB, type PharmGKBResult } from "@/lib/pharmgkb";
import { fetchDisGeNET, type DisGeNETGeneResult } from "@/lib/disgeNet";
import { fetchGnomAD, type GnomADResult } from "@/lib/gnomad";
import { fetchEcotox, type ECOTOXResult } from "@/lib/ecotox";
import { suggestTargets, convertChEMBLHitsToSuggestions, isValidUniprotAccession, type TargetSuggestion } from "@/lib/targetSuggestion";
import { detectPharmacophores } from "@/lib/chemistry";
import { fetchChEMBLTargets } from "@/lib/chemblTargetLookup";
import { tierChipClasses, tierLabel, shouldSuppressEstimate } from "@/lib/sourceQuality";
import { evaluateCascadeGate, recordCascadeOverride, type CascadeOverrideRecord } from "@/lib/cascadeGate";
import { runInVitroSimulation, type InVitroResults } from "@/lib/inVitroSim";
import {
  computeLayer1Flags, computeLayer2Flags, computeLayer3Flags,
  getFlagsForLayer, getActiveFlags, hasReviewRequired,
  createProvenance, createHAIOpsContext, mergeLayerProvenance,
  mergeLayerFlags, addOverride, acknowledgeReview, getDbDegradationWarnings,
  SAFETY_FLAG_COLORS,
  type SafetyFlag, type SafetyOverride, type ProvenanceRecord,
  type HAIOpsContext, type DatabaseQueryRecord,
} from "@/lib/safetyFlags";
import { createPortal } from "react-dom";
import { MolViewer3D_Cinematic } from "./MolViewer3D_Cinematic";
import { MolViewer3D_Scientific } from "./MolViewer3D_Scientific";
import { MolViewer3D_Explorer } from "./MolViewer3D_Explorer";
import { MolViewer3D_Docking } from "./MolViewer3D_Docking";
import { ExternalDbPanel } from "@/components/ExternalDbPanel";
import { DemoRunner } from "@/components/DemoRunner";
import { MlAdmetCard } from "@/components/MlAdmetCard";
import {
  predictProtein,
  predictProteinMl,
  predictProperties,
  predictSolubilityMl,
  predictBinding,
  predictBindingMl,
  predictDiliMl,
  predictAdmetMl,
  type DiliMlResult,
  type MlAdmetResult,
  type AiProteinResult,
  type ProteinMlResult,
  type AiPropertiesResult,
  type SolubilityMlResult,
  type AiBindingResult,
  type BindingMlResult,
} from "@/lib/aiService";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FlaskConical, Users, Beaker, ChevronRight, Play, Download, ArrowRight,
  Info, CheckCircle2, AlertTriangle, XCircle, Atom, Activity, TrendingUp,
  BarChart3, LineChart, PieChart, Map, FileText, Settings2, Plus, Trash2,
  ChevronDown, ChevronUp, Zap, Clock, Target, Shield, Database, GitBranch,
  Microscope, Dna, HeartPulse, Brain, Layers, LayoutDashboard,
  Search, Menu, X, Filter, RefreshCw, Eye, Lock, Maximize2, Box, Globe, Sparkles, MessageCircle,
  TestTube2, Rabbit, Stethoscope, TrendingDown, ArrowUpRight,
  Cpu, ShieldAlert, GitMerge, Stamp, DoorOpen, Wrench, Syringe,
  Sun, Moon
} from "lucide-react";
// 4-Layer Pre-Clinical Architecture (April 2026 redesign).
// L1 In Vitro → L2 In Silico → L3 Ex Vivo → L4 Animal Cohort.
// Patient Cohort + Trial code is preserved but gated unreachable.
import { HIDE_PATIENT_TRIAL_LAYERS } from "@/lib/layerArchitecture";
import { Layer2InSilicoScaffold } from "@/components/Layer2InSilicoScaffold";
import { Layer3ExVivoScaffold } from "@/components/Layer3ExVivoScaffold";

type Layer = 1 | 2 | 3 | 4;
type SimulationStatus = "idle" | "running" | "complete" | "error";

interface CriteriaRow {
  id: string;
  type: "Inclusion" | "Exclusion";
  category: string;
  operator: string;
  value: string;
}

interface SecondaryEndpoint {
  id: string;
  name: string;
  type: string;
  timepoint: string;
}

export function HakaseAI() {
  const [demoOpen, setDemoOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("demo") === "true";
    }
    return false;
  });

  const [activeLayer, setActiveLayer] = useState<Layer>(1);
  // L2 Confirmation hosts two sub-tracks: in-silico (existing scaffold) and ex-vivo (existing scaffold).
  const [confirmationSubTrack, setConfirmationSubTrack] = useState<"insilico" | "exvivo">("insilico");
  const [simStatus, setSimStatus] = useState<Record<Layer, SimulationStatus>>({
    1: "idle",
    2: "idle",
    3: "idle",
    4: "idle",
  });
  const [simProgress, setSimProgress] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [lightMode, setLightMode] = useState(false);
  const [viewer3DOpen, setViewer3DOpen] = useState(false);
  const [viewer3DMode, setViewer3DMode] = useState<"cinematic" | "scientific" | "explorer" | "docking">("cinematic");
  const [diagenOpen, setDiagenOpen] = useState(false);
  const [diagenJobId, setDiagenJobId] = useState("");
  const [diagenMode, setDiagenMode] = useState<"sync" | "batch" | "cascade">("sync");
  const [diagenLoading, setDiagenLoading] = useState(false);
  const [diagenResult, setDiagenResult] = useState<{
    name: string; smiles: string; mw: string; uniprotId: string; targetName: string;
    admet: { absorption: number; distribution: number; metabolism: number; excretion: number; toxicity: number };
    qed: number; sa: number; bindingAffinity: string;
  } | null>(null);
  const [apiImportOpen, setApiImportOpen] = useState(false);
  const [apiSource, setApiSource] = useState<ApiSource>("chembl");
  const [apiCompoundId, setApiCompoundId] = useState("");
  const [apiLoading, setApiLoading] = useState(false);
  const [apiResult, setApiResult] = useState<{ name: string; smiles: string; mw: string; sourceId?: string } | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [projImportOpen, setProjImportOpen] = useState(false);
  const [projImportSource, setProjImportSource] = useState("clinicaltrials");
  const [projImportId, setProjImportId] = useState("");
  const [projImportLoading, setProjImportLoading] = useState(false);
  const [projImportResult, setProjImportResult] = useState<{
    name: string; indication: string; phase: string; sponsor: string;
    enrollment?: number | null; nctId?: string | null;
    abstract?: string;
  } | null>(null);
  // Starter templates that pre-populate the Layer 1 form. They are *not*
  // saved runs — clicking one only loads SMILES / target / indication and
  // resets all simulation results, so we must not display fabricated
  // QED / binding / responder / success / Go-No-Go numbers here.
  const [savedProjects, setSavedProjects] = useState([
    {
      name: "CDK4/6 Inhibitor Screen",
      indication: "Breast Cancer",
      indicationCode: "C50 – Breast Cancer (HR+/HER2-)",
      molName: "HAK-CDK4-231",
      smiles: "C1CN(C(=O)c2cc3cc(NC(=O)c4ccc(F)cn4)ccc3[nH]2)CCC1N",
      uniprotId: "P11802",
    },
    {
      name: "EGFR-T790M Mutant",
      indication: "NSCLC",
      indicationCode: "C34.1 – Non-small-cell lung carcinoma",
      molName: "HAK-EGFR-047",
      smiles: "CN(C)CCNc1nc(Nc2cccc(c2)C(F)(F)F)c3cc(OC)c(NC(=O)/C=C/CN(C)C)cc3n1",
      uniprotId: "P00533",
    },
    {
      name: "KRAS G12C Series",
      indication: "Colorectal",
      indicationCode: "C18 – Colorectal carcinoma",
      molName: "HAK-KRAS-112",
      smiles: "CC1(C)CCC(=C1)c1cc(NC(=O)c2ccc(F)cc2)c2ncc(-c3ccncc3)cc2n1",
      uniprotId: "P01116",
    },
  ]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [pgxOpen, setPgxOpen] = useState(false);
  const [adaptiveOpen, setAdaptiveOpen] = useState(false);
  const [syntheticOpen, setSyntheticOpen] = useState(false);
  const [dropoutOpen, setDropoutOpen] = useState(false);

  // Layer 1 state
  const [smiles, setSmiles] = useState("CC(C)Cc1ccc(cc1)C(C)C(=O)O");
  const [activatedSmiles, setActivatedSmiles] = useState("CC(C)Cc1ccc(cc1)C(C)C(=O)O");
  const [molName, setMolName] = useState("Ibuprofen-Analog-001");
  const [uniprotId, setUniprotId] = useState("P00533");
  const [pdbId, setPdbId] = useState("4HJO");
  const [proteinInfo, setProteinInfo] = useState<ProteinInfo | null>(null);
  const [proteinLoading, setProteinLoading] = useState(false);
  const [proteinError, setProteinError] = useState<string | null>(null);
  const [pdbStructure, setPdbStructure] = useState<PdbStructure | null>(null);
  const [pdbLoading, setPdbLoading] = useState(false);
  const [alphafoldData, setAlphafoldData] = useState<AlphafoldPrediction | null>(null);
  // ── Druggability assessment (paired view: rule-based + ESM-2 ML) ──────────
  // Both fire in parallel from handleProteinFetch after UniProt succeeds.
  // Each side degrades gracefully if its endpoint fails so the rest of the
  // protein card still renders. The "loading" flags drive a small spinner per
  // side; the ML side may take many seconds while the model is cold-loading.
  const [proteinRule, setProteinRule] = useState<AiProteinResult | null>(null);
  const [proteinRuleLoading, setProteinRuleLoading] = useState(false);
  const [proteinMl, setProteinMl] = useState<ProteinMlResult | null>(null);
  const [proteinMlLoading, setProteinMlLoading] = useState(false);
  const proteinDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pdbDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sequence counter for protein-fetch requests. Each call to handleProteinFetch
  // captures the current value; async UniProt + AlphaFold callbacks compare
  // against this ref before applying setState so a slow response from a stale
  // request can't overwrite the result of a newer one when the user changes
  // UniProt IDs rapidly. Plain ID equality wouldn't catch repeat-of-same-ID.
  const proteinFetchSeqRef = useRef(0);
  // ── Molecule ML Predictions (paired view: rule-based + ML, per axis) ──────
  // Solubility is the first model. Both sides fire from a single SMILES-change
  // effect (debounced) so the user sees instant per-row updates as they edit.
  // Stale-request guard via solSeqRef matches the protein-ml pattern: rapid
  // edits don't paint stale results from a slow earlier request.
  const [solRule, setSolRule] = useState<AiPropertiesResult | null>(null);
  const [solRuleLoading, setSolRuleLoading] = useState(false);
  const [solMl, setSolMl] = useState<SolubilityMlResult | null>(null);
  const [solMlLoading, setSolMlLoading] = useState(false);
  const solSeqRef = useRef(0);
  const solDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── Binding affinity (paired view: ChEMBL similarity + DeepDTA-style ML) ──
  // Fires from a (smiles, uniprotId) effect. ChEMBL path returns measured
  // pIC50 from ≥70% Tanimoto neighbors when present; ML path returns a
  // learned pKd from ESM-2 ⊕ Morgan features and works even when ChEMBL
  // has zero neighbors. Stale-request guard via bindingSeqRef.
  const [bindingChembl, setBindingChembl] = useState<AiBindingResult | null>(null);
  const [bindingChemblLoading, setBindingChemblLoading] = useState(false);
  const [bindingMl, setBindingMl] = useState<BindingMlResult | null>(null);
  const [bindingMlLoading, setBindingMlLoading] = useState(false);
  const bindingSeqRef = useRef(0);
  const bindingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── L1 ML predictions used to flip stage-gate badges from HEURISTIC → ML
  // (DILI-ML hepatotox + ADMET-ML absorption). Binding-ML already has state above.
  // The ai-service caches per-SMILES so calling these here is cheap even if L2/L3
  // also call them later. Stale-request guards via *SeqRef.
  const [diliMl, setDiliMl] = useState<DiliMlResult | null>(null);
  const diliMlSeqRef = useRef(0);
  const [admetMl, setAdmetMl] = useState<MlAdmetResult | null>(null);
  const admetMlSeqRef = useRef(0);
  const [therapeuticArea, setTherapeuticArea] = useState("Oncology");
  const [admetOn, setAdmetOn] = useState(true);
  const [bindingOn, setBindingOn] = useState(true);
  const [toxOn, setToxOn] = useState(true);
  const [fingerprintOn, setFingerprintOn] = useState(false);

  // ── RDKit chemistry state ─────────────────────────────────────────────
  const [rdkitReady, setRdkitReady] = useState(false);
  const [molProps, setMolProps] = useState<MolecularProperties | null>(null);
  const [molFingerprint, setMolFingerprint] = useState<FingerprintInfo | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    initChemistry().then(() => {
      setRdkitReady(true);
    }).catch(console.warn);
  }, []);

  useEffect(() => {
    if (!rdkitReady) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const props = getMolecularProperties(smiles);
      setMolProps(props);
      setMolFingerprint(props?.isValid ? generateFingerprint(smiles) : null);
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [smiles, rdkitReady]);

  // ── Molecule ML: paired predictions on SMILES change ──────────────────────
  // First valid SMILES fires immediately (instant feedback on mount / paste).
  // Subsequent edits are debounced 400 ms so keystrokes don't spam the AI
  // service. We gate on RDKit-validated SMILES (molProps?.isValid) so we never
  // send obviously malformed strings. Each side's promise is guarded by
  // solSeqRef so stale responses can never overwrite the result of a newer
  // query.
  useEffect(() => {
    if (solDebounceRef.current) clearTimeout(solDebounceRef.current);
    const sm = smiles.trim();
    if (!sm) {
      setSolRule(null); setSolMl(null);
      setSolRuleLoading(false); setSolMlLoading(false);
      return;
    }
    if (rdkitReady && molProps && !molProps.isValid) {
      setSolRule(null); setSolMl(null);
      setSolRuleLoading(false); setSolMlLoading(false);
      return;
    }
    const seq = ++solSeqRef.current;
    const fire = () => {
      setSolRuleLoading(true);
      setSolMlLoading(true);
      predictProperties(sm)
        .then(r => { if (solSeqRef.current === seq) { setSolRule(r); setSolRuleLoading(false); } })
        .catch(() => { if (solSeqRef.current === seq) { setSolRule(null); setSolRuleLoading(false); } });
      predictSolubilityMl(sm)
        .then(r => { if (solSeqRef.current === seq) { setSolMl(r); setSolMlLoading(false); } })
        .catch(() => { if (solSeqRef.current === seq) { setSolMl(null); setSolMlLoading(false); } });
    };
    // First prediction or no prior result → fire immediately. Otherwise debounce.
    if (!solRule && !solMl) {
      fire();
    } else {
      solDebounceRef.current = setTimeout(fire, 400);
    }
    return () => { if (solDebounceRef.current) clearTimeout(solDebounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smiles, rdkitReady, molProps?.isValid]);

  // ── Binding affinity: paired predictions on (SMILES, UniProt) change ──────
  // Runs only when BOTH inputs are non-empty AND the SMILES is RDKit-valid.
  // ChEMBL side filters strictly to the requested UniProt (returns empty
  // predictions with a clear "no neighbors" status when it has no data) so
  // we never silently show a different target. ML side always returns a
  // value envelope (or a fallback envelope on parse/embed/inference failure).
  useEffect(() => {
    if (bindingDebounceRef.current) clearTimeout(bindingDebounceRef.current);
    const sm = smiles.trim();
    const uid = uniprotId.trim().toUpperCase();
    if (!sm || !uid) {
      setBindingChembl(null); setBindingMl(null);
      setBindingChemblLoading(false); setBindingMlLoading(false);
      return;
    }
    if (rdkitReady && molProps && !molProps.isValid) {
      setBindingChembl(null); setBindingMl(null);
      setBindingChemblLoading(false); setBindingMlLoading(false);
      return;
    }
    const seq = ++bindingSeqRef.current;
    const fire = () => {
      setBindingChemblLoading(true);
      setBindingMlLoading(true);
      predictBinding(sm, uid)
        .then(r => { if (bindingSeqRef.current === seq) { setBindingChembl(r); setBindingChemblLoading(false); } })
        .catch(() => { if (bindingSeqRef.current === seq) { setBindingChembl(null); setBindingChemblLoading(false); } });
      predictBindingMl(sm, uid)
        .then(r => { if (bindingSeqRef.current === seq) { setBindingMl(r); setBindingMlLoading(false); } })
        .catch(() => { if (bindingSeqRef.current === seq) { setBindingMl(null); setBindingMlLoading(false); } });
    };
    if (!bindingChembl && !bindingMl) {
      fire();
    } else {
      bindingDebounceRef.current = setTimeout(fire, 400);
    }
    return () => { if (bindingDebounceRef.current) clearTimeout(bindingDebounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smiles, uniprotId, rdkitReady, molProps?.isValid]);

  const mol2dSvg = useMemo(() => {
    if (!rdkitReady || !molProps?.isValid || !smiles) return null;
    try {
      const rdk = getRDKitInstance();
      if (!rdk) return null;
      const mol = rdk.get_mol(smiles);
      if (!mol || !mol.is_valid()) { mol?.delete(); return null; }
      const svg = mol.get_svg_with_highlights(JSON.stringify({
        width: 200,
        height: 150,
        bondLineWidth: 1.5,
        addAtomIndices: false,
        addStereoAnnotation: true,
      }));
      mol.delete();
      return svg;
    } catch { return null; }
  }, [smiles, rdkitReady, molProps?.isValid]);

  // ── Molecule-aware target protein suggestions ──────────────────────────────
  const [targetSuggOpen, setTargetSuggOpen] = useState(false);
  const [chemblLookupLoading, setChemblLookupLoading] = useState(false);
  const [chemblSuggestions, setChemblSuggestions] = useState<TargetSuggestion[]>([]);
  const chemblLookupRef = useRef<string>("");
  const [chemblCompoundName, setChemblCompoundName] = useState<string | null>(null);
  const [chemblCompoundId, setChemblCompoundId] = useState<string | null>(null);
  const molNameManual = useRef(false);

  const activatedMolProps = useMemo(() => {
    if (!rdkitReady || !activatedSmiles) return null;
    return getMolecularProperties(activatedSmiles);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activatedSmiles, rdkitReady]);

  const pharmacophores = useMemo(
    () => (activatedMolProps?.isValid && activatedSmiles ? detectPharmacophores(activatedSmiles) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activatedSmiles, activatedMolProps?.isValid],
  );

  // Heuristic suggestions are now dynamic: no hard top-N cap. The generator
  // filters by minimum confidence (Medium ≥ 0.35) and applies a safety floor
  // of 3 so the user always sees something even for weakly-overlapping
  // molecules. See `suggestTargets` doc-block for the full filtering rules.
  const heuristicSuggestions = useMemo<TargetSuggestion[]>(
    () => (activatedMolProps?.isValid ? suggestTargets(activatedSmiles, activatedMolProps, pharmacophores) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activatedSmiles, activatedMolProps?.isValid, pharmacophores],
  );

  const smilesNeedsActivation = smiles.trim() !== activatedSmiles.trim() && molProps?.isValid === true;

  const handleAnalyzeMolecule = useCallback(() => {
    if (molProps?.isValid && smiles.trim()) {
      uniprotManual.current = false;
      molNameManual.current = false;
      setUniprotAutoMode(true);
      setUniprotId("");
      setChemblSuggestions([]);
      setProteinInfo(null);
      setProteinError(null);
      setAlphafoldData(null);
      setPdbId("");
      setPdbStructure(null);
      setActivatedSmiles(smiles.trim());
    }
  }, [smiles, molProps?.isValid]);

  useEffect(() => {
    if (!activatedMolProps?.isValid || !activatedSmiles) {
      setChemblSuggestions([]);
      return;
    }
    const currentSmiles = activatedSmiles;
    chemblLookupRef.current = currentSmiles;
    molNameManual.current = false;
    setChemblSuggestions([]);
    setChemblCompoundName(null);
    setChemblCompoundId(null);
    setChemblLookupLoading(true);

    fetchChEMBLTargets(currentSmiles)
      .then((result) => {
        if (chemblLookupRef.current !== currentSmiles) return;
        if (result.status === "found") {
          if (result.compoundName && result.compoundName !== result.compoundChemblId) {
            setChemblCompoundName(result.compoundName);
            setChemblCompoundId(result.compoundChemblId);
            if (!molNameManual.current) {
              setMolName(result.compoundName.charAt(0).toUpperCase() + result.compoundName.slice(1).toLowerCase());
            }
          } else if (result.compoundChemblId) {
            setChemblCompoundId(result.compoundChemblId);
          }
          if (result.targets.length > 0) {
            const converted = convertChEMBLHitsToSuggestions(result.targets, result.compoundName);
            setChemblSuggestions(converted.length > 0 ? converted : []);
          }
        } else {
          setChemblSuggestions([]);
        }
      })
      .catch(() => {
        if (chemblLookupRef.current === currentSmiles) setChemblSuggestions([]);
      })
      .finally(() => {
        if (chemblLookupRef.current === currentSmiles) setChemblLookupLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activatedSmiles, activatedMolProps?.isValid]);

  // Combined suggestion list — fully dynamic, no hard cap.
  // Order: every ChEMBL hit first (real measured / similarity binding evidence
  // for THIS molecule), then heuristic catalogue matches that aren't already
  // surfaced by ChEMBL (deduped by UniProt ID). The heuristic side is already
  // confidence-filtered upstream by `suggestTargets`, so the combined length
  // naturally tracks how informative the molecule actually is.
  const targetSuggestions = useMemo<TargetSuggestion[]>(() => {
    if (chemblSuggestions.length === 0) return heuristicSuggestions;
    const chemblIds = new Set(chemblSuggestions.map(s => s.uniprotId));
    const fallbacks = heuristicSuggestions.filter(h => !chemblIds.has(h.uniprotId));
    return [...chemblSuggestions, ...fallbacks];
  }, [chemblSuggestions, heuristicSuggestions]);

  // ── Auto-sync top target suggestion → UniProt field ───────────────────────
  const uniprotManual = useRef(false);
  const [uniprotAutoMode, setUniprotAutoMode] = useState(true);

  useEffect(() => {
    if (uniprotManual.current) return;
    const top = targetSuggestions[0];
    if (!top) return;
    const areaMap: Record<string, string> = {
      "Oncology": "Oncology", "Oncology (CML)": "Oncology", "Oncology (Prostate) / Endocrinology": "Oncology",
      "Oncology (Breast) / Endocrinology": "Oncology", "Oncology / Angiogenesis": "Oncology",
      "Oncology (Hematology)": "Oncology", "Oncology / CNS": "Oncology",
      "Inflammation / Oncology": "Oncology", "Immuno-Oncology": "Immunology",
      "CNS / Psychiatry": "CNS", "CNS / Pain": "CNS", "CNS / Cardiovascular": "CNS",
      "Cardiovascular": "Cardiovascular",
      "Metabolic / Diabetes": "Metabolic",
      "Inflammation": "Immunology", "Inflammation / Pain": "Immunology",
      "Hematology / Autoimmune": "Immunology",
      "Infectious Disease / Immunology": "Infectious Disease",
      "Pain / Inflammation": "Immunology",
      "ChEMBL": "Oncology",
    };
    const mapped = areaMap[top.area];
    if (mapped) setTherapeuticArea(mapped);
    else {
      const fallback = top.area.split(/\s*[\/·]\s*/)[0].trim();
      const validAreas = ["Oncology","CNS","Cardiovascular","Metabolic","Rare Disease","Infectious Disease","Immunology"];
      const match = validAreas.find(v => fallback.toLowerCase().startsWith(v.toLowerCase()));
      if (match) setTherapeuticArea(match);
    }
    if (top.uniprotId !== uniprotId && isValidUniprotAccession(top.uniprotId)) {
      setUniprotId(top.uniprotId);
      setProteinInfo(null);
      setProteinError(null);
      setAlphafoldData(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSuggestions]);
  // ─────────────────────────────────────────────────────────────────────

  // ── UniProt explicit fetch ─────────────────────────────────────────────────
  const handleProteinFetch = useCallback(async (overrideId?: string | unknown) => {
    const id = (typeof overrideId === "string" ? overrideId : uniprotId).trim().toUpperCase();
    if (!id) return;
    if (!isValidUniprotAccession(id)) {
      setProteinError(`Invalid UniProt accession "${id}". Expected format e.g. P00533 or A0A024R161.`);
      setProteinInfo(null);
      setAlphafoldData(null);
      setProteinRule(null);
      setProteinMl(null);
      setProteinLoading(false);
      setProteinRuleLoading(false);
      setProteinMlLoading(false);
      return;
    }
    // Bump sequence and capture our token. Any setState below is gated on the
    // ref still matching — protects against stale UniProt or AlphaFold (incl.
    // PDB-download tail) responses overwriting the user's newer selection.
    const seq = ++proteinFetchSeqRef.current;
    const isCurrent = () => proteinFetchSeqRef.current === seq;

    setProteinLoading(true);
    setProteinError(null);
    setProteinInfo(null);
    setAlphafoldData(null);
    setProteinRule(null);
    setProteinMl(null);
    setProteinRuleLoading(true);
    setProteinMlLoading(true);
    try {
      const info = await fetchUniProt(id);
      if (!isCurrent()) return;
      setProteinInfo(info);
      if (info.pdbIds.length && !pdbId) setPdbId(info.pdbIds[0]);
      fetchAlphaFoldFull(id)
        .then(af => { if (isCurrent()) setAlphafoldData(af ?? null); })
        .catch(() => null);
      // Druggability — fire rule-based and ESM-2 ML in parallel, each
      // applying setState only if this fetch is still the current one.
      // Either may fail independently (network, cold-loading model, etc.)
      // and the UI degrades gracefully on a per-side basis.
      predictProtein(id)
        .then(r => { if (isCurrent()) setProteinRule(r); })
        .catch(() => { if (isCurrent()) setProteinRule(null); })
        .finally(() => { if (isCurrent()) setProteinRuleLoading(false); });
      predictProteinMl(id)
        .then(r => { if (isCurrent()) setProteinMl(r); })
        .catch(() => { if (isCurrent()) setProteinMl(null); })
        .finally(() => { if (isCurrent()) setProteinMlLoading(false); });
    } catch (err: unknown) {
      if (isCurrent()) {
        setProteinError(err instanceof Error ? err.message : "UniProt lookup failed");
      }
    } finally {
      if (isCurrent()) setProteinLoading(false);
    }
  }, [uniprotId, pdbId]);

  // ── RCSB PDB auto-fetch ────────────────────────────────────────────────────
  useEffect(() => {
    const id = pdbId.trim();
    if (id.length < 4) { setPdbStructure(null); return; }
    if (pdbDebounceRef.current) clearTimeout(pdbDebounceRef.current);
    pdbDebounceRef.current = setTimeout(async () => {
      setPdbLoading(true);
      try {
        const structure = await fetchPdbStructure(id);
        setPdbStructure(structure);
      } catch {
        setPdbStructure(null);
      } finally {
        setPdbLoading(false);
      }
    }, 600);
    return () => { if (pdbDebounceRef.current) clearTimeout(pdbDebounceRef.current); };
  }, [pdbId]);

  const [tissueTypes, setTissueTypes] = useState<string[]>(["Liver", "Kidney", "Cardiac"]);
  const [confidenceThreshold, setConfidenceThreshold] = useState([0.70]);
  const [rankingCriteria, setRankingCriteria] = useState("Composite");
  const [topN, setTopN] = useState("10");
  const [compositeWeights, setCompositeWeights] = useState([0.3, 0.3, 0.3, 0.1]);

  // ── ICD-10 comorbidity lookup ──────────────────────────────────────────────
  const ICD10_LIST = [
    { code: "I10",   label: "Hypertension" },
    { code: "E11",   label: "Type 2 Diabetes Mellitus" },
    { code: "E11",   label: "T2DM" },
    { code: "N18.3", label: "CKD Stage 3" },
    { code: "N18.4", label: "CKD Stage 4" },
    { code: "N18.5", label: "CKD Stage 5" },
    { code: "I50.9", label: "Heart Failure" },
    { code: "I48",   label: "Atrial Fibrillation" },
    { code: "J44.1", label: "COPD with Exacerbation" },
    { code: "J44.0", label: "COPD" },
    { code: "E78.5", label: "Hyperlipidaemia" },
    { code: "E78.0", label: "Hypercholesterolaemia" },
    { code: "K76.0", label: "Fatty Liver Disease" },
    { code: "K74.6", label: "Cirrhosis" },
    { code: "E03.9", label: "Hypothyroidism" },
    { code: "E05.9", label: "Hyperthyroidism" },
    { code: "M79.3", label: "Panniculitis" },
    { code: "M05",   label: "Rheumatoid Arthritis" },
    { code: "M35.9", label: "Autoimmune Disease" },
    { code: "G35",   label: "Multiple Sclerosis" },
    { code: "G20",   label: "Parkinson's Disease" },
    { code: "F32.9", label: "Depression" },
    { code: "F41.1", label: "Generalised Anxiety Disorder" },
    { code: "F20.9", label: "Schizophrenia" },
    { code: "I25.1", label: "Coronary Artery Disease" },
    { code: "I21",   label: "Myocardial Infarction" },
    { code: "I63",   label: "Ischaemic Stroke" },
    { code: "I64",   label: "Stroke, Unspecified" },
    { code: "Z87.39","label": "History of DVT/PE" },
    { code: "D64.9", label: "Anaemia" },
    { code: "D69.6", label: "Thrombocytopaenia" },
    { code: "C61",   label: "Prostate Cancer" },
    { code: "C50.9", label: "Breast Cancer" },
    { code: "C18.9", label: "Colorectal Cancer" },
    { code: "C34.9", label: "Lung Cancer" },
    { code: "C91.1", label: "Chronic Lymphocytic Leukaemia" },
    { code: "K92.1", label: "Melaena / GI Bleeding" },
    { code: "B18.1", label: "Chronic Hepatitis B" },
    { code: "B18.2", label: "Chronic Hepatitis C" },
    { code: "Z21",   label: "HIV Positive (Asymptomatic)" },
    { code: "B20",   label: "HIV Disease" },
    { code: "E10",   label: "Type 1 Diabetes Mellitus" },
    { code: "E66",   label: "Obesity" },
    { code: "E11.65","label": "T2DM with Hyperglycaemia" },
    { code: "N04",   label: "Nephrotic Syndrome" },
    { code: "N17",   label: "Acute Kidney Injury" },
    { code: "Q21.1", label: "Atrial Septal Defect" },
    { code: "M81.0", label: "Osteoporosis" },
    { code: "M10.9", label: "Gout" },
    { code: "L40",   label: "Psoriasis" },
    { code: "K51",   label: "Ulcerative Colitis" },
    { code: "K50",   label: "Crohn's Disease" },
  ];

  // Layer 4 — Animal Cohort state (formerly internal slot 2 — relocated by
  // the April 2026 4-layer redesign. Variable names retain the historic
  // "animal" prefix; the slot index is what changed, not the data shape.)
  const [animalSpecies, setAnimalSpecies] = useState<SpeciesId>("rat_sd");
  const [animalStudyType, setAnimalStudyType] = useState<StudyType>("sub_chronic_28d");
  const [animalRoute, setAnimalRoute] = useState("Oral");
  const [animalFormulation, setAnimalFormulation] = useState<FormulationType>("plain");
  const [animalResults, setAnimalResults] = useState<AnimalCohortResults | null>(null);
  const [l2AutoConfigured, setL2AutoConfigured] = useState(false);
  const l2ManualOverride = useRef({ species: false, study: false, route: false, formulation: false });

  // ── External DB enrichment state ──────────────────────────────────────────
  const [extBindingDB, setExtBindingDB]   = useState<BindingDBResult | null>(null);
  const [extChEMBL, setExtChEMBL]         = useState<ChEMBLMultiTargetResult | null>(null);
  const [extToxCast, setExtToxCast]       = useState<ToxCastResult | null>(null);
  const [extClinTrials, setExtClinTrials] = useState<CTGSearchResult | null>(null);
  const [extOpenTargets, setExtOpenTargets] = useState<OTTargetResult | null>(null);
  const [extString, setExtString]         = useState<StringResult | null>(null);
  const [extKEGG, setExtKEGG]             = useState<KEGGResult | null>(null);
  const [extReactome, setExtReactome]     = useState<ReactomeResult | null>(null);
  const [extPharmGKB, setExtPharmGKB]     = useState<PharmGKBResult | null>(null);
  const [extDisGeNET, setExtDisGeNET]     = useState<DisGeNETGeneResult | null>(null);
  const [extGnomAD, setExtGnomAD]         = useState<GnomADResult | null>(null);
  const [extEcotox, setExtEcotox]         = useState<ECOTOXResult | null>(null);
  const [extToxRef, setExtToxRef]         = useState<ToxRefResult | null>(null);
  const [extAnimalPk, setExtAnimalPk]     = useState<ChEMBLAnimalPkResult | null>(null);
  const [layer2Confidence, setLayer2Confidence] = useState<{ overall: number; noaelFold: number | null; aucFold: number | null; species: string | null } | null>(null);
  const [extDbLoading, setExtDbLoading]   = useState(false);

  // Layer 3 state
  const [indication, setIndication] = useState("C34.1 – Non-small-cell lung carcinoma");
  const [severity, setSeverity] = useState("Moderate");
  const [comorbidConditions, setComorbidConditions] = useState<Array<{ code: string; label: string }>>([
    { code: "I10",   label: "Hypertension" },
    { code: "E11",   label: "T2DM" },
    { code: "N18.3", label: "CKD Stage 3" },
  ]);
  const [comorbidSearch, setComorbidSearch] = useState("");
  const [comorbidOpen, setComorbidOpen] = useState(false);
  const comorbidRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!comorbidOpen) return;
    const handler = (e: MouseEvent) => {
      if (comorbidRef.current && !comorbidRef.current.contains(e.target as Node)) {
        setComorbidOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [comorbidOpen]);

  const [cohortSize, setCohortSize] = useState([5000]);
  const [ageRange, setAgeRange] = useState([18, 75]);
  const [bodyWeightRange, setBodyWeightRange] = useState([50, 120]);
  const [eGFRRange, setEGFRRange] = useState([30, 120]);
  const [altRange, setAltRange] = useState([0, 120]);
  const [lvefRange, setLvefRange] = useState([40, 70]);
  const [sexDistrib, setSexDistrib] = useState({ male: 50, female: 50 });
  const [cyp2d6, setCyp2d6] = useState(true);
  const [cyp3a4, setCyp3a4] = useState(true);
  const [cyp2c19, setCyp2c19] = useState(false);
  const [cyp2c9, setCyp2c9] = useState(false);
  const [startingDose, setStartingDose] = useState("100");
  const [doseUnit, setDoseUnit] = useState("mg");
  const [escalationScheme, setEscalationScheme] = useState("Modified Fibonacci");
  const [numDoseLevels, setNumDoseLevels] = useState(4);
  const [routeOfAdmin, setRouteOfAdmin] = useState("Oral");
  const [dosingFreq, setDosingFreq] = useState("QD");
  const [admetSource, setAdmetSource] = useState("From Layer 1");
  const [absorptionProb, setAbsorptionProb] = useState("0.82");
  const [distribVolume, setDistribVolume] = useState("3.4");
  const [halfLife, setHalfLife] = useState("14.2");
  const [renalClearance, setRenalClearance] = useState("120");

  // Layer 3 state
  const [trialPhase, setTrialPhase] = useState("Phase II");
  const [studyType, setStudyType] = useState("Randomized Controlled");
  const [numArms, setNumArms] = useState(2);
  const [randomizationRatio, setRandomizationRatio] = useState("1:1");
  const [blinding, setBlinding] = useState("Double-Blind");
  const [primaryEndpointType, setPrimaryEndpointType] = useState("Time-to-Event");
  const [primaryEndpointName, setPrimaryEndpointName] = useState("Progression-Free Survival");
  const [measurementType, setMeasurementType] = useState("Months");
  const [assessmentTimepoint, setAssessmentTimepoint] = useState("12");
  const [clinicalDiff, setClinicalDiff] = useState("2.5");
  const [targetSampleAuto, setTargetSampleAuto] = useState(true);
  const [targetSampleSize, setTargetSampleSize] = useState("240");
  const [numSites, setNumSites] = useState("20");
  const [geoRegions, setGeoRegions] = useState<string[]>(["North America"]);
  const [monteCarloReps, setMonteCarloReps] = useState([1000]);
  const [sigLevel, setSigLevel] = useState("0.05");
  const [powerTarget, setPowerTarget] = useState("0.80");
  const [dropoutModeling, setDropoutModeling] = useState(true);
  const [dropoutRate, setDropoutRate] = useState([15]);
  const [dropoutPattern, setDropoutPattern] = useState("Exponential");
  const [adaptiveEnabled, setAdaptiveEnabled] = useState(false);

  const [procovaEnabled, setProcovaEnabled] = useState(false);
  const [procovaOpen, setProcovaOpen] = useState(false);
  const [procovaVarReduction, setProcovaVarReduction] = useState([15]);
  const [procovaVarManual, setProcovaVarManual] = useState(false);
  const [procovaRatio, setProcovaRatio] = useState("2:1");
  const [procovaResults, setProcovaResults] = useState<ProcovaResults | null>(null);
  const [interimTiming, setInterimTiming] = useState("At 50% enrollment");
  const [futilityBoundary, setFutilityBoundary] = useState("O'Brien-Fleming");
  const [superiorityBoundary, setSuperiorityBoundary] = useState("O'Brien-Fleming");
  const [sampleSizeReest, setSampleSizeReest] = useState(false);
  const [responseAdaptiveRand, setResponseAdaptiveRand] = useState(false);
  const [criteriaRows, setCriteriaRows] = useState<CriteriaRow[]>([
    { id: "1", type: "Inclusion", category: "Demographics", operator: "range", value: "18–75 years" },
    { id: "2", type: "Inclusion", category: "Labs", operator: "greater than", value: "eGFR ≥ 30 mL/min" },
    { id: "3", type: "Exclusion", category: "Medical History", operator: "excludes", value: "Active CNS metastases" },
  ]);
  const [secondaryEndpoints, setSecondaryEndpoints] = useState<SecondaryEndpoint[]>([
    { id: "1", name: "Overall Survival", type: "Time-to-Event", timepoint: "24" },
  ]);
  const [matchingMethod, setMatchingMethod] = useState("Propensity Score Matching");
  const [matchingVariables, setMatchingVariables] = useState<string[]>(["Age", "Sex", "Disease Stage", "Comorbidity Index"]);
  const [balanceThreshold, setBalanceThreshold] = useState([0.10]);
  const [syntheticDataSources, setSyntheticDataSources] = useState<string[]>(["MIMIC-IV"]);

  const [simResults,    setSimResults]    = useState<SimResults | null>(null);
  const [inVitroResults, setInVitroResults] = useState<InVitroResults | null>(null);
  const [cohortResults, setCohortResults] = useState<CohortResults | null>(null);
  const [trialResults,  setTrialResults]  = useState<TrialResults | null>(null);

  // ── Cascade gate (L1 → L2) ───────────────────────────────────────────────
  // Auto-cascade is permitted only when:
  //   (a) compound is not NO-GO,
  //   (b) every safety-critical output meets minimum quality ≥ 0.6, and
  //   (c) average non-safety quality ≥ 0.6.
  // Otherwise the user sees a stage-gate banner and must explicitly override.
  // ── L1 ML predictions: fire on SMILES change so the stage-gate can flip
  // hepatotoxicity / absorption_admet badges from HEURISTIC → ML when the
  // ai-service returns a real prediction. Stale-request guards prevent an
  // older response from overwriting a newer one. Failures are surfaced as
  // null (the gate keeps the heuristic default — no silent upgrade).
  useEffect(() => {
    const sm = (smiles ?? "").trim();
    if (!sm || !rdkitReady || !molProps?.isValid) {
      setDiliMl(null);
      setAdmetMl(null);
      return;
    }
    const seqDili = ++diliMlSeqRef.current;
    const seqAdmet = ++admetMlSeqRef.current;
    predictDiliMl(sm)
      .then(r => { if (diliMlSeqRef.current === seqDili) setDiliMl(r); })
      .catch(() => { if (diliMlSeqRef.current === seqDili) setDiliMl(null); });
    predictAdmetMl(sm)
      .then(r => { if (admetMlSeqRef.current === seqAdmet) setAdmetMl(r); })
      .catch(() => { if (admetMlSeqRef.current === seqAdmet) setAdmetMl(null); });
  }, [smiles, rdkitReady, molProps?.isValid]);

  const cascadeGate = useMemo(
    () => {
      // Build ML overrides for the stage-gate. We only mark a row as `available`
      // when the ai-service genuinely returned an ML prediction (source === "ml"
      // AND the leaf field is non-null). A "fallback" response or null leaf must
      // NOT upgrade the tier — that would lie about data quality.
      const overrides: Parameters<typeof evaluateCascadeGate>[2] = {};
      if (diliMl && diliMl.source === "ml" && diliMl.prediction.risk_class !== null) {
        const auc = diliMl.model_info?.performance?.cv_roc_auc_mean;
        const cite = auc != null
          ? `DILIrank Chemprop+Morgan-RF (CV ROC-AUC ${auc.toFixed(2)})`
          : `DILIrank Chemprop+Morgan-RF`;
        overrides.hepatotoxicity = {
          available: true,
          note: `ML — ${cite}; risk_class=${diliMl.prediction.risk_class}`,
        };
      }
      if (admetMl && admetMl.source === "ml" && admetMl.ml_available) {
        const eng = admetMl.model_info?.engine ?? "Chemprop ADMET";
        overrides.absorption_admet = {
          available: true,
          note: `ML — ${eng}; Caco-2 + HIA + bioavailability heads`,
        };
      }
      if (bindingMl && bindingMl.source === "ml" && bindingMl.prediction.pKd_predicted !== null) {
        const tr = bindingMl.model_info?.training;
        const cite = tr
          ? `DeepDTA-GBM (BindingDB, n=${tr.n_train.toLocaleString()})`
          : `DeepDTA-GBM (BindingDB)`;
        overrides.binding_estimate = {
          available: true,
          note: `ML — ${cite}; pKd=${bindingMl.prediction.pKd_predicted.toFixed(2)}`,
        };
      }
      return evaluateCascadeGate(simResults, targetSuggestions, overrides);
    },
    [simResults, targetSuggestions, diliMl, admetMl, bindingMl],
  );
  const [cascadeOverride, setCascadeOverride] = useState<CascadeOverrideRecord | null>(null);
  // Inline override form state — replaces window.prompt() which is silently
  // blocked inside sandboxed preview iframes (returns null with no UI).
  const [overrideFormOpen, setOverrideFormOpen] = useState(false);
  const [overrideJustification, setOverrideJustification] = useState(
    "Reviewed manually; advancing to L2 with awareness of heuristic-only safety signals.",
  );
  // Reset override whenever the molecule or target evidence changes.
  useEffect(() => {
    setCascadeOverride(null);
    setOverrideFormOpen(false);
  }, [smiles, targetSuggestions.length]);

  useEffect(() => {
    if (!simResults) return;
    const tox = simResults.admet.toxicity;
    const abs = simResults.admet.absorption;
    const logP = simResults.lipinski.logP;
    const mw = simResults.lipinski.mw;
    const goNogo = simResults.goNogo;

    if (!l2ManualOverride.current.species) {
      if (tox > 0.6) setAnimalSpecies("dog_beagle");
      else if (therapeuticArea === "CNS") setAnimalSpecies("monkey_cyno");
      else setAnimalSpecies("rat_sd");
    }
    if (!l2ManualOverride.current.study) {
      if (goNogo === "NO-GO") setAnimalStudyType("single_dose");
      else if (goNogo === "WATCH") setAnimalStudyType("sub_acute_14d");
      else if (tox > 0.5) setAnimalStudyType("sub_acute_14d");
      else setAnimalStudyType("sub_chronic_28d");
    }
    if (!l2ManualOverride.current.route) {
      if (abs < 0.35 || logP < 0) setAnimalRoute("IV");
      else if (abs < 0.45) setAnimalRoute("SC");
      else setAnimalRoute("Oral");
    }
    if (!l2ManualOverride.current.formulation) {
      if (logP > 5) setAnimalFormulation("lipid");
      else if (mw > 500 && logP > 3) setAnimalFormulation("amorphous");
      else if (mw > 400 && logP > 2 && abs < 0.6) setAnimalFormulation("nanoparticle");
      else if (logP > 3 && abs < 0.55) setAnimalFormulation("cyclodextrin");
      else setAnimalFormulation("plain");
    }
    l2ManualOverride.current = { species: false, study: false, route: false, formulation: false };
    setL2AutoConfigured(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simResults]);

  const [haIOpsCtx, setHAIOpsCtx] = useState<HAIOpsContext>(createHAIOpsContext());
  const safetyFlags = haIOpsCtx.flags;
  const safetyOverrides = haIOpsCtx.overrides;
  const provenanceL1 = haIOpsCtx.provenance[1] ?? null;
  const provenanceL2 = haIOpsCtx.provenance[2] ?? null;
  const provenanceL3 = haIOpsCtx.provenance[3] ?? null;
  const provenanceL4 = haIOpsCtx.provenance[4] ?? null;
  const dbDegradationWarnings = getDbDegradationWarnings(haIOpsCtx);

  const [aiReport,   setAiReport]   = useState<AiReport | null>(null);
  const [aiLoading,  setAiLoading]  = useState(false);
  const [aiError,    setAiError]    = useState<string | null>(null);
  const [aiStream,   setAiStream]   = useState("");

  const [l1AiReport,  setL1AiReport]  = useState<Record<string, unknown> | null>(null);
  const [l1AiLoading, setL1AiLoading] = useState(false);
  const [l1AiError,   setL1AiError]   = useState<string | null>(null);
  const [l1AiStream,  setL1AiStream]  = useState("");

  const [l2AiReport,  setL2AiReport]  = useState<Record<string, unknown> | null>(null);
  const [l2AiLoading, setL2AiLoading] = useState(false);
  const [l2AiError,   setL2AiError]   = useState<string | null>(null);
  const [l2AiStream,  setL2AiStream]  = useState("");

  const [l3AiReport,  setL3AiReport]  = useState<Record<string, unknown> | null>(null);
  const [l3AiLoading, setL3AiLoading] = useState(false);
  const [l3AiError,   setL3AiError]   = useState<string | null>(null);
  const [l3AiStream,  setL3AiStream]  = useState("");

  const [fullAiOpen, setFullAiOpen] = useState(false);

  const [chatMessages,    setChatMessages]    = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [chatInput,       setChatInput]       = useState("");
  const [chatLoading,     setChatLoading]     = useState(false);

  useEffect(() => {
    if (!simResults || admetSource !== "From Layer 1") return;
    const { absorption, metabolism, excretion } = simResults.admet;
    const { logP, mw } = simResults.lipinski;
    setAbsorptionProb(absorption.toFixed(2));
    setDistribVolume(Math.max(0.3, Math.min(50, 0.5 + logP * 0.8 + mw / 300)).toFixed(1));
    setHalfLife(Math.max(0.5, Math.min(72, 0.693 / (metabolism * 0.4 + 0.05))).toFixed(1));
    setRenalClearance(String(Math.round(excretion * 120)));
  }, [simResults, admetSource]);

  const layerComplete = useCallback((layer: Layer) => {
    return simStatus[layer] === "complete";
  }, [simStatus]);

  const runAiAnalysis = useCallback(async () => {
    if (!simResults) return;
    setAiLoading(true);
    setAiError(null);
    setAiStream("");
    setAiReport(null);
    setChatMessages([]);
    setChatInput("");

    try {
      // Sample pkCurve to ~15 evenly-spaced points to keep prompt lean
      let pkCurveSampled: Array<{ time: number; conc: number }> | undefined;
      if (cohortResults?.pkCurve && cohortResults.pkCurve.length > 0) {
        const curve = cohortResults.pkCurve;
        const step  = Math.max(1, Math.floor(curve.length / 15));
        pkCurveSampled = curve
          .filter((_, i) => i % step === 0)
          .map(p => ({ time: p.time, conc: +p.conc.toFixed(2) }));
      }

      const res = await fetch("/api/bio-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          molName:        simResults.molName,
          smiles:         simResults.smiles,
          indication,
          layer1:         simResults,
          layer2:         cohortResults,
          layer3:         trialResults,
          proteinInfo,
          pkCurve:        pkCurveSampled,
          adverseEvents:  cohortResults?.adverseEvents,
          interimAnalyses: trialResults?.interimAnalyses,
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let   buf     = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const json = JSON.parse(part.slice(6)) as { chunk?: string; done?: boolean; full?: string; error?: string };
          if (json.error) throw new Error(json.error);
          if (json.chunk) setAiStream(prev => prev + json.chunk);
          if (json.done && json.full) {
            const raw = json.full.trim();
            const match = raw.match(/\{[\s\S]*\}/);
            if (match) {
              try { setAiReport(JSON.parse(match[0])); } catch { /* keep streaming text */ }
            }
          }
        }
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAiLoading(false);
    }
  }, [simResults, cohortResults, trialResults, indication, proteinInfo]);

  const streamAiLayer = useCallback(async (opts: {
    focus: string;
    body: object;
    setLoading: (v: boolean) => void;
    setError: (v: string | null) => void;
    setStream: (v: string | ((prev: string) => string)) => void;
    setReport: (v: Record<string, unknown> | null) => void;
  }) => {
    opts.setLoading(true);
    opts.setError(null);
    opts.setStream("");
    opts.setReport(null);
    try {
      const res = await fetch("/api/bio-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...opts.body, focus: opts.focus }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const json = JSON.parse(part.slice(6)) as { chunk?: string; done?: boolean; full?: string; error?: string };
          if (json.error) throw new Error(json.error);
          if (json.chunk) opts.setStream(prev => prev + json.chunk);
          if (json.done && json.full) {
            const match = json.full.trim().match(/\{[\s\S]*\}/);
            if (match) { try { opts.setReport(JSON.parse(match[0])); } catch { /* ignore */ } }
          }
        }
      }
    } catch (err) {
      opts.setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      opts.setLoading(false);
    }
  }, []);

  const runL1AiAnalysis = useCallback(() => {
    if (!simResults) return;
    streamAiLayer({
      focus: "in-vitro",
      body: { molName: simResults.molName, smiles: simResults.smiles, indication, layer1: simResults, proteinInfo },
      setLoading: setL1AiLoading,
      setError:   setL1AiError,
      setStream:  setL1AiStream,
      setReport:  setL1AiReport,
    });
  }, [simResults, indication, proteinInfo, streamAiLayer]);

  const runL2AiAnalysis = useCallback(() => {
    if (!simResults || !cohortResults) return;
    let pkCurveSampled: Array<{ time: number; conc: number }> | undefined;
    if (cohortResults.pkCurve?.length) {
      const curve = cohortResults.pkCurve;
      const step  = Math.max(1, Math.floor(curve.length / 15));
      pkCurveSampled = curve.filter((_, i) => i % step === 0).map(p => ({ time: p.time, conc: +p.conc.toFixed(2) }));
    }
    streamAiLayer({
      focus: "clinical",
      body: { molName: simResults.molName, smiles: simResults.smiles, indication, layer1: simResults, layer2: cohortResults, proteinInfo, pkCurve: pkCurveSampled, adverseEvents: cohortResults.adverseEvents },
      setLoading: setL2AiLoading,
      setError:   setL2AiError,
      setStream:  setL2AiStream,
      setReport:  setL2AiReport,
    });
  }, [simResults, cohortResults, indication, proteinInfo, streamAiLayer]);

  const runL3AiAnalysis = useCallback(() => {
    if (!simResults || !trialResults) return;
    streamAiLayer({
      focus: "trial",
      body: { molName: simResults.molName, smiles: simResults.smiles, indication, layer1: simResults, layer2: cohortResults, layer3: trialResults, proteinInfo, interimAnalyses: trialResults.interimAnalyses },
      setLoading: setL3AiLoading,
      setError:   setL3AiError,
      setStream:  setL3AiStream,
      setReport:  setL3AiReport,
    });
  }, [simResults, cohortResults, trialResults, indication, proteinInfo, streamAiLayer]);

  const sendChatMessage = useCallback(async (question: string) => {
    if (!aiReport || !question.trim() || chatLoading) return;
    const userMsg = { role: "user" as const, content: question };
    const history = [...chatMessages, userMsg];
    setChatMessages(history);
    setChatInput("");
    setChatLoading(true);
    const placeholderIdx = history.length;
    setChatMessages(prev => [...prev, { role: "assistant" as const, content: "" }]);
    try {
      const res = await fetch("/api/bio-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context:    aiReport,
          messages:   history,
          molName:    simResults?.molName,
          indication,
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let   buf     = "";
      let   text    = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const json = JSON.parse(part.slice(6)) as { chunk?: string; done?: boolean; error?: string };
          if (json.error) throw new Error(json.error);
          if (json.chunk) {
            text += json.chunk;
            setChatMessages(prev => {
              const updated = [...prev];
              updated[placeholderIdx] = { role: "assistant", content: text };
              return updated;
            });
          }
        }
      }
    } catch (err) {
      setChatMessages(prev => {
        const updated = [...prev];
        updated[placeholderIdx] = { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Chat failed"}` };
        return updated;
      });
    } finally {
      setChatLoading(false);
    }
  }, [aiReport, chatMessages, chatLoading, simResults?.molName, indication]);

  const loadSavedProject = useCallback((proj: typeof savedProjects[number]) => {
    setSmiles(proj.smiles);
    setMolName(proj.molName);
    setUniprotId(proj.uniprotId);
    setIndication(proj.indicationCode);
    setSimResults(null);
    setInVitroResults(null);
    setAnimalResults(null);
    setCohortResults(null);
    setTrialResults(null);
    setExtBindingDB(null); setExtChEMBL(null); setExtToxCast(null); setExtClinTrials(null);
    setExtOpenTargets(null); setExtString(null); setExtKEGG(null);
    setExtReactome(null); setExtPharmGKB(null); setExtDisGeNET(null);
    setExtGnomAD(null); setExtEcotox(null);
    setSimStatus({ 1: "idle", 2: "idle", 3: "idle", 4: "idle" });
    setSimProgress(0);
    setHAIOpsCtx(createHAIOpsContext());
    setActiveLayer(1);
    setAiReport(null);
    setAiError(null);
    setAiStream("");
    setChatMessages([]);
    setChatInput("");
    setChatLoading(false);
  }, [savedProjects]);

  const runSimulation = useCallback(async () => {
    if (!molProps?.isValid) return;

    setSidebarOpen(false);
    setSimStatus(prev => ({ ...prev, [activeLayer]: "running" }));
    setSimProgress(0);

    // Tick budgets per layer — L2 In Silico and L3 Ex Vivo are scaffolds in
    // this build (no Run handler), so 0 ticks. L4 Animal Cohort uses the same
    // 16-tick budget the relocated runner inherited from former internal slot 2.
    const steps = activeLayer === 1 ? (fingerprintOn ? 28 : 18) : activeLayer === 3 ? 16 : 0;
    let tick = 0;

    // ── Layer 3 (was 4): Animal Cohort ────────────────────────────────────────
    // Relocated from former internal slot 2 per April 2026 4-layer redesign.
    // Then moved from slot 4 → slot 3 in the May 2026 restructure (slot 4 is
    // now First In Human handover). Simulation logic is unchanged; only the
    // slot index moved. All `4` literals in flag/provenance writes below are
    // remapped to `3` to match the new slot.
    if (activeLayer === 3) {
      const layer1 = simResults ?? runAdmetSimulation(molProps, smiles, molName || "Unnamed Molecule", uniprotId, therapeuticArea);
      const seedStr = layer1.smiles + animalSpecies + animalStudyType;
      let seedH = 0;
      for (let i = 0; i < seedStr.length; i++) seedH = (seedH * 31 + seedStr.charCodeAt(i)) >>> 0;
      const interval2 = setInterval(() => {
        tick++;
        setSimProgress(Math.min(99, (tick / steps) * 100));
        if (tick >= steps) {
          clearInterval(interval2);
          const results = runAnimalCohortSimulation(layer1, animalSpecies, animalStudyType, animalRoute, animalFormulation, seedH);
          setAnimalResults(results);
          // computeLayer2Flags is named for the legacy slot index; under the
          // 4-layer redesign, animal flags now live at L4. We remap each flag's
          // originLayer from 2 → 4 client-side so safetyFlags.ts stays untouched.
          const l4FlagsRaw = computeLayer2Flags({ safetyMargin: results.safetyMarginNoael, noael: results.noael, hedConservative: results.hedBsa });
          const l4Flags = l4FlagsRaw.map(f => ({ ...f, originLayer: 4 }));
          // Provenance is initialised as pending; the enrichment block below
          // overwrites each entry with the real fetch outcome before merging.
          const prov4 = createProvenance("animalSim.ts", "browser", smiles);
          prov4.databaseQueries = [
            { database: "CompTox", status: "skipped" },
            { database: "ECOTOX", status: "skipped" },
            { database: "ToxRefDB", status: "skipped" },
            { database: "ChEMBL animal-PK", status: "skipped" },
          ];
          setHAIOpsCtx(prev => mergeLayerProvenance(mergeLayerFlags(prev, 3, l4Flags), 3, prov4));

          // ── Full L2 → L3 cascade ──────────────────────────────────────
          // Starting dose: FIH mg/kg (conservative 1/10 HED)
          setStartingDose(results.fihDoseMgKg.toFixed(3));
          setDoseUnit("mg/kg");

          // Human projected half-life drives dosing frequency
          const t12 = results.humanHalfLife;
          setHalfLife(t12.toFixed(1));
          setDosingFreq(t12 < 8 ? "BID" : t12 < 20 ? "QD" : "QD");

          // Route of admin: map animal route to human equivalent
          const routeMap: Record<string, string> = {
            "Oral": "Oral", "IV": "IV Bolus", "SC": "Subcutaneous",
            "IM": "Intramuscular", "Topical": "Transdermal", "Inhalation": "Oral",
          };
          setRouteOfAdmin(routeMap[results.routeOfAdmin] ?? "Oral");

          // Formulation-adjusted oral bioavailability → absorption probability
          setAbsorptionProb(Math.min(0.99, results.formulationResult.formulatedF).toFixed(2));

          // Compute human PK from allometric projection:
          // CL (L/h) = FIH_dose_mg × 1000 / humanAUC_ng·h/mL  (units: L/h for 70 kg)
          // Vd (L/kg) = CL × t½ / (ln2 × BW)
          const humanCL_Lh = (results.fihDose * 1000) / Math.max(1, results.humanAuc);
          const humanVd_Lkg = (humanCL_Lh * t12) / (0.693 * 70);
          setDistribVolume(Math.max(0.3, Math.min(50, humanVd_Lkg)).toFixed(1));

          // Renal clearance: total CL × renal fraction (from L1 excretion score if available)
          const renalFrac = simResults
            ? Math.min(0.9, Math.max(0.1, simResults.admet.excretion))
            : 0.35;
          setRenalClearance(String(Math.round((humanCL_Lh * 1000 / 60) * renalFrac)));

          // Disease severity: mirror animal overall risk level
          setSeverity(results.overallRisk === "high" ? "Severe" : results.overallRisk === "low" ? "Mild" : "Moderate");
          // ─────────────────────────────────────────────────────────────

          setSimProgress(100);
          setSimStatus(prev => ({ ...prev, 3: "complete" }));
          // ── Layer 4 external DB enrichment + validation ─────────────────
          setExtDbLoading(true);
          setExtToxRef(null); setExtAnimalPk(null); setLayer2Confidence(null);
          Promise.allSettled([
            fetchCompTox(smiles),
            fetchEcotox("", layer1.molName),
            fetchToxRef({ name: layer1.molName, inchiKey: undefined }),
            fetchChemblAnimalPk(smiles),
          ]).then(([toxSettled, ecotoxSettled, toxRefSettled, animalPkSettled]) => {
            const tox = toxSettled.status === "fulfilled" ? toxSettled.value : null;
            const eco = ecotoxSettled.status === "fulfilled" ? ecotoxSettled.value : null;
            const tref = toxRefSettled.status === "fulfilled" ? toxRefSettled.value : null;
            const apk = animalPkSettled.status === "fulfilled" ? animalPkSettled.value : null;
            if (tox) setExtToxCast(tox);
            if (eco) setExtEcotox(eco);
            if (tref) setExtToxRef(tref);
            if (apk) setExtAnimalPk(apk);

            // Real provenance — reflect actual fetch outcomes
            const provReal = createProvenance("animalSim.ts", "browser", smiles);
            provReal.databaseQueries = [
              { database: "CompTox", status: tox?.status === "live" ? "success" : "failed" },
              { database: "ECOTOX", status: eco && eco.studies.length > 0 ? "success" : "failed" },
              { database: "ToxRefDB", status: tref?.status === "live" ? "success" : tref?.status === "no-data" ? "failed" : "failed" },
              { database: "ChEMBL animal-PK", status: apk?.status === "live" ? "success" : "failed" },
            ];
            // Animal sim provenance lives at L4 under the redesigned 4-layer architecture.
            setHAIOpsCtx(prev => mergeLayerProvenance(prev, 3, provReal));

            // Per-layer confidence from validation against measured ground truth
            const noaelV = tref ? validateNoaelPrediction(results.noael, tref) : { confidence: 0, foldError: null, measuredNoael: null };
            const aucV = apk ? validateAucPrediction(results.humanAuc, apk) : { confidence: 0, foldError: null, measuredAuc: null, species: null };
            const validators = [noaelV.confidence, aucV.confidence].filter(c => c > 0);
            const overall = validators.length > 0 ? validators.reduce((a, b) => a + b, 0) / validators.length : 0;
            // setLayer2Confidence retains its legacy name; it now stores L4
            // (Animal Cohort) confidence under the redesigned 4-layer architecture.
            setLayer2Confidence({
              overall,
              noaelFold: noaelV.foldError,
              aucFold: aucV.foldError,
              species: aucV.species,
            });
            setExtDbLoading(false);
          });
        }
      }, 200);
      return;
    }

    // ── Layer 3: Patient Cohort (async — real FAERS + PD fetch) ───────────────
    // PRESERVED AS DEAD CODE per April 2026 4-layer redesign. Patient Cohort
    // is no longer in the pre-clinical scope; it belongs to Hakase Clinical
    // and will be reached via the L4→Clinical API contract. The runner stays
    // here as living documentation but is gated unreachable. The new L3 slot
    // is Ex Vivo (a scaffold panel — see render dispatch below).
    // (HIDE_PATIENT_TRIAL_LAYERS=true keeps this dead — slot 3 is now Animal.)
    if (!HIDE_PATIENT_TRIAL_LAYERS && false && activeLayer === 3) {
      const layer1 = simResults ?? runAdmetSimulation(molProps, smiles, molName || "Unnamed Molecule", uniprotId, therapeuticArea);
      const seedStr = layer1.smiles + String(cohortSize[0]);
      let seedH = 0;
      for (let i = 0; i < seedStr.length; i++) seedH = (seedH * 31 + seedStr.charCodeAt(i)) >>> 0;

      const fetchPromise = Promise.allSettled([
        toxOn ? fetchFAERSSignals(layer1.similarDrugs[0] ?? layer1.molName) : Promise.resolve(undefined),
        fetchPDParameters(layer1.similarDrugs, layer1.lipinski.mw, seedH),
      ]);

      await new Promise<void>(resolve => {
        const iv = setInterval(() => {
          tick++;
          setSimProgress(Math.min(95, (tick / steps) * 100));
          if (tick >= steps) { clearInterval(iv); resolve(); }
        }, 180);
      });

      const [faersSettled, pdSettled] = await fetchPromise;
      const faersResult = faersSettled.status === "fulfilled" ? faersSettled.value : undefined;
      const pdParams    = pdSettled.status === "fulfilled"    ? pdSettled.value    : undefined;

      const l2pk: L2PkOverrides | undefined = animalResults ? {
        bioavailF:       animalResults.formulationResult.formulatedF,
        humanHalfLifeHr: animalResults.humanHalfLife,
        humanCmaxNgMl:   animalResults.humanCmax,
        humanAucNgHMl:   animalResults.humanAuc,
      } : undefined;

      const results = runCohortSimulation(
        layer1, cohortSize[0], Number(startingDose) || 100,
        routeOfAdmin, dosingFreq, [ageRange[0], ageRange[1]], severity,
        pdParams, faersResult, l2pk,
      );
      setCohortResults(results);
      const l3Flags = computeLayer3Flags({
        grade3PlusRate: results.grade3AERate,
        subgroupBreakdown: results.subgroupBreakdown,
        overallAeRate: results.adverseEvents.reduce((s, e) => s + e.anyGrade, 0) / Math.max(1, results.adverseEvents.length) / 100,
      });
      const prov3 = createProvenance("cohortSim.ts", "browser", smiles);
      prov3.databaseQueries = [
        { database: "NHANES", status: "success" },
        { database: "FAERS", status: faersSettled.status === "fulfilled" ? "success" : "failed", staleness: faersSettled.status !== "fulfilled" ? "API unavailable — used cached reference data" : undefined },
        { database: "SIDER", status: "success" },
      ];
      setHAIOpsCtx(prev => mergeLayerProvenance(mergeLayerFlags(prev, 3, l3Flags), 3, prov3));
      setSimProgress(100);
      setSimStatus(prev => ({ ...prev, 3: "complete" }));
      // ── Layer 3 external DB enrichment ──────────────────────────────────
      const gene3 = proteinInfo?.gene ?? "";
      const indicationClean = indication.replace(/[A-Z][0-9]+\.?[0-9]*\s*[–-]\s*/i, "").trim();
      setExtDbLoading(true);
      Promise.allSettled([
        searchClinicalTrials(indicationClean, layer1.molName),
        gene3 ? fetchPharmGKB(gene3) : Promise.resolve(null),
        gene3 ? fetchDisGeNET(gene3) : Promise.resolve(null),
        gene3 ? fetchGnomAD(gene3) : Promise.resolve(null),
      ]).then(([ct, pgkb, dgn, gad]) => {
        if (ct.status   === "fulfilled" && ct.value)   setExtClinTrials(ct.value);
        if (pgkb.status === "fulfilled" && pgkb.value) setExtPharmGKB(pgkb.value);
        if (dgn.status  === "fulfilled" && dgn.value)  setExtDisGeNET(dgn.value);
        if (gad.status  === "fulfilled" && gad.value)  setExtGnomAD(gad.value);
        setExtDbLoading(false);
      });
      return;
    }

    // ── Layer 1 / Layer 4: synchronous flow ──────────────────────────────────
    const interval = setInterval(() => {
      tick++;
      setSimProgress(Math.min(99, (tick / steps) * 100));
      if (tick >= steps) {
        clearInterval(interval);

        if (activeLayer === 1) {
          const results = runAdmetSimulation(molProps, smiles, molName || "Unnamed Molecule", uniprotId, therapeuticArea);

          if (fingerprintOn && tissueTypes.length > 0) {
            const tissueOrganMap: Record<string, string> = {
              "Liver": "Liver", "Kidney": "Kidney", "CNS": "CNS",
              "Cardiac": "Heart (hERG)", "GI": "GI Tract", "Lung": "Lung",
            };
            for (const organ of results.organs) {
              const matchedTissue = tissueTypes.find(t => tissueOrganMap[t] === organ.name);
              if (matchedTissue) {
                organ.risk = Math.min(1, organ.risk * 1.25);
                organ.color = organ.risk > 0.3 ? "red" : organ.risk > 0.15 ? "yellow" : "emerald";
                if (!organ.alerts.includes("Behavioral fingerprint: enhanced surveillance")) {
                  organ.alerts.push("Behavioral fingerprint: enhanced surveillance");
                }
              }
            }
          }

          setSimResults(results);
          const ivResults = runInVitroSimulation(molProps, smiles, uniprotId, therapeuticArea);
          setInVitroResults(ivResults);
          const l1Flags = computeLayer1Flags(ivResults);
          const prov1 = createProvenance("inVitroSim.ts", "browser", smiles);
          prov1.databaseQueries = [
            { database: "RDKit.js", status: "success", version: "2024.03.5", resultCount: 1 },
            { database: "BindingDB", status: bindingOn ? "success" : "skipped" },
            { database: "OpenTargets", status: "success" },
            ...(fingerprintOn ? [{ database: "BehavioralFingerprint", status: "success" as const, resultCount: tissueTypes.length }] : []),
          ];
          setHAIOpsCtx(prev => mergeLayerProvenance(mergeLayerFlags(prev, 1, l1Flags), 1, prov1));
          // ── Layer 1 external DB enrichment ──────────────────────────────
          const gene = proteinInfo?.gene ?? "";
          const target = gene || uniprotId;
          if (target) {
            setExtDbLoading(true);
            Promise.allSettled([
              (bindingOn && uniprotId) ? fetchBindingDB(uniprotId) : Promise.resolve(null),
              gene ? fetchStringInteractions(gene) : Promise.resolve(null),
              gene ? fetchKEGGPathways(gene) : Promise.resolve(null),
              uniprotId ? fetchReactomePathways(uniprotId) : Promise.resolve(null),
              fetchOpenTargets(target),
              smiles ? fetchChEMBLMultiTarget(smiles) : Promise.resolve(null),
            ]).then(([bdb, str, kegg, react, ot, chembl]) => {
              if (bdb.status    === "fulfilled" && bdb.value)   setExtBindingDB(bdb.value);
              if (str.status    === "fulfilled" && str.value)   setExtString(str.value);
              if (kegg.status   === "fulfilled" && kegg.value)  setExtKEGG(kegg.value);
              if (react.status  === "fulfilled" && react.value) setExtReactome(react.value);
              if (ot.status     === "fulfilled" && ot.value)    setExtOpenTargets(ot.value);
              if (chembl.status === "fulfilled" && chembl.value) setExtChEMBL(chembl.value);
              setExtDbLoading(false);
            });
          }
        } else if (!HIDE_PATIENT_TRIAL_LAYERS) {
          // Layer 4: Trial — PRESERVED AS DEAD CODE per April 2026 4-layer
          // redesign. Trial design moved out of pre-clinical scope into
          // Hakase Clinical. The new L4 slot is Animal Cohort (handled by
          // the relocated runner above at `if (activeLayer === 4)`).
          const layer1 = simResults ?? runAdmetSimulation(molProps, smiles, molName || "Unnamed Molecule", uniprotId, therapeuticArea);
          const l2pkFallback: L2PkOverrides | undefined = animalResults ? {
            bioavailF:       animalResults.formulationResult.formulatedF,
            humanHalfLifeHr: animalResults.humanHalfLife,
            humanCmaxNgMl:   animalResults.humanCmax,
            humanAucNgHMl:   animalResults.humanAuc,
          } : undefined;
          const layer3 = cohortResults ?? runCohortSimulation(
            layer1, cohortSize[0], Number(startingDose) || 100,
            routeOfAdmin, dosingFreq, [ageRange[0], ageRange[1]], severity,
            undefined, undefined, l2pkFallback,
          );
          const results = runTrialSimulation(
            layer1, layer3, trialPhase, primaryEndpointName,
            Number(clinicalDiff) || 2.5, Number(targetSampleSize) || 240,
            Number(sigLevel) || 0.05, Number(powerTarget) || 0.80,
            (dropoutRate[0] ?? 15) / 100, numArms, adaptiveEnabled,
            Number(numSites) || 20, indication,
          );
          setTrialResults(results);

          if (procovaEnabled) {
            const vrLookup = lookupVarianceReduction(indication, primaryEndpointType);
            const vrValue = procovaVarManual ? procovaVarReduction[0] / 100 : vrLookup.defaultR;
            const pConfig: ProcovaConfig = {
              enabled: true,
              varianceReduction: vrValue,
              randomizationRatio: procovaRatio,
            };
            const pResults = runProcovaAnalysis(
              results, pConfig, indication, primaryEndpointType, trialPhase,
              Number(numSites) || 20, (dropoutRate[0] ?? 15) / 100,
              Number(powerTarget) || 0.80, Number(sigLevel) || 0.05,
            );
            setProcovaResults(pResults);
          } else {
            setProcovaResults(null);
          }

          const prov4 = createProvenance("trialSim.ts", "browser", smiles);
          prov4.databaseQueries = [
            { database: "ClinicalTrials.gov", status: "success" },
            { database: "Drugs@FDA", status: "success" },
          ];
          setHAIOpsCtx(prev => mergeLayerProvenance(prev, 4, prov4));
        }

        setSimProgress(100);
        setSimStatus(prev => ({ ...prev, [activeLayer]: "complete" }));
      }
    }, 180);
  }, [activeLayer, molProps, smiles, molName, uniprotId, simResults, animalResults, cohortResults,
      animalSpecies, animalStudyType, animalRoute, animalFormulation,
      proteinInfo, indication, therapeuticArea,
      cohortSize, startingDose, routeOfAdmin, dosingFreq, ageRange, severity,
      trialPhase, primaryEndpointName, clinicalDiff, targetSampleSize, sigLevel,
      powerTarget, dropoutRate, numArms, adaptiveEnabled,
      bindingOn, toxOn, fingerprintOn, tissueTypes,
      procovaEnabled, procovaVarManual, procovaVarReduction, procovaRatio, primaryEndpointType]);

  const handleDiagenFetch = useCallback(() => {
    if (!diagenJobId.trim()) return;
    setDiagenLoading(true);
    setDiagenResult(null);
    const mockDb: Record<string, {
      name: string; smiles: string; mw: string; uniprotId: string; targetName: string;
      admet: { absorption: number; distribution: number; metabolism: number; excretion: number; toxicity: number };
      qed: number; sa: number; bindingAffinity: string;
    }> = {
      "dgn-mol-0047": {
        name: "HAK-EGFR-047", smiles: "CN(C)CCNc1nc(Nc2cccc(c2)C(F)(F)F)c3cc(OC)c(NC(=O)/C=C/CN(C)C)cc3n1",
        mw: "499.6 Da", uniprotId: "P00533", targetName: "EGFR · Epidermal growth factor receptor",
        admet: { absorption: 0.84, distribution: 0.71, metabolism: 0.76, excretion: 0.69, toxicity: 0.91 },
        qed: 0.78, sa: 2.6, bindingAffinity: "9.8 nM",
      },
      "dgn-mol-0112": {
        name: "HAK-KRAS-112", smiles: "CC1(C)CCC(=C1)c1cc(NC(=O)c2ccc(F)cc2)c2ncc(-c3ccncc3)cc2n1",
        mw: "441.5 Da", uniprotId: "P01116", targetName: "KRAS · GTPase KRas",
        admet: { absorption: 0.77, distribution: 0.65, metabolism: 0.82, excretion: 0.73, toxicity: 0.85 },
        qed: 0.74, sa: 3.1, bindingAffinity: "14.2 nM",
      },
      "dgn-mol-0231": {
        name: "HAK-CDK4-231", smiles: "C1CN(C(=O)c2cc3cc(NC(=O)c4ccc(F)cn4)ccc3[nH]2)CCC1N",
        mw: "393.4 Da", uniprotId: "P11802", targetName: "CDK4 · Cyclin-dependent kinase 4",
        admet: { absorption: 0.91, distribution: 0.74, metabolism: 0.68, excretion: 0.77, toxicity: 0.93 },
        qed: 0.81, sa: 2.3, bindingAffinity: "6.1 nM",
      },
      "dgn-batch-2024-q1": {
        name: "HAK-BTK-Batch-Top1", smiles: "CC(C)(Cc1ccc2c(c1)cc(NC(=O)/C=C/CN(C)C)n2-c1ccc(cc1)NC(=O)c1ccc(F)cc1)O",
        mw: "517.6 Da", uniprotId: "Q06187", targetName: "BTK · Tyrosine-protein kinase BTK",
        admet: { absorption: 0.79, distribution: 0.66, metabolism: 0.71, excretion: 0.74, toxicity: 0.88 },
        qed: 0.69, sa: 3.4, bindingAffinity: "11.7 nM",
      },
    };
    const delay = diagenMode === "cascade" ? 2200 : diagenMode === "batch" ? 1600 : 900;
    setTimeout(() => {
      const hit = mockDb[diagenJobId.toLowerCase().trim()];
      setDiagenResult(hit ?? {
        name: `HAK-MOL-${diagenJobId.toUpperCase()}`, smiles: "CC(C)Cc1ccc(cc1)C(C)C(=O)O",
        mw: "206.3 Da", uniprotId: "P00533", targetName: "EGFR · Epidermal growth factor receptor",
        admet: { absorption: 0.82, distribution: 0.68, metabolism: 0.74, excretion: 0.71, toxicity: 0.88 },
        qed: 0.72, sa: 2.8, bindingAffinity: "12.4 nM",
      });
      setDiagenLoading(false);
    }, delay);
  }, [diagenJobId, diagenMode]);

  const handleProjFetch = useCallback(async () => {
    const id = projImportId.trim();
    if (!id) return;
    setProjImportLoading(true);
    setProjImportResult(null);

    function ctgParsePhase(phases: string[] | string | null | undefined): string {
      if (!phases) return "Unknown";
      const arr = Array.isArray(phases) ? phases : [phases];
      const p = arr[0] ?? "";
      return p.replace(/^PHASE_?/i, "Phase ").replace(/_/g, " ").trim() || "Unknown";
    }

    try {
      if (projImportSource === "clinicaltrials") {
        // ── ClinicalTrials.gov v2 API — fetch by NCT ID ──────────────────────
        const nctId = id.toUpperCase().replace(/\s/g, "");
        const res = await fetch(
          `https://clinicaltrials.gov/api/v2/studies/${nctId}?format=json`,
        );
        if (!res.ok) throw new Error(`Study ${nctId} not found on ClinicalTrials.gov (${res.status})`);
        const data = await res.json();
        const ps = data.protocolSection ?? {};
        const id_mod   = ps.identificationModule ?? {};
        const cond_mod = ps.conditionsModule ?? {};
        const des_mod  = ps.designModule ?? {};
        const spon_mod = ps.sponsorCollaboratorsModule ?? {};
        setProjImportResult({
          name:       id_mod.briefTitle ?? nctId,
          indication: (cond_mod.conditions ?? [])[0] ?? "Unknown",
          phase:      ctgParsePhase(des_mod.phases),
          sponsor:    spon_mod.leadSponsor?.name ?? "Unknown",
          enrollment: des_mod.enrollmentInfo?.count ?? null,
          nctId,
        });

      } else if (projImportSource === "pubmed") {
        // ── NCBI E-utilities — fetch PubMed article by PMID ─────────────────
        const pmid = id.replace(/\D/g, "");
        if (!pmid) throw new Error("Enter a valid PubMed ID (numbers only)");
        const res = await fetch(
          `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`,
        );
        if (!res.ok) throw new Error(`PubMed: failed to fetch PMID ${pmid} (${res.status})`);
        const data = await res.json();
        const article = (data.result ?? {})[pmid] as Record<string, any> | undefined;
        if (!article || article.error) throw new Error(`PubMed: article ${pmid} not found`);
        const firstAuthor = (article.authors as any[])?.[0]?.name ?? "Unknown";
        setProjImportResult({
          name:       article.title ?? `PubMed PMID ${pmid}`,
          indication: article.source ?? "Journal Article",
          phase:      "Literature",
          sponsor:    `${firstAuthor} · ${article.source ?? ""}`,
          abstract:   article.sortpubdate ?? undefined,
        });

      } else if (projImportSource === "ehr") {
        // EHR/Epic — simulated (requires institutional OAuth integration)
        await new Promise(r => setTimeout(r, 600));
        const mock: Record<string, { name: string; indication: string; phase: string; sponsor: string; enrollment: number }> = {
          "pat-001":   { name: "EGFR-T790M Cohort",      indication: "Non-small-cell lung carcinoma", phase: "Real-World Evidence", sponsor: "Internal EHR",  enrollment: 142 },
          "pat-002":   { name: "HER2+ Breast Cohort",    indication: "Breast Cancer (HER2+)",         phase: "Real-World Evidence", sponsor: "Internal EHR",  enrollment: 87 },
          "study-007": { name: "GI Toxicity Assessment", indication: "Colorectal Cancer",             phase: "Observational",       sponsor: "Site LIMS",     enrollment: 63 },
        };
        const hit = mock[id.toLowerCase()];
        setProjImportResult(hit ?? { name: `EHR Study ${id.toUpperCase()}`, indication: "Oncology", phase: "Real-World Evidence", sponsor: "EHR Import" });

      } else {
        // LIMS — simulated (requires institutional API key)
        await new Promise(r => setTimeout(r, 600));
        const mock: Record<string, { name: string; indication: string; phase: string; sponsor: string; enrollment: number }> = {
          "lims-2024-001": { name: "Compound Library Screen A", indication: "Oncology",         phase: "Pre-clinical", sponsor: "Internal R&D",  enrollment: 0 },
          "lims-2024-012": { name: "ADMET Panel Q1-2024",       indication: "Multiple targets", phase: "Pre-clinical", sponsor: "DMPK Dept.",    enrollment: 0 },
        };
        const hit = mock[id.toLowerCase()];
        setProjImportResult(hit ?? { name: `LIMS Study ${id.toUpperCase()}`, indication: "Drug Discovery", phase: "Pre-clinical", sponsor: "Internal R&D" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed — check the ID and try again.";
      setProjImportResult({ name: "Import Error", indication: msg, phase: "—", sponsor: "—" });
    } finally {
      setProjImportLoading(false);
    }
  }, [projImportSource, projImportId]);

  const handleApiFetch = useCallback(async () => {
    if (!apiCompoundId.trim()) return;
    setApiLoading(true);
    setApiResult(null);
    setApiError(null);
    try {
      const compound = await fetchCompoundFromApi(apiSource, apiCompoundId.trim());
      setApiResult({ name: compound.name, smiles: compound.smiles, mw: compound.mw, sourceId: compound.sourceId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Fetch failed. Check your compound ID and try again.";
      setApiError(msg);
    } finally {
      setApiLoading(false);
    }
  }, [apiSource, apiCompoundId]);

  const handleNewProject = useCallback(() => {
    // Allow molecule → target auto-sync again
    uniprotManual.current = false;
    molNameManual.current = false;
    setUniprotAutoMode(true);
    setChemblCompoundName(null);
    setChemblCompoundId(null);
    // Reset molecule / compound
    setSmiles("CC(C)Cc1ccc(cc1)C(C)C(=O)O");
    setActivatedSmiles("CC(C)Cc1ccc(cc1)C(C)C(=O)O");
    setMolName("New-Compound-001");
    setUniprotId("P00533");
    setPdbId("4HJO");
    setProteinInfo(null);
    setPdbStructure(null);
    // Reset all simulation results
    setSimResults(null);
    setInVitroResults(null);
    setAnimalResults(null);
    setCohortResults(null);
    setTrialResults(null);
    setProcovaResults(null);
    setExtBindingDB(null); setExtChEMBL(null); setExtToxCast(null); setExtClinTrials(null);
    setExtOpenTargets(null); setExtString(null); setExtKEGG(null);
    setExtReactome(null); setExtPharmGKB(null); setExtDisGeNET(null);
    setExtGnomAD(null); setExtEcotox(null);
    setSimStatus({ 1: "idle", 2: "idle", 3: "idle", 4: "idle" });
    setSimProgress(0);
    setHAIOpsCtx(createHAIOpsContext());
    // Reset to Layer 1 so the user starts from the beginning
    setActiveLayer(1);
  }, []);

  const toggleTissue = (tissue: string) => {
    setTissueTypes(prev =>
      prev.includes(tissue) ? prev.filter(t => t !== tissue) : [...prev, tissue]
    );
  };

  const toggleRegion = (region: string) => {
    setGeoRegions(prev =>
      prev.includes(region) ? prev.filter(r => r !== region) : [...prev, region]
    );
  };

  const toggleMatchVar = (v: string) => {
    setMatchingVariables(prev =>
      prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
    );
  };

  const addCriteriaRow = () => {
    setCriteriaRows(prev => [...prev, {
      id: String(Date.now()),
      type: "Inclusion",
      category: "Demographics",
      operator: "equals",
      value: ""
    }]);
  };

  const removeCriteriaRow = (id: string) => {
    setCriteriaRows(prev => prev.filter(r => r.id !== id));
  };

  const addSecondaryEndpoint = () => {
    setSecondaryEndpoints(prev => [...prev, {
      id: String(Date.now()),
      name: "",
      type: "Continuous",
      timepoint: ""
    }]);
  };

  const removeSecondaryEndpoint = (id: string) => {
    setSecondaryEndpoints(prev => prev.filter(e => e.id !== id));
  };

  const getLayerStatus = (layer: Layer) => {
    const s = simStatus[layer];
    if (s === "complete") return "complete";
    if (s === "running") return "running";
    if (layer <= activeLayer) return "available";
    return "disabled";
  };

  // 4-Layer Pre-Clinical Architecture (April 2026 redesign):
  // L1 In Vitro → L2 In Silico → L3 Ex Vivo → L4 Animal Cohort.
  // Patient Cohort + Trial were former internal slots 3/4 — moved out of
  // pre-clinical scope (now handed to Hakase Clinical via API per Section 8
  // of the architecture doc) and gated unreachable via HIDE_PATIENT_TRIAL_LAYERS.
  const layerIcons = [TestTube2, FlaskConical, Rabbit, Activity] as const;
  const layerLabels = ["In Vitro", "Confirmation", "Animal Cohort", "First In Human"] as const;
  const layerColors = ["violet", "cyan", "amber", "emerald"] as const;

  return (
    <div className={`h-screen bg-[#07080c] text-white flex flex-col overflow-hidden font-['Inter']${lightMode ? " hk-light" : ""}`} style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-white/8 bg-[#0d0f17]/90 backdrop-blur-md flex items-center px-4 gap-4 shrink-0 z-50">
        {/* Logo */}
        <div className="flex items-center gap-2 min-w-[160px]">
          <img src={hakaseLogo} alt="HakaseAI" className="h-8 w-auto object-contain" />
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-violet-500/40 text-violet-400">
            v1.0
          </Badge>
        </div>

        {/* Layer Stepper */}
        <div id="demo-layer-nav" className="flex items-center gap-1 mx-auto">
          {([1, 2, 3, 4] as Layer[]).map((layer, i) => {
            const Icon = layerIcons[i];
            const status = getLayerStatus(layer);
            const isActive = activeLayer === layer;
            // Layer color mapping aligns with `layerColors` const above:
            // L1=violet (InVitro), L2=cyan (InSilico), L3=amber (ExVivo), L4=emerald (Animal Cohort).
            const activeColor = layer === 1 ? "bg-violet-600/20 border-violet-500/50 text-violet-300"
              : layer === 2 ? "bg-cyan-600/20 border-cyan-500/50 text-cyan-300"
              : layer === 3 ? "bg-amber-600/20 border-amber-500/50 text-amber-300"
              : "bg-emerald-600/20 border-emerald-500/50 text-emerald-300";
            const badgeColor = layer === 1 ? "border-violet-400 text-violet-400 bg-violet-400/10"
              : layer === 2 ? "border-cyan-400 text-cyan-400 bg-cyan-400/10"
              : layer === 3 ? "border-amber-400 text-amber-400 bg-amber-400/10"
              : "border-emerald-400 text-emerald-400 bg-emerald-400/10";
            return (
              <div key={layer} className="flex items-center">
                <button
                  onClick={() => setActiveLayer(layer)}
                  disabled={status === "disabled"}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-medium transition-all duration-200 border ${
                    isActive
                      ? activeColor
                      : status === "complete"
                      ? "text-emerald-400 hover:bg-emerald-500/10 border-transparent cursor-pointer"
                      : status === "available"
                      ? "text-slate-400 hover:bg-white/5 border-transparent cursor-pointer"
                      : "text-slate-600 border-transparent cursor-not-allowed"
                  }`}
                >
                  {status === "complete" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold border ${
                      isActive ? badgeColor : "border-slate-600 text-slate-500"
                    }`}>
                      {layer}
                    </div>
                  )}
                  <Icon className="w-3.5 h-3.5" />
                  {layerLabels[i]}
                </button>
                {i < 3 && (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-600 mx-0.5" />
                )}
              </div>
            );
          })}
        </div>

        {/* Right nav actions */}
        <div className="flex items-center gap-2 min-w-[220px] justify-end">
          <button
            onClick={() => setDemoOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/15 border border-amber-500/30 text-amber-300 hover:bg-amber-600/25 transition-colors text-[11px] font-semibold"
          >
            <Play className="w-3.5 h-3.5" /> Demo
          </button>
          <button
            onClick={() => { setFullAiOpen(true); if (!aiReport && !aiLoading) runAiAnalysis(); }}
            disabled={!simResults}
            id="demo-full-ai-report"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[11px] font-semibold"
          >
            <Sparkles className="w-3.5 h-3.5" /> Full AI Report
          </button>
          <button
            onClick={() => setLightMode(lm => !lm)}
            title={lightMode ? "Switch to Dark Mode" : "Switch to Light Mode"}
            className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors"
          >
            {lightMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-[11px] font-bold">
            HC
          </div>
        </div>
      </header>

      {/* Simulation Status Bar */}
      {(simStatus[activeLayer] === "running") && (
        <div className="h-10 bg-violet-900/30 border-b border-violet-500/20 flex items-center px-6 gap-4 shrink-0">
          <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
          <span className="text-[12px] text-violet-300 font-medium">
            Layer {activeLayer} Simulation Running — {layerLabels[activeLayer - 1]}
          </span>
          <div className="flex-1 max-w-[300px]">
            <Progress value={simProgress} className="h-1.5 bg-violet-900/50" />
          </div>
          <span className="text-[11px] text-violet-400">{Math.round(simProgress)}%</span>
          <button className="ml-auto text-[11px] text-red-400 hover:text-red-300 flex items-center gap-1">
            <X className="w-3 h-3" /> Cancel
          </button>
        </div>
      )}

      {simStatus[activeLayer] === "complete" && (
        <div className="bg-emerald-900/20 border-b border-emerald-500/20 shrink-0">
          <div className="h-10 flex items-center px-6 gap-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="text-[12px] text-emerald-300 font-medium">
              Layer {activeLayer} simulation complete
            </span>
            {activeLayer < 4 && (
              <button
                onClick={() => {
                  const verdict = activeLayer === 1 && inVitroResults
                    ? (inVitroResults.overallRisk === "High" ? "NO-GO" : inVitroResults.overallRisk === "Moderate" ? "WATCH" : "GO")
                    : "GO";
                  if (verdict === "NO-GO") {
                    setHAIOpsCtx(prev => addOverride(prev, {
                      fromLayer: activeLayer,
                      toLayer: (activeLayer + 1) as Layer,
                      verdict,
                      timestamp: new Date().toISOString(),
                      reason: "User advanced past NO-GO verdict",
                    }));
                  }
                  setActiveLayer((activeLayer + 1) as Layer);
                }}
                className="ml-auto flex items-center gap-1.5 text-[12px] bg-violet-600 hover:bg-violet-500 px-3 py-1 rounded-md font-medium transition-colors"
              >
                Continue to {(layerLabels as readonly string[])[activeLayer]} →
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {getActiveFlags(safetyFlags, activeLayer).length > 0 && (
            <div className="px-6 pb-2 flex flex-wrap gap-1.5">
              {getActiveFlags(safetyFlags, activeLayer).map((f, idx) => {
                const sc = SAFETY_FLAG_COLORS[f.severity];
                return (
                  <span key={idx} className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border ${sc.bg} ${sc.text} ${sc.border} font-medium`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sc.glow} shadow-[0_0_4px]`} />
                    {f.label}
                    {f.reviewRequired && !f.acknowledged && <span className="text-[8px] bg-white/10 px-1 rounded">REVIEW</span>}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar — Project Panel */}
        <aside className={`${sidebarOpen ? "w-[240px]" : "w-14"} border-r border-white/8 bg-[#0d0f17]/60 flex flex-col shrink-0 transition-all duration-200 overflow-hidden`}>
          <div className="flex items-center justify-between p-3 border-b border-white/8">
            {sidebarOpen && (
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Projects</span>
            )}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1 rounded-md hover:bg-white/5 text-slate-500 hover:text-slate-300 ml-auto"
            >
              {sidebarOpen ? <ChevronDown className="w-3.5 h-3.5 rotate-90" /> : <Menu className="w-3.5 h-3.5" />}
            </button>
          </div>

          {sidebarOpen && (
            <>
              {/* Current Project */}
              <div className="p-3 border-b border-white/8">
                <div className="bg-violet-600/10 border border-violet-500/25 rounded-lg p-3">
                  <div className="text-[12px] font-semibold text-violet-300 mb-1">Current Project</div>
                  <div className="text-[11px] text-white font-medium truncate">{molName || "Unnamed Molecule"}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5 truncate">{uniprotId || "No target"}</div>
                  {indication && (
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">{indication.split("–")[1]?.trim() || indication}</div>
                  )}
                  <div className="flex gap-1 mt-2">
                    {([1, 2, 3] as Layer[]).map(l => (
                      <div key={l} className={`h-1 flex-1 rounded-full ${
                        simStatus[l] === "complete" ? "bg-emerald-500" :
                        simStatus[l] === "running" ? "bg-violet-500 animate-pulse" :
                        "bg-white/10"
                      }`} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Starter Templates */}
              <div className="p-3 flex-1 overflow-y-auto">
                <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-2">Starter Templates</div>
                {savedProjects.map((proj) => (
                  <div
                    key={proj.name}
                    onClick={() => loadSavedProject(proj)}
                    className="p-2.5 rounded-lg hover:bg-white/5 cursor-pointer mb-1.5 group border border-transparent hover:border-white/8 transition-all"
                  >
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-1 mb-0.5">
                      <div className="text-[11px] font-semibold text-slate-300 truncate group-hover:text-white leading-tight">{proj.name}</div>
                      <span className="shrink-0 text-[8px] font-bold px-1 py-0.5 rounded border text-slate-400 bg-white/5 border-white/10 uppercase tracking-wider">Template</span>
                    </div>

                    {/* Molecule + indication */}
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-[9px] text-slate-600 font-mono">{proj.molName}</span>
                      <span className="text-slate-700">·</span>
                      <span className="text-[9px] text-slate-600">{proj.indication}</span>
                    </div>

                    {/* Target */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[8px] text-slate-700 uppercase tracking-wider">Target</span>
                      <span className="text-[9px] font-mono text-slate-500">{proj.uniprotId}</span>
                      <span className="ml-auto text-[8px] text-slate-700 italic">Click to load</span>
                    </div>
                  </div>
                ))}

                <button
                  onClick={handleNewProject}
                  className="w-full mt-3 py-2 text-[11px] text-violet-400 hover:text-violet-300 border border-dashed border-violet-500/30 hover:border-violet-500/50 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-3 h-3" /> New Project
                </button>

                {/* Import via API */}
                <div className="mt-2 border border-white/8 rounded-lg overflow-hidden">
                  <button
                    onClick={() => { setProjImportOpen(v => !v); setProjImportResult(null); }}
                    className="w-full flex items-center justify-between px-2.5 py-2 hover:bg-white/3 transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <Globe className="w-3 h-3 text-violet-400" />
                      <span className="text-[11px] text-slate-400">Import via API</span>
                    </div>
                    {projImportOpen ? <ChevronUp className="w-3 h-3 text-slate-600" /> : <ChevronDown className="w-3 h-3 text-slate-600" />}
                  </button>

                  {projImportOpen && (
                    <div className="px-2.5 pb-2.5 space-y-2 border-t border-white/6">
                      {/* Source */}
                      <div className="pt-2">
                        <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1.5">Source</div>
                        <div className="grid grid-cols-2 gap-1">
                          {[
                            { id: "clinicaltrials", label: "ClinicalTrials" },
                            { id: "ehr",            label: "EHR / Epic" },
                            { id: "lims",           label: "LIMS" },
                            { id: "pubmed",         label: "PubMed" },
                          ].map(src => (
                            <button
                              key={src.id}
                              onClick={() => { setProjImportSource(src.id); setProjImportResult(null); setProjImportId(""); }}
                              className={`py-1 px-2 rounded text-[10px] font-medium border transition-all text-left ${
                                projImportSource === src.id
                                  ? "bg-violet-600/20 border-violet-500/40 text-violet-300"
                                  : "border-white/8 text-slate-500 hover:border-white/20"
                              }`}
                            >
                              {src.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* ID input */}
                      <div>
                        <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1">
                          {projImportSource === "clinicaltrials" ? "NCT Number" : projImportSource === "pubmed" ? "PMID" : "Study / Record ID"}
                        </div>
                        <div className="flex gap-1">
                          <Input
                            value={projImportId}
                            onChange={e => { setProjImportId(e.target.value); setProjImportResult(null); }}
                            onKeyDown={e => e.key === "Enter" && handleProjFetch()}
                            placeholder={projImportSource === "clinicaltrials" ? "NCT04292899" : projImportSource === "pubmed" ? "36150754" : projImportSource === "ehr" ? "PAT-001" : "LIMS-2024-001"}
                            className="bg-white/5 border-white/10 text-white text-[11px] focus:border-violet-500/60 h-7"
                          />
                          <button
                            onClick={handleProjFetch}
                            disabled={!projImportId.trim() || projImportLoading}
                            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 disabled:opacity-40 text-[10px] font-medium transition-all"
                          >
                            {projImportLoading ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Download className="w-2.5 h-2.5" />}
                          </button>
                        </div>
                      </div>

                      {/* Result */}
                      {projImportResult && (
                        <div className={`rounded-lg p-2.5 space-y-1.5 border ${projImportResult.name === "Import Error" ? "bg-red-500/5 border-red-500/20" : "bg-emerald-500/5 border-emerald-500/20"}`}>
                          <div className={`text-[11px] font-semibold leading-snug ${projImportResult.name === "Import Error" ? "text-red-300" : "text-emerald-300"}`}>{projImportResult.name}</div>
                          {projImportResult.name === "Import Error" ? (
                            <div className="text-[10px] text-red-400">{projImportResult.indication}</div>
                          ) : (
                            <>
                              <div className="text-[10px] text-slate-400 leading-snug">{projImportResult.indication}</div>
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-slate-600">
                                <span>{projImportResult.phase}</span>
                                <span>{projImportResult.sponsor}</span>
                                {projImportResult.enrollment != null && projImportResult.enrollment > 0 && (
                                  <span>n={projImportResult.enrollment.toLocaleString()}</span>
                                )}
                              </div>
                              <button
                                onClick={() => {
                                  if (projImportResult.indication && projImportResult.indication !== "—") {
                                    setIndication(projImportResult.indication);
                                  }
                                  if (projImportResult.phase && projImportResult.phase !== "—" && projImportResult.phase !== "Literature" && projImportResult.phase !== "Unknown") {
                                    setTrialPhase(projImportResult.phase);
                                  }
                                  if (projImportResult.enrollment && projImportResult.enrollment > 0) {
                                    setTargetSampleSize(String(projImportResult.enrollment));
                                  }
                                  setSavedProjects(prev => [{
                                    name: projImportResult.name,
                                    indication: projImportResult.indication,
                                    indicationCode: projImportResult.indication,
                                    molName: "Imported",
                                    smiles: "",
                                    uniprotId: "",
                                    layers: 0,
                                    goNogo: "WATCH" as const,
                                    qed: 0,
                                    binding: "—",
                                    responderRate: null,
                                    successProb: null,
                                    lastRun: "Just now",
                                  }, ...prev]);
                                  setActiveLayer(1);
                                  setProjImportOpen(false);
                                  setProjImportResult(null);
                                  setProjImportId("");
                                }}
                                className="w-full flex items-center justify-center gap-1 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-[10px] font-medium transition-all"
                              >
                                <CheckCircle2 className="w-2.5 h-2.5" /> Use — Load into Simulation
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col overflow-hidden">

          {/* Layer 1 — In Vitro Digital Twin */}
          {activeLayer === 1 && (
            <div className="flex-1 flex overflow-hidden">
              {/* Input Panel */}
              <div className="w-[420px] border-r border-white/8 overflow-y-auto flex flex-col">
                <div className="p-5 border-b border-white/8">
                  <div className="flex items-center gap-2 mb-1">
                    <TestTube2 className="w-4 h-4 text-violet-400" />
                    <h2 className="text-[15px] font-semibold text-white">Layer 1 — In Vitro Digital Twin</h2>
                  </div>
                  <p className="text-[11px] text-slate-500">Configure in vitro structure and simulation parameters</p>
                </div>

                <div className="p-5 space-y-5">
                  {/* 2.1 Primary Input */}
                  <section>
                    <SectionHeader icon={Atom} label="Primary In Vitro Input" />
                    <div className="space-y-3">
                      <FieldGroup label="SMILES String" required hint="RDKit validated · MW 100–1500 Da">
                        <div id="demo-smiles-input" className="flex gap-2">
                          <div className="relative flex-1">
                            <Input
                              value={smiles}
                              onChange={e => setSmiles(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter" && molProps?.isValid) handleAnalyzeMolecule(); }}
                              placeholder="Enter SMILES notation..."
                              className="bg-white/5 border-white/10 text-white text-[12px] font-mono pr-10 focus:border-violet-500/60 focus:bg-white/8"
                            />
                            {smiles && (
                              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                {!rdkitReady ? (
                                  <RefreshCw className="w-3.5 h-3.5 text-slate-500 animate-spin" />
                                ) : molProps?.isValid ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                ) : molProps ? (
                                  <XCircle className="w-3.5 h-3.5 text-red-400" />
                                ) : (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" />
                                )}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={handleAnalyzeMolecule}
                            disabled={!molProps?.isValid || !smilesNeedsActivation}
                            className={`shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                              smilesNeedsActivation && molProps?.isValid
                                ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:from-violet-500 hover:to-violet-400 animate-pulse"
                                : "bg-white/5 border border-white/10 text-slate-500 cursor-not-allowed"
                            }`}
                          >
                            <Play className="w-3.5 h-3.5" />
                            {smilesNeedsActivation ? "Run" : "Active"}
                          </button>
                        </div>
                        {smiles && (
                          <div className={`mt-2 border rounded-lg overflow-hidden transition-colors ${
                            !rdkitReady || !molProps
                              ? "bg-white/5 border-white/10"
                              : molProps.isValid
                              ? "bg-emerald-500/5 border-emerald-500/20"
                              : "bg-red-500/5 border-red-500/20"
                          }`}>
                            <div className="p-3 flex items-center justify-between">
                              <div className="flex items-center gap-3 min-w-0">
                                {mol2dSvg ? (
                                  <div
                                    className="w-16 h-14 rounded border border-emerald-500/20 bg-white/[0.03] shrink-0 flex items-center justify-center overflow-hidden cursor-pointer hover:border-violet-500/40 transition-colors"
                                    onClick={() => setViewer3DOpen(true)}
                                    title="Click for interactive 3D view"
                                    dangerouslySetInnerHTML={{ __html: mol2dSvg.replace(/width=['"][^'"]*['"]/, 'width="100%"').replace(/height=['"][^'"]*['"]/, 'height="100%"') }}
                                  />
                                ) : (
                                  <div className={`w-16 h-14 rounded border flex items-center justify-center shrink-0 ${
                                    !rdkitReady || !molProps
                                      ? "border-slate-500/20 bg-slate-500/5"
                                      : molProps.isValid
                                      ? "border-emerald-500/30 bg-emerald-500/5"
                                      : "border-red-500/30 bg-red-500/5"
                                  }`}>
                                    <Atom className={`w-5 h-5 ${
                                      !rdkitReady || !molProps ? "text-slate-500/60"
                                      : molProps.isValid ? "text-emerald-400/60"
                                      : "text-red-400/60"
                                    }`} />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  {!rdkitReady ? (
                                    <>
                                      <div className="text-slate-400 text-[11px] font-medium">Loading chemistry engine…</div>
                                      <div className="text-slate-600 text-[10px]">RDKit.js initialising</div>
                                    </>
                                  ) : molProps?.isValid ? (
                                    <>
                                      <div className="text-emerald-400 text-[11px] font-medium">Valid structure · RDKit verified</div>
                                      <div className="text-slate-400 text-[10px]">
                                        MW {molProps.mw} Da · logP {molProps.logP} · HBD {molProps.hbd} · HBA {molProps.hba}
                                      </div>
                                      {chemblLookupLoading && (
                                        <div className="text-violet-400 text-[9px] mt-0.5 flex items-center gap-1">
                                          <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                                          Identifying compound in ChEMBL…
                                        </div>
                                      )}
                                      {!chemblLookupLoading && (chemblCompoundName || chemblCompoundId) && (
                                        <div className="text-emerald-300 text-[9px] mt-0.5 flex items-center gap-1">
                                          <CheckCircle2 className="w-2.5 h-2.5" />
                                          {chemblCompoundName ? `${chemblCompoundName} (${chemblCompoundId})` : chemblCompoundId}
                                        </div>
                                      )}
                                      {!chemblLookupLoading && !chemblCompoundName && !chemblCompoundId && molProps?.isValid && (
                                        <div className="text-slate-600 text-[9px] mt-0.5">
                                          Not found in ChEMBL — novel compound
                                        </div>
                                      )}
                                    </>
                                  ) : molProps ? (
                                    <>
                                      <div className="text-red-400 text-[11px] font-medium">Invalid SMILES</div>
                                      <div className="text-slate-600 text-[10px]">Check notation and try again</div>
                                    </>
                                  ) : (
                                    <>
                                      <div className="text-slate-400 text-[11px] font-medium">Validating…</div>
                                      <div className="text-slate-600 text-[10px]">{smiles.length} chars</div>
                                    </>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={() => setViewer3DOpen(true)}
                                disabled={!molProps?.isValid}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 transition-all text-[11px] font-medium disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                              >
                                <Box className="w-3.5 h-3.5" />
                                View 3D
                              </button>
                            </div>
                          </div>
                        )}
                      </FieldGroup>

                      <FieldGroup label="Molecule Name" hint={chemblCompoundName ? `ChEMBL: ${chemblCompoundName}` : "Auto-identified from ChEMBL"}>
                        <Input
                          value={molName}
                          onChange={e => { molNameManual.current = true; setMolName(e.target.value); }}
                          className="bg-white/5 border-white/10 text-white text-[12px] focus:border-violet-500/60"
                          placeholder="e.g. Compound-XYZ-001"
                        />
                      </FieldGroup>

                      <div className="grid grid-cols-2 gap-2">
                        <MolFileUpload onLoaded={(sm, nm) => { setSmiles(sm); if (nm) setMolName(nm); }} />
                        <BatchCsvUpload onSelected={(sm, nm) => { setSmiles(sm); if (nm) setMolName(nm); }} />
                      </div>

                      {/* ── Diagen Integration ── */}
                      <div className="border border-violet-500/30 rounded-lg overflow-hidden bg-violet-950/20">
                        <button
                          onClick={() => { setDiagenOpen(v => !v); setDiagenResult(null); }}
                          className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-violet-500/5 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shrink-0">
                              <Dna className="w-3 h-3 text-white" />
                            </div>
                            <div className="text-left">
                              <div className="text-[11px] font-semibold text-violet-200">Import from Diagen AI</div>
                              <div className="text-[9px] text-violet-400/70 leading-tight">Generate → Simulate pipeline</div>
                            </div>
                            <Badge className="text-[9px] px-1.5 py-0 bg-violet-500/20 text-violet-300 border-violet-500/30 ml-1">Hakase Ecosystem</Badge>
                          </div>
                          {diagenOpen ? <ChevronUp className="w-3.5 h-3.5 text-violet-400" /> : <ChevronDown className="w-3.5 h-3.5 text-violet-400" />}
                        </button>

                        {diagenOpen && (
                          <div className="px-3 pb-3 space-y-3 border-t border-violet-500/15">
                            {/* Mode selector */}
                            <div className="pt-3">
                              <div className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">Integration Mode</div>
                              <div className="grid grid-cols-3 gap-1">
                                {([
                                  { id: "sync",    label: "Synchronous",  hint: "Single · <30s" },
                                  { id: "batch",   label: "Async Batch",  hint: "Webhook · ~2m" },
                                  { id: "cascade", label: "Cascade",      hint: "L1→L2→L3" },
                                ] as const).map(m => (
                                  <button
                                    key={m.id}
                                    onClick={() => { setDiagenMode(m.id); setDiagenResult(null); }}
                                    className={`py-1.5 px-2 rounded text-center border transition-all ${
                                      diagenMode === m.id
                                        ? "bg-violet-600/20 border-violet-500/50 text-violet-200"
                                        : "border-white/8 text-slate-500 hover:border-violet-500/25"
                                    }`}
                                  >
                                    <div className="text-[10px] font-semibold">{m.label}</div>
                                    <div className="text-[9px] text-slate-600 mt-0.5">{m.hint}</div>
                                  </button>
                                ))}
                              </div>
                              {diagenMode === "cascade" && (
                                <div className="mt-2 text-[10px] text-violet-400/70 flex items-center gap-1.5 bg-violet-500/5 rounded px-2 py-1.5 border border-violet-500/15">
                                  <Zap className="w-3 h-3 shrink-0" />
                                  Cascade mode runs L1 → L2 → L3 automatically. Results propagate across all layers.
                                </div>
                              )}
                            </div>

                            {/* Job / Molecule ID */}
                            <div>
                              <div className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">
                                {diagenMode === "batch" ? "Batch Job ID" : "Molecule ID"}
                                <span className="ml-2 text-slate-600 normal-case">e.g. DGN-MOL-0047</span>
                              </div>
                              <div className="flex gap-2">
                                <div className="relative flex-1">
                                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                                  <Input
                                    value={diagenJobId}
                                    onChange={e => { setDiagenJobId(e.target.value); setDiagenResult(null); }}
                                    onKeyDown={e => e.key === "Enter" && handleDiagenFetch()}
                                    placeholder={diagenMode === "batch" ? "DGN-BATCH-2024-Q1" : "DGN-MOL-0047"}
                                    className="bg-white/5 border-violet-500/20 text-white text-[12px] pl-7 focus:border-violet-500/60"
                                  />
                                </div>
                                <button
                                  onClick={handleDiagenFetch}
                                  disabled={!diagenJobId.trim() || diagenLoading}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/30 border border-violet-500/40 text-violet-200 hover:bg-violet-600/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-[11px] font-medium shrink-0"
                                >
                                  {diagenLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                  {diagenLoading ? "Fetching…" : "Fetch"}
                                </button>
                              </div>
                            </div>

                            {/* Result */}
                            {diagenResult && (
                              <div className="bg-violet-500/5 border border-violet-500/25 rounded-lg p-3 space-y-2.5">
                                {/* Header */}
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-[12px] font-semibold text-violet-200">{diagenResult.name}</div>
                                    <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">{diagenResult.smiles.slice(0, 40)}…</div>
                                    <div className="text-[10px] text-slate-600 mt-0.5">MW: {diagenResult.mw} · Target: {diagenResult.targetName}</div>
                                  </div>
                                </div>

                                {/* Pre-scores from Diagen */}
                                <div className="grid grid-cols-3 gap-1.5">
                                  {[
                                    { label: "QED", val: diagenResult.qed.toFixed(2), good: diagenResult.qed > 0.6 },
                                    { label: "SA Score", val: diagenResult.sa.toFixed(1), good: diagenResult.sa < 4 },
                                    { label: "Binding", val: diagenResult.bindingAffinity, good: true },
                                  ].map(({ label, val, good }) => (
                                    <div key={label} className="bg-white/5 rounded px-2 py-1.5 text-center border border-white/5">
                                      <div className="text-[9px] text-slate-600 uppercase tracking-wider">{label}</div>
                                      <div className={`text-[11px] font-semibold mt-0.5 ${good ? "text-emerald-400" : "text-yellow-400"}`}>{val}</div>
                                    </div>
                                  ))}
                                </div>

                                {/* ADMET mini-bars */}
                                <div>
                                  <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-1.5">Diagen ADMET Pre-scores</div>
                                  <div className="space-y-1">
                                    {(["absorption","distribution","metabolism","excretion","toxicity"] as const).map(k => (
                                      <div key={k} className="flex items-center gap-2">
                                        <span className="text-[9px] text-slate-500 w-16 capitalize">{k}</span>
                                        <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                                          <div
                                            className={`h-full rounded-full ${diagenResult.admet[k] >= 0.7 ? "bg-emerald-500" : "bg-yellow-500"}`}
                                            style={{ width: `${diagenResult.admet[k] * 100}%` }}
                                          />
                                        </div>
                                        <span className="text-[9px] text-slate-500 w-6 text-right">{diagenResult.admet[k].toFixed(2)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-2 pt-1 border-t border-violet-500/15">
                                  <button
                                    onClick={() => {
                                      setSmiles(diagenResult.smiles);
                                      setMolName(diagenResult.name);
                                      setUniprotId(diagenResult.uniprotId);
                                      setDiagenOpen(false);
                                      setDiagenResult(null);
                                    }}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-violet-600/25 border border-violet-500/40 text-violet-200 hover:bg-violet-600/35 text-[11px] font-semibold transition-all"
                                  >
                                    <CheckCircle2 className="w-3 h-3" /> Import All Fields
                                  </button>
                                  <button
                                    onClick={() => {
                                      setSmiles(diagenResult.smiles);
                                      setMolName(diagenResult.name);
                                      setDiagenOpen(false);
                                      setDiagenResult(null);
                                    }}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-white text-[11px] transition-all"
                                  >
                                    SMILES only
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* API Import */}
                      <div className="border border-white/8 rounded-lg overflow-hidden">
                        <button
                          onClick={() => { setApiImportOpen(v => !v); setApiResult(null); }}
                          className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/3 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <Globe className="w-3.5 h-3.5 text-violet-400" />
                            <span className="text-[11px] font-semibold text-slate-300">Import via API</span>
                            <Badge className="text-[9px] px-1.5 py-0 bg-violet-500/10 text-violet-400 border-violet-500/20">ChEMBL · PubChem · ZINC · UniChem</Badge>
                          </div>
                          {apiImportOpen ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
                        </button>

                        {apiImportOpen && (
                          <div className="px-3 pb-3 space-y-3 border-t border-white/6">
                            {/* Source selector */}
                            <div className="pt-3">
                              <div className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">Source Database</div>
                              <div className="flex flex-wrap gap-1.5">
                                {([
                                  { id: "chembl",  label: "ChEMBL",  hint: "CHEMBL25" },
                                  { id: "pubchem", label: "PubChem", hint: "CID 3672 or name" },
                                  { id: "unichem", label: "UniChem", hint: "CHEMBL ID" },
                                  { id: "zinc",    label: "ZINC",    hint: "ZINC ID" },
                                ] as { id: ApiSource; label: string; hint: string }[]).map(src => (
                                  <button
                                    key={src.id}
                                    onClick={() => { setApiSource(src.id); setApiResult(null); setApiError(null); setApiCompoundId(""); }}
                                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${
                                      apiSource === src.id
                                        ? "bg-violet-600/20 border-violet-500/40 text-violet-300"
                                        : "border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-400"
                                    }`}
                                  >
                                    {src.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Compound ID input */}
                            <div>
                              <div className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">
                                Compound ID / Name
                                <span className="ml-2 text-slate-600 normal-case">
                                  e.g.&nbsp;
                                  {apiSource === "chembl"  ? "CHEMBL25 or aspirin"    :
                                   apiSource === "pubchem" ? "2244 or ibuprofen"       :
                                   apiSource === "unichem" ? "CHEMBL25 (ChEMBL ID)"   :
                                                            "ZINC000003594435"}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <div className="relative flex-1">
                                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                                  <Input
                                    value={apiCompoundId}
                                    onChange={e => { setApiCompoundId(e.target.value); setApiResult(null); setApiError(null); }}
                                    onKeyDown={e => e.key === "Enter" && handleApiFetch()}
                                    placeholder={
                                      apiSource === "chembl"  ? "CHEMBL ID or drug name…"   :
                                      apiSource === "pubchem" ? "CID number or drug name…"   :
                                      apiSource === "unichem" ? "ChEMBL ID (e.g. CHEMBL25)…" :
                                                               "ZINC ID…"
                                    }
                                    className="bg-white/5 border-white/10 text-white text-[12px] pl-7 focus:border-violet-500/60"
                                  />
                                </div>
                                <button
                                  onClick={handleApiFetch}
                                  disabled={!apiCompoundId.trim() || apiLoading}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-[11px] font-medium shrink-0"
                                >
                                  {apiLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                  {apiLoading ? "Fetching…" : "Fetch"}
                                </button>
                              </div>
                            </div>

                            {/* Error */}
                            {apiError && (
                              <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 flex items-start gap-2">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                                <div className="text-[11px] text-red-300">{apiError}</div>
                              </div>
                            )}

                            {/* Result */}
                            {apiResult && (
                              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <div className="text-[11px] font-semibold text-emerald-300">{apiResult.name}</div>
                                      {apiResult.sourceId && (
                                        <span className="text-[9px] text-slate-600 font-mono">{apiResult.sourceId}</span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">{apiResult.smiles}</div>
                                    <div className="text-[10px] text-slate-600 mt-0.5">MW: {apiResult.mw}</div>
                                  </div>
                                  <button
                                    onClick={() => {
                                      setSmiles(apiResult.smiles);
                                      setMolName(apiResult.name);
                                      setApiImportOpen(false);
                                      setApiResult(null);
                                    }}
                                    className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-[11px] font-medium transition-all"
                                  >
                                    <CheckCircle2 className="w-3 h-3" />
                                    Use
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </section>

                  <Separator className="bg-white/8" />

                  {/* 2.2 Target Protein */}
                  <section id="demo-target-protein">
                    <SectionHeader icon={Dna} label="Target Protein Configuration" />
                    <div className="space-y-3">

                      {/* ── Help banner ─────────────────────────────────── */}
                      <div className="bg-blue-500/5 border border-blue-500/15 rounded-lg p-2.5 flex gap-2">
                        <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                        <div className="text-[10px] text-slate-400 leading-relaxed">
                          Enter a <span className="text-white font-medium">UniProt accession</span> (e.g. <span className="font-mono text-violet-300">P00533</span>) and click <span className="text-white font-medium">Fetch</span> to load the protein. Then optionally specify a <span className="text-white font-medium">PDB structure</span> for binding simulation — or let it auto-populate from the protein's known crystal structures.
                        </div>
                      </div>

                      {/* ── UniProt ID ───────────────────────────────────── */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Target UniProt ID</span>
                            <span className="text-[9px] text-red-400">*</span>
                            {uniprotAutoMode && targetSuggestions.length > 0 && (() => {
                              const top = targetSuggestions[0];
                              const isChembl = top?.source === "chembl";
                              const isSimilar = top?.source === "chembl-similar";
                              const isMeasured = isChembl || isSimilar;
                              const confLabel = top?.confidenceLabel ?? "Low";
                              const confBadge = isChembl
                                ? "bg-emerald-500/15 border-emerald-500/25 text-emerald-400"
                                : isSimilar
                                ? "bg-amber-500/15 border-amber-500/25 text-amber-300"
                                : confLabel === "High"   ? "bg-emerald-500/15 border-emerald-500/25 text-emerald-400"
                                : confLabel === "Medium" ? "bg-amber-500/15 border-amber-500/25 text-amber-400"
                                :                          "bg-red-500/10 border-red-500/20 text-red-400";
                              const confText = isChembl ? "ChEMBL Verified"
                                : isSimilar ? `ChEMBL · ${top?.similarityPct ? Math.round(top.similarityPct) + "% sim" : "similarity"}`
                                : `Auto-matched · ${confLabel} confidence`;
                              void isMeasured;
                              return (
                                <span className={`px-1.5 py-0.5 rounded-full border text-[8px] font-medium ${confBadge}`}>
                                  {confText}
                                </span>
                              );
                            })()}
                            {chemblLookupLoading && (
                              <span className="px-1.5 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-[8px] text-sky-400 font-medium animate-pulse">
                                Querying ChEMBL…
                              </span>
                            )}
                          </div>
                          {uniprotAutoMode ? (
                            <span className="text-[9px] text-slate-600">Follows top molecule suggestion</span>
                          ) : (
                            <button
                              onClick={() => { uniprotManual.current = false; setUniprotAutoMode(true); }}
                              className="text-[9px] text-violet-500 hover:text-violet-400 transition-colors"
                            >
                              ↺ Auto-match
                            </button>
                          )}
                        </div>

                        {/* Quick-select from molecule-matched suggestions */}
                        {targetSuggestions.length > 0 && (
                          <div className="mb-1.5 flex flex-wrap gap-x-3 gap-y-1">
                            {targetSuggestions.slice(0, 4).map(sugg => {
                              const isActive = uniprotId === sugg.uniprotId;
                              const isChembl = sugg.source === "chembl" || sugg.source === "chembl-similar";
                              const confPct = Math.round(sugg.confidence * 100);
                              const confColor = isChembl ? "text-emerald-500"
                                : sugg.confidenceLabel === "High"   ? "text-emerald-500"
                                : sugg.confidenceLabel === "Medium" ? "text-amber-500"
                                :                                     "text-red-400";
                              return (
                                <button
                                  key={sugg.uniprotId}
                                  onClick={() => { uniprotManual.current = true; setUniprotAutoMode(false); setUniprotId(sugg.uniprotId); setPdbId(""); setPdbStructure(null); setProteinInfo(null); setProteinError(null); handleProteinFetch(sugg.uniprotId); }}
                                  className={`text-[9px] transition-colors font-mono flex items-center gap-0.5 ${isActive ? (isChembl ? "text-emerald-400" : "text-violet-400") : "text-slate-600 hover:text-violet-400"}`}
                                >
                                  {sugg.uniprotId} <span className={`not-italic ${isActive ? (isChembl ? "text-emerald-500" : "text-violet-500") : "text-slate-700"}`}>({sugg.geneName})</span>
                                  <span className={`text-[7px] ml-0.5 ${confColor}`}>{confPct}%</span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {(() => {
                          const trimmedUniprot = uniprotId.trim();
                          const uniprotIdInvalid = trimmedUniprot.length > 0 && !isValidUniprotAccession(trimmedUniprot);
                          return (
                            <>
                              <div className="flex gap-2">
                                <div className="relative flex-1">
                                  <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${uniprotIdInvalid ? "text-red-400" : "text-slate-500"}`} />
                                  <Input
                                    value={uniprotId}
                                    onChange={e => {
                                      uniprotManual.current = true;
                                      setUniprotAutoMode(false);
                                      setUniprotId(e.target.value.toUpperCase());
                                      setProteinInfo(null);
                                      setProteinError(null);
                                    }}
                                    onKeyDown={e => e.key === "Enter" && !uniprotIdInvalid && handleProteinFetch()}
                                    aria-invalid={uniprotIdInvalid}
                                    aria-describedby="uniprot-id-hint"
                                    className={`bg-white/5 text-white text-[12px] pl-8 font-mono uppercase ${uniprotIdInvalid ? "border-red-500/60 focus:border-red-500/80" : "border-white/10 focus:border-violet-500/60"}`}
                                    placeholder="UniProt accession e.g. P00533"
                                  />
                                </div>
                                <button
                                  onClick={handleProteinFetch}
                                  disabled={!trimmedUniprot || uniprotIdInvalid || proteinLoading}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-[11px] font-medium shrink-0"
                                >
                                  {proteinLoading
                                    ? <><RefreshCw className="w-3 h-3 animate-spin" /> Fetching…</>
                                    : <><Download className="w-3 h-3" /> Fetch</>
                                  }
                                </button>
                              </div>

                              {/* Inline format hint / validation message */}
                              <div
                                id="uniprot-id-hint"
                                role={uniprotIdInvalid ? "alert" : undefined}
                                aria-live={uniprotIdInvalid ? "polite" : undefined}
                                className="mt-1.5 flex items-start gap-1"
                              >
                                {uniprotIdInvalid ? (
                                  <>
                                    <AlertTriangle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                                    <span className="text-[9px] text-red-400">
                                      Invalid UniProt accession format. Expected e.g. <span className="font-mono">P00533</span> or <span className="font-mono">A0A024R161</span>.
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <Info className="w-3 h-3 text-slate-600 shrink-0 mt-0.5" />
                                    <span className="text-[9px] text-slate-600">
                                      UniProt accessions are 6–10 character protein identifiers. Find yours at{" "}
                                      <span className="text-violet-500">uniprot.org</span> by searching the protein or gene name.
                                    </span>
                                  </>
                                )}
                              </div>
                            </>
                          );
                        })()}

                        {/* Molecule-aware target suggestions */}
                        {targetSuggestions.length > 0 && (
                          <div className="mt-2 rounded-xl border border-violet-500/20 bg-violet-500/5 overflow-hidden">
                            <button
                              onClick={() => setTargetSuggOpen(v => !v)}
                              className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-semibold text-violet-300 hover:bg-violet-500/8 transition-colors"
                            >
                              <div className="flex items-center gap-1.5">
                                <Sparkles className="w-3 h-3 text-violet-400" />
                                <span>Molecule-Based Target Suggestions</span>
                                <span className="px-1.5 py-0.5 rounded-full bg-violet-500/20 text-[9px]">{targetSuggestions.length}</span>
                              </div>
                              <ChevronDown className={`w-3 h-3 text-slate-500 transition-transform ${targetSuggOpen ? "rotate-180" : ""}`} />
                            </button>
                            {targetSuggOpen && (
                              <div className="px-2 pb-2 space-y-1.5">
                                <p className="text-[9px] text-slate-500 px-1 pb-1">
                                  Ranked by structural and physicochemical match to your molecule. Click <span className="text-violet-400 font-medium">Use</span> to set a UniProt ID.
                                </p>
                                {targetSuggestions.map((sugg, i) => {
                                  const barColor = sugg.color === "violet" ? "bg-violet-500"  :
                                                   sugg.color === "blue"   ? "bg-blue-500"    :
                                                   sugg.color === "emerald"? "bg-emerald-500" :
                                                   sugg.color === "amber"  ? "bg-amber-500"   :
                                                   sugg.color === "red"    ? "bg-red-500"     :
                                                                             "bg-cyan-500";
                                  const badgeColor = sugg.color === "violet" ? "bg-violet-500/15 text-violet-300 border-violet-500/25"  :
                                                     sugg.color === "blue"   ? "bg-blue-500/15 text-blue-300 border-blue-500/25"        :
                                                     sugg.color === "emerald"? "bg-emerald-500/15 text-emerald-300 border-emerald-500/25":
                                                     sugg.color === "amber"  ? "bg-amber-500/15 text-amber-300 border-amber-500/25"     :
                                                     sugg.color === "red"    ? "bg-red-500/15 text-red-300 border-red-500/25"           :
                                                                               "bg-cyan-500/15 text-cyan-300 border-cyan-500/25";
                                  return (
                                    <div key={sugg.uniprotId}
                                      className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5 space-y-1.5 hover:border-white/15 transition-colors"
                                    >
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border font-mono ${badgeColor}`}>
                                            {sugg.geneName}
                                          </span>
                                          <span className="text-[10px] font-medium text-slate-300 leading-tight">{sugg.fullName}</span>
                                        </div>
                                        <button
                                          onClick={() => {
                                            uniprotManual.current = true;
                                            setUniprotAutoMode(false);
                                            setUniprotId(sugg.uniprotId);
                                            setPdbId("");
                                            setPdbStructure(null);
                                            setProteinInfo(null);
                                            setProteinError(null);
                                            handleProteinFetch(sugg.uniprotId);
                                          }}
                                          className="shrink-0 px-2 py-1 rounded text-[9px] font-semibold bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/35 transition-all"
                                        >
                                          Use
                                        </button>
                                      </div>
                                      <div className="flex items-center gap-2 text-[9px] text-slate-500">
                                        <span className={`px-1 py-px rounded text-[7px] font-bold uppercase tracking-wider ${
                                          sugg.confidenceLabel === "Experimental" ? "bg-emerald-500/15 text-emerald-400"
                                          : sugg.confidenceLabel === "High"       ? "bg-emerald-500/10 text-emerald-500"
                                          : sugg.confidenceLabel === "Medium"     ? "bg-amber-500/10 text-amber-400"
                                          :                                         "bg-red-500/10 text-red-400"
                                        }`}>
                                          {sugg.confidenceLabel === "Experimental" ? "Experimental" : `${sugg.confidenceLabel} Conf.`}
                                        </span>
                                        <span className="text-slate-600">{sugg.targetClass}</span>
                                        <span className="text-slate-700">·</span>
                                        <span className="text-slate-600">{sugg.area}</span>
                                      </div>
                                      {/* Confidence bar */}
                                      <div className="flex items-center gap-1.5">
                                        <div className="flex-1 h-1 rounded-full bg-white/8">
                                          <div className={`h-full rounded-full opacity-80 ${
                                            sugg.confidenceLabel === "Experimental" || sugg.confidenceLabel === "High" ? "bg-emerald-500"
                                            : sugg.confidenceLabel === "Medium" ? "bg-amber-500"
                                            : "bg-red-400"
                                          }`} style={{ width: `${(sugg.confidence * 100).toFixed(0)}%` }} />
                                        </div>
                                        <span className={`text-[9px] w-8 text-right font-medium ${
                                          sugg.confidenceLabel === "Experimental" || sugg.confidenceLabel === "High" ? "text-emerald-500"
                                          : sugg.confidenceLabel === "Medium" ? "text-amber-400"
                                          : "text-red-400"
                                        }`}>{(sugg.confidence * 100).toFixed(0)}%</span>
                                      </div>
                                      {/* Rationale bullets */}
                                      <ul className="space-y-0.5">
                                        {sugg.rationale.map((r, ri) => (
                                          <li key={ri} className="flex items-start gap-1 text-[9px] text-slate-500 leading-relaxed">
                                            <span className="shrink-0 mt-0.5 text-slate-700">→</span>
                                            <span>{r}</span>
                                          </li>
                                        ))}
                                      </ul>
                                      {/* Source-quality block: tier chip + measurement payload (when available) */}
                                      {sugg.quality && (() => {
                                        const q = sugg.quality;
                                        const p = q.payload;
                                        const suppress = shouldSuppressEstimate(q);
                                        const dominantAssay = p ? Object.entries(p.assayTypes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null;
                                        const humanShare = p && p.nMeasurements > 0 ? ((p.speciesCount["Homo sapiens"] ?? 0) / p.nMeasurements) : 0;
                                        return (
                                          <div className={`pt-1 border-t border-white/5 space-y-1 ${suppress ? "opacity-60" : ""}`}>
                                            <div className="flex items-center gap-1 flex-wrap">
                                              <span className={`px-1.5 py-px rounded border text-[8px] font-bold uppercase tracking-wider ${tierChipClasses(q.tier)}`}>
                                                {tierLabel(q.tier)}
                                              </span>
                                              <span className="text-[8px] text-slate-500">{q.source}</span>
                                              {q.note && <span className="text-[8px] text-slate-600 italic" title={q.note}>· {q.note.length > 60 ? q.note.slice(0, 60) + "…" : q.note}</span>}
                                            </div>
                                            {p && (
                                              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px]">
                                                <div className="flex items-center gap-1">
                                                  <span className="text-slate-600">n</span>
                                                  <span className={`font-mono font-semibold ${p.nMeasurements >= 5 ? "text-emerald-400" : p.nMeasurements >= 3 ? "text-amber-400" : "text-rose-400"}`}>
                                                    {p.nMeasurements}
                                                  </span>
                                                  <span className="text-slate-700">({p.distinctCompounds} cmpd{p.distinctCompounds === 1 ? "" : "s"})</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                  <span className="text-slate-600">geom</span>
                                                  <span className="font-mono text-slate-300">{p.geometricMean_nM < 1000 ? `${p.geometricMean_nM.toFixed(1)} nM` : `${(p.geometricMean_nM / 1000).toFixed(2)} µM`}</span>
                                                </div>
                                                <div className="flex items-center gap-1 col-span-2">
                                                  <span className="text-slate-600">range</span>
                                                  <span className="font-mono text-slate-400">
                                                    {p.range_nM[0] < 1000 ? `${p.range_nM[0].toFixed(1)}` : `${(p.range_nM[0] / 1000).toFixed(2)}k`}
                                                    –
                                                    {p.range_nM[1] < 1000 ? `${p.range_nM[1].toFixed(1)} nM` : `${(p.range_nM[1] / 1000).toFixed(2)} µM`}
                                                  </span>
                                                  {dominantAssay && (
                                                    <span className="px-1 py-px rounded bg-violet-500/10 border border-violet-500/25 text-violet-300 font-mono text-[8px]">
                                                      {dominantAssay}
                                                    </span>
                                                  )}
                                                </div>
                                                <div className="flex items-center gap-1 col-span-2 flex-wrap">
                                                  <span className="text-slate-600">species</span>
                                                  {p.species.length === 0 ? (
                                                    <span className="text-slate-700 italic">unspecified</span>
                                                  ) : (
                                                    <>
                                                      {p.species.slice(0, 3).map(s => (
                                                        <span key={s} className={`px-1 py-px rounded text-[8px] font-mono ${s === "Homo sapiens" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25" : "bg-white/5 text-slate-500 border border-white/10"}`}>
                                                          {s === "Homo sapiens" ? "human" : s.split(" ")[0].toLowerCase()}
                                                        </span>
                                                      ))}
                                                      {humanShare >= 0.5 && p.species.length > 1 && (
                                                        <span className="text-[8px] text-emerald-500/70">{(humanShare * 100).toFixed(0)}% human</span>
                                                      )}
                                                    </>
                                                  )}
                                                </div>
                                                <div className="flex items-center gap-1 col-span-2">
                                                  <span className="text-slate-600">confidence</span>
                                                  <span className={`px-1 py-px rounded text-[8px] font-bold uppercase tracking-wider ${
                                                    p.confidence === "high"   ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" :
                                                    p.confidence === "medium" ? "bg-amber-500/15 text-amber-300 border border-amber-500/30" :
                                                                                "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                                                  }`}>
                                                    {p.confidence}
                                                  </span>
                                                </div>
                                              </div>
                                            )}
                                            {suppress && (
                                              <div className="flex items-start gap-1 px-1.5 py-1 rounded bg-rose-500/8 border border-rose-500/20">
                                                <Info className="w-3 h-3 text-rose-400 shrink-0 mt-px" />
                                                <span className="text-[9px] text-rose-300 leading-tight">
                                                  Insufficient experimental data — treat as exploratory. Point estimate suppressed in cascade calculations.
                                                </span>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })()}
                                      {/* PDB structure chips + similarity provenance */}
                                      {((sugg.pdbIds?.length ?? 0) > 0 || sugg.source === "chembl-similar") && (
                                        <div className="pt-1 border-t border-white/5 space-y-1">
                                          {(sugg.pdbIds?.length ?? 0) > 0 && (
                                            <div className="flex items-center gap-1 flex-wrap">
                                              <span className="text-[8px] uppercase tracking-wider text-slate-600 font-semibold">PDB</span>
                                              <span className="text-[8px] text-slate-700 font-mono">{sugg.pdbCount}×</span>
                                              {sugg.pdbIds!.slice(0, 6).map(pid => (
                                                <button
                                                  key={pid}
                                                  onClick={() => {
                                                    uniprotManual.current = true;
                                                    setUniprotAutoMode(false);
                                                    setUniprotId(sugg.uniprotId);
                                                    setPdbId(pid);
                                                    handleProteinFetch(sugg.uniprotId);
                                                  }}
                                                  className="px-1 py-px rounded bg-blue-500/10 border border-blue-500/25 text-blue-300 hover:bg-blue-500/20 hover:border-blue-500/40 text-[8px] font-mono transition-colors"
                                                  title={`Load PDB ${pid}`}
                                                >
                                                  {pid}
                                                </button>
                                              ))}
                                              {sugg.pdbCount! > 6 && (
                                                <span className="text-[8px] text-slate-600">+{sugg.pdbCount! - 6}</span>
                                              )}
                                            </div>
                                          )}
                                          {sugg.source === "chembl-similar" && sugg.similarityPct != null && (
                                            <div className="flex items-center gap-1 text-[8px]">
                                              <span className="px-1 py-px rounded bg-amber-500/10 border border-amber-500/25 text-amber-300 font-semibold uppercase tracking-wider">
                                                Inferred
                                              </span>
                                              <span className="text-slate-600">via {Math.round(sugg.similarityPct)}% similar molecule</span>
                                              {sugg.similarSourceChemblId && (
                                                <span className="text-slate-700 font-mono">({sugg.similarSourceChemblId})</span>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Result card */}
                        {proteinInfo && (
                          <div className="mt-2 bg-violet-500/5 border border-violet-500/20 rounded-lg p-2.5 space-y-2">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                              <span className="text-[11px] font-semibold text-emerald-300">{proteinInfo.gene} · {proteinInfo.name}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                              {[
                                { k: "Organism",      v: proteinInfo.organism },
                                { k: "Sequence",      v: `${proteinInfo.sequenceLength.toLocaleString()} aa` },
                                { k: "Active sites",  v: String(proteinInfo.activeSites) },
                                { k: "Binding sites", v: String(proteinInfo.bindingSites) },
                                { k: "PDB entries",   v: proteinInfo.pdbIds.length ? `${proteinInfo.pdbIds.length} structures` : "None" },
                                { k: "AlphaFold",     v: alphafoldData
                                    ? `pLDDT ${alphafoldData.meanPlddt.toFixed(0)}${alphafoldData.analysis ? ` · ${alphafoldData.analysis.qualityClass}` : ""}`
                                    : proteinInfo.alphafoldId ? "Available" : "N/A" },
                              ].map(({ k, v }) => (
                                <div key={k} className="flex justify-between">
                                  <span className="text-[9px] text-slate-600">{k}</span>
                                  <span className="text-[9px] text-slate-400 font-medium">{v}</span>
                                </div>
                              ))}
                            </div>
                            {/* Per-residue pLDDT analysis (disorder map + druggable folded core).
                                Only renders when `fetchAlphaFoldFull` succeeded in fetching+parsing
                                the AlphaFold PDB file. Critical for huge multi-domain targets where
                                the druggable core is buried inside an otherwise-disordered chain. */}
                            {alphafoldData?.analysis && (() => {
                              const a = alphafoldData.analysis!;
                              const qualityColor: Record<typeof a.qualityClass, string> = {
                                Excellent: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
                                Good:      "bg-cyan-500/15 border-cyan-500/30 text-cyan-300",
                                Fair:      "bg-amber-500/15 border-amber-500/30 text-amber-300",
                                Poor:      "bg-red-500/15 border-red-500/30 text-red-300",
                              };
                              const isHuge = proteinInfo.sequenceLength > 800;
                              const core = a.largestFoldedDomain;
                              return (
                                <div className="border-t border-white/5 pt-2 space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[9px] text-slate-600 uppercase tracking-wider">Structural quality</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${qualityColor[a.qualityClass]}`}>
                                      {a.qualityClass}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                                    <div className="flex justify-between">
                                      <span className="text-[9px] text-slate-600">Confident (≥70)</span>
                                      <span className="text-[9px] text-emerald-300 font-medium">{(a.confidentFraction * 100).toFixed(0)}%</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-[9px] text-slate-600">Disordered (&lt;50)</span>
                                      <span className="text-[9px] text-amber-300 font-medium">{(a.disorderedFraction * 100).toFixed(0)}%</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-[9px] text-slate-600">Folded domains</span>
                                      <span className="text-[9px] text-slate-400 font-medium">{a.foldedDomains.length}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-[9px] text-slate-600">Disorder regions</span>
                                      <span className="text-[9px] text-slate-400 font-medium">{a.disorderRegions.length}</span>
                                    </div>
                                  </div>
                                  {isHuge && core && (
                                    <div className="bg-violet-500/10 border border-violet-500/25 rounded px-2 py-1.5">
                                      <div className="text-[9px] text-violet-300 font-semibold mb-0.5">Druggable core domain</div>
                                      <div className="text-[10px] text-slate-300 font-mono">
                                        residues {core.start}–{core.end}
                                        <span className="text-slate-500"> · {core.length} aa · μpLDDT {core.meanPlddt}</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            {/* Paired druggability assessment.
                                LEFT  — rule-based score from /api/ai/protein
                                        (heuristic over binding-site count, active-site
                                        count, sequence length).
                                RIGHT — ESM-2 35M mean-pooled embedding → logistic
                                        regression head trained on ~80 well-drugged
                                        targets vs ~80 essential housekeeping proteins.
                                Methodologically independent — agreement / divergence
                                between the two acts as a confidence indicator.
                                Renders only when at least one side has data or is
                                in flight; both-failed silently hides this block. */}
                            {(proteinRule || proteinMl || proteinRuleLoading || proteinMlLoading) && (() => {
                              const ruleProb = proteinRule?.druggability?.druggability_score ?? null;
                              const ruleClass = proteinRule?.druggability?.druggability_class ?? null;
                              const mlProb = proteinMl?.prediction?.druggability_probability ?? null;
                              const mlClass = proteinMl?.prediction?.druggability_class ?? null;
                              const mlAvail = proteinMl?.ml_available !== false;

                              const classToTone = (cls: string | null): { color: string; tone: "good" | "mid" | "bad" | "none" } => {
                                if (!cls) return { color: "bg-slate-500/15 border-slate-500/30 text-slate-400", tone: "none" };
                                const lc = cls.toLowerCase();
                                if (lc.includes("high") || lc === "druggable") return { color: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300", tone: "good" };
                                if (lc.includes("moderate") || lc.includes("borderline")) return { color: "bg-amber-500/15 border-amber-500/30 text-amber-300", tone: "mid" };
                                if (lc.includes("low") || lc.includes("undruggable") || lc.includes("non-druggable")) return { color: "bg-red-500/15 border-red-500/30 text-red-300", tone: "bad" };
                                return { color: "bg-slate-500/15 border-slate-500/30 text-slate-400", tone: "none" };
                              };

                              const ruleStyle = classToTone(ruleClass);
                              const mlStyle = classToTone(mlClass);

                              // Agreement: only meaningful when both sides have produced a class.
                              let agreement: { label: string; color: string } | null = null;
                              if (ruleStyle.tone !== "none" && mlStyle.tone !== "none") {
                                if (ruleStyle.tone === mlStyle.tone) {
                                  agreement = { label: "Aligned", color: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300" };
                                } else {
                                  // Adjacent buckets (good/mid or mid/bad) → "Partial"; opposite (good/bad) → "Divergent".
                                  const tones = [ruleStyle.tone, mlStyle.tone].sort();
                                  const opposite = tones[0] === "bad" && tones[1] === "good";
                                  agreement = opposite
                                    ? { label: "Divergent", color: "bg-red-500/15 border-red-500/30 text-red-300" }
                                    : { label: "Partial", color: "bg-amber-500/15 border-amber-500/30 text-amber-300" };
                                }
                              }

                              const Side = ({ title, subtitle, prob, cls, style, loading, fallback, meta }: {
                                title: string;
                                subtitle: string;
                                prob: number | null;
                                cls: string | null;
                                style: { color: string };
                                loading: boolean;
                                fallback: boolean;
                                meta: string;
                              }) => (
                                <div className="bg-white/3 border border-white/10 rounded p-2 space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[9px] text-slate-500 uppercase tracking-wider">{title}</span>
                                    {cls && !fallback ? (
                                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${style.color}`}>{cls}</span>
                                    ) : loading ? (
                                      <RefreshCw className="w-2.5 h-2.5 text-slate-500 animate-spin" />
                                    ) : (
                                      <span className="px-1.5 py-0.5 rounded text-[9px] border bg-slate-500/15 border-slate-500/30 text-slate-500">N/A</span>
                                    )}
                                  </div>
                                  <div className="text-[9px] text-slate-600 leading-tight">{subtitle}</div>
                                  {prob != null && !fallback ? (
                                    <div className="flex items-baseline gap-1.5">
                                      <span className="text-[16px] font-mono font-semibold text-slate-200">{prob.toFixed(2)}</span>
                                      <span className="text-[9px] text-slate-600">probability</span>
                                    </div>
                                  ) : (
                                    <div className="text-[10px] text-slate-600 italic">
                                      {loading ? "Loading…" : fallback ? "Model unavailable" : "Awaiting"}
                                    </div>
                                  )}
                                  <div className="text-[8px] text-slate-700 font-mono leading-tight">{meta}</div>
                                </div>
                              );

                              return (
                                <div className="border-t border-white/5 pt-2 space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[9px] text-slate-600 uppercase tracking-wider">Druggability assessment</span>
                                    {agreement && (
                                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${agreement.color}`}>
                                        {agreement.label}
                                      </span>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <Side
                                      title="Rule-based"
                                      subtitle="Heuristic on binding/active sites"
                                      prob={ruleProb}
                                      cls={ruleClass}
                                      style={ruleStyle}
                                      loading={proteinRuleLoading && !proteinRule}
                                      fallback={false}
                                      meta="UniProt features → score"
                                    />
                                    <Side
                                      title="ML (ESM-2)"
                                      subtitle="35M-param protein LM + LR head"
                                      prob={mlProb}
                                      cls={mlClass}
                                      style={mlStyle}
                                      loading={proteinMlLoading && !proteinMl}
                                      fallback={!mlAvail}
                                      meta={proteinMl?.model_info?.performance?.cv_roc_auc_mean != null
                                        ? `CV ROC-AUC ${proteinMl.model_info.performance.cv_roc_auc_mean.toFixed(2)}`
                                        : "Sequence embedding → LR"}
                                    />
                                  </div>
                                  {proteinMl && !mlAvail && proteinMl.error && (
                                    <div className="text-[9px] text-amber-400/80 flex items-center gap-1">
                                      <Info className="w-3 h-3 shrink-0" />
                                      <span className="leading-tight">ML model: {proteinMl.error}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            {/* ── Binding affinity (paired view: ChEMBL similarity vs DeepDTA-style ML) ── */}
                            {smiles.trim() && uniprotId.trim() && (() => {
                              // ChEMBL side: filter the predictions array down to the
                              // currently selected UniProt — predictBinding(targetId)
                              // already strict-filters server-side, so we just take [0].
                              const chemblPred = bindingChembl?.predictions?.[0] ?? null;
                              // Branch on the explicit status returned by drug_target.predict_binding
                              // so we DON'T conflate biological "no near-neighbors" with
                              // infrastructure "ChEMBL service unreachable" (architect fix).
                              const chemblStatus: string | undefined = bindingChembl?.model_info?.status;
                              const chemblServiceDown = chemblStatus === "service_unreachable";
                              const chemblNoNeighbors =
                                !!bindingChembl &&
                                !chemblPred &&
                                (chemblStatus === "no_targets" ||
                                 chemblStatus === "requested_target_not_found");
                              const chemblUnknownEmpty =
                                !!bindingChembl &&
                                !chemblPred &&
                                !chemblServiceDown &&
                                !chemblNoNeighbors;

                              const chemblPic50: number | null = chemblPred?.estimated_pIC50 ?? null;
                              const chemblIc50nM: number | null = chemblPred?.estimated_IC50_nM ?? null;

                              const mlPkd: number | null = bindingMl?.prediction?.pKd_predicted ?? null;
                              const mlKdNM: number | null = bindingMl?.prediction?.Kd_nM ?? null;
                              const mlClass: string | null = bindingMl?.prediction?.affinity_class ?? null;
                              const mlAvailable = !!bindingMl?.ml_available;

                              // Δ-based agreement badge — only when BOTH sides give a number.
                              // Compares the ChEMBL pIC50 to the ML pKd (treated as comparable
                              // log-affinity scales for the consensus heuristic).
                              const delta =
                                chemblPic50 != null && mlPkd != null
                                  ? Math.abs(chemblPic50 - mlPkd)
                                  : null;
                              const agreement =
                                delta == null
                                  ? null
                                  : delta < 0.5
                                    ? { label: "Aligned",  color: "border-emerald-400/40 text-emerald-300 bg-emerald-400/10" }
                                    : delta < 1.5
                                      ? { label: "Partial", color: "border-amber-400/40 text-amber-300 bg-amber-400/10" }
                                      : { label: "Divergent", color: "border-rose-400/40 text-rose-300 bg-rose-400/10" };

                              const classColor = (cls: string | null) => {
                                if (cls === "High affinity") return "text-emerald-300";
                                if (cls === "Moderate affinity") return "text-cyan-300";
                                if (cls === "Weak affinity") return "text-amber-300";
                                if (cls === "Negligible") return "text-slate-400";
                                return "text-slate-300";
                              };
                              const fmtKd = (kd: number | null): string => {
                                if (kd == null) return "—";
                                if (kd < 1) return `${kd.toFixed(2)} nM`;
                                if (kd < 1000) return `${kd.toFixed(1)} nM`;
                                if (kd < 1_000_000) return `${(kd / 1000).toFixed(2)} µM`;
                                return `${(kd / 1_000_000).toFixed(2)} mM`;
                              };

                              return (
                                <div className="border-t border-white/5 pt-2 space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[9px] text-slate-600 uppercase tracking-wider">Binding affinity</span>
                                    {agreement && (
                                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${agreement.color}`}>
                                        {agreement.label}
                                      </span>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-2 gap-1.5">
                                    {/* Left cell — ChEMBL similarity */}
                                    <div className="rounded border border-white/5 bg-white/[0.02] p-1.5 space-y-0.5">
                                      <div className="text-[10px] text-slate-300 font-semibold leading-tight">ChEMBL similarity</div>
                                      <div className="text-[8px] text-slate-500 leading-tight">≥70% Tanimoto neighbors</div>
                                      {bindingChemblLoading && !bindingChembl ? (
                                        <div className="text-[10px] text-slate-500 italic">Loading…</div>
                                      ) : chemblPred ? (
                                        <>
                                          <div className="text-[14px] text-slate-100 font-mono tabular-nums leading-none mt-0.5">
                                            pIC50 {chemblPic50!.toFixed(2)}
                                          </div>
                                          <div className="text-[9px] text-slate-400 font-mono">IC50 ≈ {fmtKd(chemblIc50nM)}</div>
                                          <div className="text-[8px] text-slate-500">{chemblPred.confidence} confidence</div>
                                        </>
                                      ) : chemblServiceDown ? (
                                        <div className="text-[10px] text-amber-400/80 italic leading-tight">ChEMBL service unreachable — try again later</div>
                                      ) : chemblNoNeighbors ? (
                                        <div className="text-[10px] text-slate-500 italic leading-tight">No ChEMBL neighbors above 70% — ML side only</div>
                                      ) : chemblUnknownEmpty ? (
                                        <div className="text-[10px] text-slate-500 italic leading-tight">No ChEMBL data returned</div>
                                      ) : (
                                        <div className="text-[10px] text-slate-600 italic">Awaiting</div>
                                      )}
                                      <div className="text-[8px] text-slate-700 font-mono leading-tight">measured pIC50 aggregate</div>
                                    </div>
                                    {/* Right cell — DeepDTA-style ML */}
                                    <div className="rounded border border-white/5 bg-white/[0.02] p-1.5 space-y-0.5">
                                      <div className="text-[10px] text-slate-300 font-semibold leading-tight">ML (ESM-2 + Morgan)</div>
                                      <div className="text-[8px] text-slate-500 leading-tight">DeepDTA-style GBM regressor</div>
                                      {bindingMlLoading && !bindingMl ? (
                                        <div className="text-[10px] text-slate-500 italic">Loading…</div>
                                      ) : mlAvailable && mlPkd != null ? (
                                        <>
                                          <div className={`text-[14px] font-mono tabular-nums leading-none mt-0.5 ${classColor(mlClass)}`}>
                                            pKd {mlPkd.toFixed(2)}
                                          </div>
                                          <div className="text-[9px] text-slate-400 font-mono">Kd ≈ {fmtKd(mlKdNM)}</div>
                                          <div className={`text-[8px] ${classColor(mlClass)}`}>{mlClass}</div>
                                        </>
                                      ) : (
                                        <div className="text-[10px] text-slate-600 italic">Model unavailable</div>
                                      )}
                                      <div className="text-[8px] text-slate-700 font-mono leading-tight">
                                        {(() => {
                                          const perf = bindingMl?.model_info?.performance as
                                            | {
                                                cv_r2_mean?: number | null;
                                                cv_r2_std?: number | null;
                                                cv_grp_r2_mean?: number | null;
                                                cv_grp_r2_std?: number | null;
                                              }
                                            | undefined;
                                          if (!perf || perf.cv_r2_mean == null) return "1512-dim feature vector";
                                          // Show BOTH random KFold (optimistic, in-distribution) and
                                          // GroupKFold-by-UniProt (realistic, novel-target) with ±std,
                                          // so the user sees the small-N uncertainty honestly.
                                          const std = perf.cv_r2_std != null
                                            ? `±${perf.cv_r2_std.toFixed(2)}`
                                            : "";
                                          const grpStr = perf.cv_grp_r2_mean != null
                                            ? ` · grp R² ${perf.cv_grp_r2_mean.toFixed(2)}${
                                                perf.cv_grp_r2_std != null
                                                  ? `±${perf.cv_grp_r2_std.toFixed(2)}`
                                                  : ""
                                              }`
                                            : "";
                                          return `CV R² ${perf.cv_r2_mean.toFixed(2)}${std}${grpStr}`;
                                        })()}
                                      </div>
                                    </div>
                                  </div>
                                  {bindingMl && !mlAvailable && bindingMl.error && (
                                    <div className="text-[9px] text-amber-400/80 flex items-center gap-1">
                                      <Info className="w-3 h-3 shrink-0" />
                                      <span className="leading-tight">ML model: {bindingMl.error}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            {proteinInfo.pdbIds.length > 0 && (
                              <div>
                                <div className="text-[9px] text-slate-600 mb-1">
                                  Known crystal structures — click to load one into the PDB field below
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {proteinInfo.pdbIds.slice(0, 8).map(id => (
                                    <button key={id} onClick={() => setPdbId(id)}
                                      className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-all border ${
                                        pdbId === id
                                          ? "bg-violet-600/25 border-violet-500/40 text-violet-300"
                                          : "bg-white/5 border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20"
                                      }`}
                                    >{id}</button>
                                  ))}
                                  {proteinInfo.pdbIds.length > 8 && (
                                    <span className="text-[9px] text-slate-600 py-0.5">+{proteinInfo.pdbIds.length - 8} more</span>
                                  )}
                                </div>
                              </div>
                            )}
                            {proteinInfo.pdbIds.length === 0 && alphafoldData && (
                              <div className="text-[9px] text-blue-400 flex items-center gap-1">
                                <Info className="w-3 h-3" />
                                No experimental structure — AlphaFold prediction available (pLDDT {alphafoldData.meanPlddt.toFixed(0)})
                              </div>
                            )}
                          </div>
                        )}
                        {proteinError && (
                          <div className="mt-1.5 text-[10px] text-red-400 flex items-center gap-1.5">
                            <AlertTriangle className="w-3 h-3 shrink-0" /> {proteinError}
                          </div>
                        )}
                      </div>

                      {/* ── PDB Structure ID ─────────────────────────────── */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] text-slate-500 uppercase tracking-wider">PDB Structure ID</span>
                          <span className="text-[9px] text-slate-600">Auto-updates from UniProt</span>
                        </div>

                        <div className="relative">
                          <Input
                            value={pdbId}
                            onChange={e => setPdbId(e.target.value.toUpperCase())}
                            className="bg-white/5 border-white/10 text-white text-[12px] font-mono focus:border-blue-500/60 uppercase pr-9"
                            placeholder="4-letter PDB ID e.g. 4HJO"
                            maxLength={4}
                          />
                          {pdbLoading && (
                            <RefreshCw className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-blue-400 animate-spin" />
                          )}
                          {pdbStructure && !pdbLoading && (
                            <CheckCircle2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-blue-400" />
                          )}
                        </div>

                        <div className="mt-1.5 flex items-start gap-1">
                          <Info className="w-3 h-3 text-slate-600 shrink-0 mt-0.5" />
                          <span className="text-[9px] text-slate-600">
                            4-letter PDB accession (e.g. <span className="font-mono">4HJO</span> = EGFR with erlotinib). Auto-fetches structure metadata when you type. Find IDs at{" "}
                            <span className="text-blue-500">rcsb.org</span>. Updates automatically when you click a structure from the UniProt card above.
                          </span>
                        </div>

                        {pdbStructure && (
                          <div className="mt-2 bg-blue-500/5 border border-blue-500/20 rounded-lg p-2.5 space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <CheckCircle2 className="w-3 h-3 text-blue-400 shrink-0" />
                              <span className="text-[10px] font-medium text-blue-300 leading-tight">{pdbStructure.title}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                              {[
                                { k: "Method",     v: pdbStructure.method.replace(" DIFFRACTION", "") },
                                { k: "Resolution", v: pdbStructure.resolution != null ? `${pdbStructure.resolution.toFixed(2)} Å` : "—" },
                                { k: "Chains",     v: String(pdbStructure.chains) },
                                { k: "Released",   v: pdbStructure.releaseDate },
                              ].map(({ k, v }) => (
                                <div key={k} className="flex justify-between">
                                  <span className="text-[9px] text-slate-600">{k}</span>
                                  <span className="text-[9px] text-slate-400 font-medium">{v}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <FieldGroup label="Therapeutic Area Preset">
                        <Select value={therapeuticArea} onValueChange={setTherapeuticArea}>
                          <SelectTrigger className="bg-white/5 border-white/10 text-white text-[12px] focus:border-violet-500/60">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                            {["Oncology","CNS","Cardiovascular","Metabolic","Rare Disease","Infectious Disease","Immunology"].map(a => (
                              <SelectItem key={a} value={a} className="text-[12px] focus:bg-violet-600/20">{a}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FieldGroup>
                    </div>
                  </section>

                  <Separator className="bg-white/8" />

                  {/* 2.X Molecule ML Predictions — paired view, ADMET-grouped.
                      Solubility is the first row; future molecule-side models
                      (CYP, Caco-2, PPB, CL_int, BBB, Ames) drop into their
                      respective ADMET sub-headers without changing the card
                      structure. The card surfaces methodology independence by
                      always showing the rule-based and ML scores side by side
                      with a Δ-based consensus badge. */}
                  <section id="demo-molecule-ml">
                    <SectionHeader icon={Beaker} label="Molecule ML Predictions" />
                    <div className="text-[10px] text-slate-500 -mt-1 mb-2.5 leading-snug">
                      Independent ML second opinions paired with rule-based predictions.
                      Updates automatically as you edit the SMILES above.
                    </div>

                    {/* Solubility & Permeability ─────────────────────────── */}
                    {(() => {
                      const ruleLogS = solRule?.solubility?.logS_predicted ?? null;
                      const ruleClass = solRule?.solubility?.solubility_class ?? null;
                      const mlLogS = solMl?.prediction?.logS_predicted ?? null;
                      const mlClass = solMl?.prediction?.solubility_class ?? null;
                      const mlAvail = solMl?.ml_available !== false;

                      // Tone from logS (works for both rule + ML regardless of
                      // their slightly different class label strings).
                      const tone = (logs: number | null): "good" | "mid" | "bad" | "none" => {
                        if (logs == null) return "none";
                        if (logs > -2) return "good";
                        if (logs > -5) return "mid";
                        return "bad";
                      };
                      const toneStyle = (t: "good" | "mid" | "bad" | "none") =>
                        t === "good" ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                        : t === "mid" ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
                        : t === "bad" ? "bg-red-500/15 border-red-500/30 text-red-300"
                        : "bg-slate-500/15 border-slate-500/30 text-slate-400";

                      // Δ-logS-based consensus — more honest than label match
                      // since rule and ML use slightly different bucket schemes.
                      let consensus: { label: string; color: string; detail: string } | null = null;
                      if (ruleLogS != null && mlLogS != null) {
                        const d = Math.abs(ruleLogS - mlLogS);
                        if (d < 0.5) {
                          consensus = { label: "Aligned", color: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300", detail: `Δ ${d.toFixed(2)} logS` };
                        } else if (d < 1.5) {
                          consensus = { label: "Partial", color: "bg-amber-500/15 border-amber-500/30 text-amber-300", detail: `Δ ${d.toFixed(2)} logS` };
                        } else {
                          consensus = { label: "Divergent", color: "bg-red-500/15 border-red-500/30 text-red-300", detail: `Δ ${d.toFixed(2)} logS` };
                        }
                      }

                      const SolSide = ({ title, subtitle, logS, cls, t, loading, fallback, meta }: {
                        title: string; subtitle: string; logS: number | null; cls: string | null;
                        t: "good" | "mid" | "bad" | "none"; loading: boolean; fallback: boolean; meta: string;
                      }) => (
                        <div className="bg-white/3 border border-white/10 rounded p-2 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] text-slate-500 uppercase tracking-wider">{title}</span>
                            {cls && !fallback ? (
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${toneStyle(t)}`}>{cls}</span>
                            ) : loading ? (
                              <RefreshCw className="w-2.5 h-2.5 text-slate-500 animate-spin" />
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[9px] border bg-slate-500/15 border-slate-500/30 text-slate-500">N/A</span>
                            )}
                          </div>
                          <div className="text-[9px] text-slate-600 leading-tight">{subtitle}</div>
                          {logS != null && !fallback ? (
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-[16px] font-mono font-semibold text-slate-200">{logS >= 0 ? "+" : ""}{logS.toFixed(2)}</span>
                              <span className="text-[9px] text-slate-600">logS (mol/L)</span>
                            </div>
                          ) : (
                            <div className="text-[10px] text-slate-600 italic">
                              {loading ? "Loading…" : fallback ? "Model unavailable" : "Awaiting SMILES"}
                            </div>
                          )}
                          <div className="text-[8px] text-slate-700 font-mono leading-tight">{meta}</div>
                        </div>
                      );

                      return (
                        <div className="space-y-2.5">
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Solubility &amp; Permeability</span>
                                <span className="text-[9px] text-slate-600">aqueous logS</span>
                              </div>
                              {consensus && (
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${consensus.color}`}
                                  title={consensus.detail}>
                                  {consensus.label}
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                              <SolSide
                                title="Rule-based"
                                subtitle="Closed-form ESOL formula (Delaney 2004)"
                                logS={ruleLogS}
                                cls={ruleClass}
                                t={tone(ruleLogS)}
                                loading={solRuleLoading && !solRule}
                                fallback={false}
                                meta="logP/MW/RB/AP linear regression"
                              />
                              <SolSide
                                title="ML (Random Forest)"
                                subtitle="Morgan FP + 9 RDKit descriptors → RF regressor"
                                logS={mlLogS}
                                cls={mlClass}
                                t={tone(mlLogS)}
                                loading={solMlLoading && !solMl}
                                fallback={!mlAvail}
                                meta={solMl?.model_info?.performance?.cv_r2_mean != null
                                  ? `CV R² ${solMl.model_info.performance.cv_r2_mean.toFixed(2)} · RMSE ${solMl.model_info.performance.cv_rmse_mean?.toFixed(2) ?? "—"}`
                                  : "Trained on 136 curated compounds"}
                              />
                            </div>
                            {solMl && !mlAvail && solMl.error && (
                              <div className="mt-1 text-[9px] text-amber-400/80 flex items-center gap-1">
                                <Info className="w-3 h-3 shrink-0" />
                                <span className="leading-tight">ML model: {solMl.error}</span>
                              </div>
                            )}
                            {!smiles.trim() && (
                              <div className="mt-1 text-[9px] text-slate-600 italic">Enter a SMILES above to see paired predictions.</div>
                            )}
                            {smiles.trim() && rdkitReady && molProps && !molProps.isValid && (
                              <div className="mt-1 text-[9px] text-amber-400/80 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                <span className="leading-tight">SMILES invalid — predictions skipped.</span>
                              </div>
                            )}
                          </div>

                          {/* Placeholder ADMET sections — model scaffolding made
                              visible so the user knows where future models will
                              land. Kept intentionally minimal (no fake data). */}
                          {[
                            { name: "Distribution", note: "PPB, V_d, BBB" },
                            { name: "Metabolism", note: "CYP3A4 / 2D6 / 2C9 inhibition, CL_int" },
                            { name: "Toxicity", note: "Ames mutagenicity, hepatotoxicity (cardiotox already wired)" },
                          ].map(({ name, note }) => (
                            <div key={name} className="flex items-center justify-between border-t border-white/5 pt-2 opacity-50">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-500 uppercase tracking-wider">{name}</span>
                                <span className="text-[9px] text-slate-600">{note}</span>
                              </div>
                              <span className="text-[9px] text-slate-600 italic">More models coming</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </section>

                  <Separator className="bg-white/8" />

                  {/* 2.3 Simulation Options */}
                  <section id="demo-sim-options">
                    <SectionHeader icon={Settings2} label="Simulation Options" />
                    <div className="space-y-2.5">
                      <ToggleRow
                        label="ADMET Profiling"
                        description="Directional — supports in vitro assays"
                        value={admetOn}
                        onChange={setAdmetOn}
                      />
                      <ToggleRow
                        label="Binding Simulation"
                        description="ESM-2 + docking pipeline"
                        value={bindingOn}
                        onChange={setBindingOn}
                        disabled={!uniprotId}
                      />
                      <ToggleRow
                        label="Toxicity Signal Detection"
                        description="FAERS cross-reference"
                        value={toxOn}
                        onChange={setToxOn}
                      />
                      <ToggleRow
                        label="Behavioral Fingerprinting"
                        description="Multi-tissue · adds ~10s"
                        value={fingerprintOn}
                        onChange={setFingerprintOn}
                      />

                      {fingerprintOn && (
                        <div className="ml-4 pl-3 border-l border-violet-500/20">
                          <Label className="text-[10px] text-slate-500 uppercase tracking-wider">Tissue Types</Label>
                          <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                            {["Liver","Kidney","CNS","Cardiac","GI","Lung"].map(t => (
                              <button
                                key={t}
                                onClick={() => toggleTissue(t)}
                                className={`py-1 px-2 rounded text-[10px] font-medium border transition-all ${
                                  tissueTypes.includes(t)
                                    ? "bg-violet-600/20 border-violet-500/40 text-violet-300"
                                    : "border-white/10 text-slate-500 hover:border-white/20"
                                }`}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <FieldGroup label={`Confidence Threshold: ${confidenceThreshold[0].toFixed(2)}`}>
                        <Slider
                          value={confidenceThreshold}
                          onValueChange={setConfidenceThreshold}
                          min={0.5} max={0.95} step={0.05}
                          className="[&_[role=slider]]:bg-violet-500 [&_[role=slider]]:border-0"
                        />
                        <div className="flex justify-between text-[10px] text-slate-600 mt-0.5">
                          <span>0.50 Low</span><span>0.95 High</span>
                        </div>
                      </FieldGroup>
                    </div>
                  </section>

                  {/* Advanced / Batch Section */}
                  <CollapsibleSection
                    label="Batch Configuration"
                    open={batchOpen}
                    setOpen={setBatchOpen}
                  >
                    <div className="space-y-3 pt-1">
                      <FieldGroup label="Ranking Criteria">
                        <Select value={rankingCriteria} onValueChange={setRankingCriteria}>
                          <SelectTrigger className="bg-white/5 border-white/10 text-white text-[12px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                            {["QED Score","Toxicity Risk (ascending)","Binding Affinity","Composite (weighted)"].map(o => (
                              <SelectItem key={o} value={o.split(" ")[0]} className="text-[12px] focus:bg-violet-600/20">{o}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FieldGroup>
                      {rankingCriteria === "Composite" && (
                        <div className="space-y-2">
                          {["QED","Toxicity","Binding","SA"].map((w, i) => (
                            <div key={w} className="flex items-center gap-3">
                              <span className="text-[11px] text-slate-400 w-14">{w}</span>
                              <Slider
                                value={[compositeWeights[i]]}
                                onValueChange={vals => {
                                  const next = [...compositeWeights];
                                  next[i] = vals[0];
                                  setCompositeWeights(next);
                                }}
                                min={0} max={1} step={0.1}
                                className="flex-1 [&_[role=slider]]:bg-violet-500 [&_[role=slider]]:border-0"
                              />
                              <span className="text-[11px] text-slate-400 w-8 text-right">{compositeWeights[i].toFixed(1)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <FieldGroup label="Top-N Filter">
                        <Input
                          value={topN}
                          onChange={e => setTopN(e.target.value)}
                          type="number"
                          min={1} max={500}
                          className="bg-white/5 border-white/10 text-white text-[12px]"
                        />
                      </FieldGroup>
                    </div>
                  </CollapsibleSection>
                </div>

                {/* L1 → L2 Cascade Preview + Recommendations */}
                <div className="px-5 pb-3 space-y-3">
                  {/* Stage-Gate Cascade Decision (always visible — surfaces the gate verdict) */}
                  {(() => {
                    const g = cascadeGate;
                    const passed = g.canAutoCascade;
                    const overridden = !!cascadeOverride;
                    const headColor = passed ? "emerald" : overridden ? "amber" : "rose";
                    const headBg = passed ? "bg-emerald-500/8 border-emerald-500/25" :
                                   overridden ? "bg-amber-500/8 border-amber-500/25" :
                                                 "bg-rose-500/8 border-rose-500/25";
                    const headText = passed ? "text-emerald-300" : overridden ? "text-amber-300" : "text-rose-300";
                    return (
                      <div className={`rounded-xl border p-3 space-y-2 ${headBg}`}>
                        <div className="flex items-center gap-2">
                          {passed ? <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 text-${headColor}-400`} />
                                  : <Info             className={`w-3.5 h-3.5 shrink-0 text-${headColor}-400`} />}
                          <span className={`text-[11px] font-semibold ${headText}`}>
                            {passed ? "Stage-Gate: Auto-Cascade Permitted"
                                    : overridden ? "Stage-Gate: Manual Override Active"
                                                  : "Stage-Gate Review Required"}
                          </span>
                          <span className="ml-auto text-[9px] font-mono text-slate-500">
                            safetyMin {g.safetyMinScore.toFixed(2)} · avgNonSafety {g.avgNonSafetyScore.toFixed(2)}
                          </span>
                        </div>
                        <p className={`text-[10px] leading-relaxed ${passed ? "text-emerald-300/80" : overridden ? "text-amber-300/80" : "text-rose-300/85"}`}>
                          {g.reason}
                        </p>
                        {!passed && g.blockedBy.length > 0 && (
                          <div className="flex items-start gap-1 flex-wrap">
                            <span className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">Blocked by:</span>
                            {g.blockedBy.map(k => (
                              <span key={k} className={`px-1.5 py-px rounded text-[9px] font-mono ${tierChipClasses("heuristic")}`}>{k}</span>
                            ))}
                          </div>
                        )}
                        {/* Per-output quality detail (collapsed; one line per output) */}
                        <details className="text-[9px]">
                          <summary className="cursor-pointer text-slate-500 hover:text-slate-300">Per-output quality detail</summary>
                          <div className="mt-1.5 space-y-0.5 pl-2 border-l border-white/5">
                            {Object.entries(g.detail).map(([k, v]) => (
                              <div key={k} className="flex items-center gap-2">
                                <span className={`px-1 py-px rounded border text-[8px] font-bold uppercase ${tierChipClasses(v.tier)}`}>{tierLabel(v.tier)}</span>
                                <span className="font-mono text-slate-400">{k}</span>
                                <span className="text-slate-600 italic">— {v.note}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                        {!passed && !overridden && simResults && !overrideFormOpen && (
                          <button
                            onClick={() => setOverrideFormOpen(true)}
                            data-testid="cascade-override-button"
                            className="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-200 hover:bg-rose-500/25 text-[10px] font-semibold transition-colors"
                          >
                            Override & advance to L2
                          </button>
                        )}
                        {!passed && !overridden && simResults && overrideFormOpen && (
                          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5 space-y-2">
                            <div className="text-[10px] font-semibold text-rose-200">
                              Justification (logged to provenance):
                            </div>
                            <textarea
                              value={overrideJustification}
                              onChange={e => setOverrideJustification(e.target.value)}
                              rows={3}
                              className="w-full text-[10px] font-mono bg-slate-950/60 border border-white/10 rounded p-1.5 text-slate-200 focus:outline-none focus:border-rose-400/40 resize-none"
                              placeholder="Why are you overriding the stage-gate?"
                              autoFocus
                              data-testid="cascade-override-justification"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  const j = overrideJustification.trim();
                                  if (!j) return;
                                  const reviewer = (typeof window !== "undefined" && window.localStorage?.getItem("hakase.reviewer")) || "anonymous";
                                  const rec = recordCascadeOverride(g, reviewer, j);
                                  setCascadeOverride(rec);
                                  setOverrideFormOpen(false);
                                  const prov = createProvenance("cascadeGate.ts", "browser", smiles);
                                  prov.databaseQueries = [{ database: "Cascade gate override", status: "skipped" }];
                                  setHAIOpsCtx(prev => mergeLayerProvenance(addOverride(prev, {
                                    fromLayer: 1,
                                    toLayer: 2,
                                    verdict: "OVERRIDE_CASCADE_GATE",
                                    timestamp: rec.timestamp,
                                    reason: `${rec.reviewer}: ${rec.justification} — blockedBy=[${rec.blockedBy.join(", ")}] safetyMin=${rec.safetyMinScore.toFixed(2)} avgNonSafety=${rec.avgNonSafetyScore.toFixed(2)}`,
                                  }), 1, prov));
                                }}
                                disabled={!overrideJustification.trim()}
                                data-testid="cascade-override-confirm"
                                className="px-2.5 py-1 rounded-lg bg-rose-500/25 border border-rose-500/40 text-rose-100 hover:bg-rose-500/35 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-semibold transition-colors"
                              >
                                Confirm override
                              </button>
                              <button
                                onClick={() => setOverrideFormOpen(false)}
                                className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 text-[10px] font-semibold transition-colors"
                              >
                                Cancel
                              </button>
                              <span className="ml-auto text-[9px] font-mono text-slate-500">
                                reviewer: {(typeof window !== "undefined" && window.localStorage?.getItem("hakase.reviewer")) || "anonymous"}
                              </span>
                            </div>
                          </div>
                        )}
                        {overridden && cascadeOverride && (
                          <div className="text-[9px] text-amber-400/80 font-mono">
                            Override logged at {new Date(cascadeOverride.timestamp).toLocaleTimeString()} by {cascadeOverride.reviewer} — “{cascadeOverride.justification}”
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <div className="rounded-xl border border-violet-500/25 bg-violet-500/6 p-3.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <ArrowRight className="w-3 h-3 text-violet-400 shrink-0" />
                      <span className="text-[11px] font-semibold text-violet-300">L1 → L2 Cascade Preview</span>
                    </div>
                    <p className="text-[10px] text-slate-500">These in vitro properties will auto-populate Layer 2 Animal Cohort configuration:</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                      {[
                        ["MW",         simResults ? `${simResults.lipinski.mw.toFixed(0)} Da`                      : "pending"],
                        ["LogP",       simResults ? simResults.lipinski.logP.toFixed(2)                              : "pending"],
                        ["TPSA",       simResults ? `${simResults.lipinski.tpsa.toFixed(0)} Å²`                     : "pending"],
                        ["Absorption", simResults ? `${(simResults.admet.absorption * 100).toFixed(0)}%`             : "pending"],
                        ["Toxicity",   simResults ? `${(simResults.admet.toxicity   * 100).toFixed(0)}%`             : "pending"],
                        ["Go/No-Go",   simResults ? simResults.goNogo                                                 : "pending"],
                      ].map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-1">
                          <span className="text-slate-500">{k}</span>
                          <span className={v === "pending" ? "text-slate-600 italic" : "text-violet-300 font-semibold"}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* L1 Recommendations */}
                  {(() => {
                    const recs: Array<{text: string; level: "warn" | "ok" | "info"}> = [];
                    if (!smiles)       recs.push({ text: "Enter a SMILES string to begin in vitro simulation.", level: "info" });
                    else if (!uniprotId) recs.push({ text: "Add a UniProt ID for binding affinity and selectivity scoring.", level: "info" });
                    if (simResults) {
                      if (simResults.admet.toxicity > 0.6)    recs.push({ text: "High toxicity signal — consider structural optimization to reduce hERG/CYP3A4 liability before animal studies.", level: "warn" });
                      if (simResults.lipinski.logP > 5)        recs.push({ text: "LogP > 5 exceeds Lipinski limit — oral bioavailability may be low. Plan formulation strategies for L3 Animal Cohort.", level: "warn" });
                      if (simResults.lipinski.mw > 500)        recs.push({ text: "MW > 500 Da — consider lead optimization to improve membrane permeability.", level: "warn" });
                      if (simResults.admet.absorption < 0.45)  recs.push({ text: "Low predicted absorption — review TPSA and HBD count. Bioisostere substitutions may improve F%.", level: "warn" });
                      if (recs.filter(r => r.level === "warn").length === 0) recs.push({ text: "Clean physicochemical profile — well-positioned to advance into L2 In Silico triage.", level: "ok" });
                      if (simResults.goNogo === "GO")     recs.push({ text: "GO decision — advance to L2 Confirmation to reconcile in-silico/ex-vivo evidence before committing to L3 Animal Cohort spend.", level: "ok" });
                      else if (simResults.goNogo === "WATCH") recs.push({ text: "WATCH decision — proceed with caution into L2 In Silico and monitor flagged liabilities through to L4.", level: "info" });
                    }
                    if (recs.length === 0) return null;
                    return (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Recommendations</p>
                        {recs.map((r, i) => (
                          <div key={i} className={`rounded-lg px-3 py-2 text-[10px] leading-relaxed border ${
                            r.level === "warn" ? "bg-amber-500/8 border-amber-500/20 text-amber-300" :
                            r.level === "ok"   ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-300" :
                                                 "bg-blue-500/8 border-blue-500/20 text-blue-300"
                          }`}>{r.text}</div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* Run Button */}
                <div id="demo-run-l1" className="p-5 border-t border-white/8 mt-auto">
                  <Button
                    onClick={runSimulation}
                    disabled={!rdkitReady || simStatus[1] === "running" || !smiles || (molProps !== null && !molProps.isValid)}
                    className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold h-10 gap-2 text-[13px] disabled:opacity-50"
                  >
                    {simStatus[1] === "running" ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Simulating…</>
                    ) : !rdkitReady ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Loading chemistry engine…</>
                    ) : (
                      <><Play className="w-4 h-4" /> Run In Vitro Simulation</>
                    )}
                  </Button>
                  <p className="text-[10px] text-slate-600 text-center mt-2">
                    {!rdkitReady ? "Initialising RDKit.js — please wait" : "Est. runtime: 5–30 seconds"}
                  </p>
                </div>
              </div>

              {/* Output Panel — Layer 1 */}
              <div id="demo-results" className="flex-1 overflow-y-auto p-5">
                {simStatus[1] === "idle" && (
                  <div className="flex flex-col items-center justify-center h-full gap-6">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                        <TestTube2 className="w-7 h-7 text-violet-400/50" />
                      </div>
                      <div className="text-center">
                        <div className="text-[14px] font-medium text-slate-400">No simulation results yet</div>
                        <div className="text-[11px] text-slate-600 mt-1 max-w-xs">Configure your in vitro inputs on the left and run the simulation to see ADMET predictions, binding analysis, and toxicity signals.</div>
                      </div>
                    </div>

                    {smiles && (
                      <div className="flex flex-col items-center gap-2">
                        <div className="text-[10px] text-slate-600 uppercase tracking-wider">Visualize Structure</div>
                        <div className="flex gap-2">
                          {(["cinematic","scientific","explorer"] as const).map((mode) => {
                            const labels = { cinematic: "Cinematic", scientific: "Scientific", explorer: "Explorer" };
                            const icons = { cinematic: "🎬", scientific: "🔬", explorer: "🧬" };
                            return (
                              <button
                                key={mode}
                                onClick={() => { setViewer3DMode(mode); setViewer3DOpen(true); }}
                                className="flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl bg-white/4 border border-white/8 hover:border-violet-500/40 hover:bg-violet-500/5 transition-all group"
                              >
                                <span className="text-xl">{icons[mode]}</span>
                                <span className="text-[11px] font-medium text-slate-400 group-hover:text-violet-300 transition-colors">{labels[mode]}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {simStatus[1] === "running" && (
                  <div className="flex flex-col items-center justify-center h-full gap-4">
                    <div className="w-16 h-16 rounded-full bg-violet-500/10 border border-violet-500/30 flex items-center justify-center">
                      <Atom className="w-8 h-8 text-violet-400 animate-spin" style={{ animationDuration: "3s" }} />
                    </div>
                    <div className="text-[14px] font-medium text-white">Running In Vitro Simulation</div>
                    <Progress value={simProgress} className="w-64 h-2 bg-white/10" />
                    <p className="text-[11px] text-slate-500">ADMET prediction · Binding analysis · Toxicity screening</p>
                  </div>
                )}

                {simStatus[1] === "complete" && (
                  <>
                    {/* 3D Viewer launcher — always visible after simulation */}
                    <div className="flex items-center gap-2 mb-4 pb-4 border-b border-white/8">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider mr-1">View 3D</span>
                      {(["cinematic","scientific","explorer"] as const).map((mode) => {
                        const labels = { cinematic: "Cinematic", scientific: "Scientific", explorer: "Explorer" };
                        const icons = { cinematic: "🎬", scientific: "🔬", explorer: "🧬" };
                        return (
                          <button
                            key={mode}
                            onClick={() => { setViewer3DMode(mode); setViewer3DOpen(true); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:border-violet-500/50 hover:bg-violet-500/10 transition-all group"
                          >
                            <span className="text-base">{icons[mode]}</span>
                            <span className="text-[11px] font-medium text-slate-400 group-hover:text-violet-300 transition-colors">{labels[mode]}</span>
                          </button>
                        );
                      })}
                    </div>
                    <Layer1Results
                      smiles={smiles}
                      molProps={molProps}
                      simResults={simResults}
                      inVitroResults={inVitroResults}
                      indication={indication}
                      l1AiReport={l1AiReport}
                      l1AiLoading={l1AiLoading}
                      l1AiError={l1AiError}
                      l1AiStream={l1AiStream}
                      runL1AiAnalysis={runL1AiAnalysis}
                      uniprotId={uniprotId}
                      pdbId={pdbId}
                      alphafoldPlddt={alphafoldData?.meanPlddt ?? null}
                      proteinName={proteinInfo?.name ?? ""}
                      bindingOn={bindingOn}
                      toxOn={toxOn}
                      confidenceThreshold={confidenceThreshold}
                      safetyFlags={safetyFlags}
                      flagsAcknowledged={haIOpsCtx.reviewAcknowledged}
                      onAcknowledgeFlags={() => setHAIOpsCtx(prev => acknowledgeReview(prev))}
                      topTarget={targetSuggestions[0] ?? null}
                      therapeuticArea={therapeuticArea}
                    />
                    {safetyFlags.filter(f => f.originLayer === 1).length > 0 && (
                      <SafetyFlagCascadeBanner flags={safetyFlags.filter(f => f.originLayer === 1)} layerLabel="Layer 1" />
                    )}
                    <ReviewAcknowledgmentButton
                      flags={safetyFlags.filter(f => f.originLayer === 1)}
                      acknowledged={haIOpsCtx.reviewAcknowledged}
                      onAcknowledge={() => setHAIOpsCtx(prev => acknowledgeReview(prev))}
                    />
                    <GracefulDegradationBanner warnings={dbDegradationWarnings.filter(w => (provenanceL1?.databaseQueries ?? []).some(q => q.database === w.database))} />
                    <CrossSourceConsistencyCheck simIC50_uM={inVitroResults ? inVitroResults.doseResponse.ic50_nM / 1000 : null} bindingDB={extBindingDB} />
                    {provenanceL1 && <ProvenanceFooter provenance={provenanceL1} layer={1} />}
                    <div className="px-6 pb-6">
                      <ExternalDbPanel
                        layer={1}
                        loading={extDbLoading}
                        extBindingDB={extBindingDB}
                        extChEMBL={extChEMBL}
                        extString={extString}
                        extKEGG={extKEGG}
                        extReactome={extReactome}
                        extOpenTargets={extOpenTargets}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Layer 2 — Confirmation (May 2026 restructure)
              Reconciles in-silico predictions and ex-vivo measurements into a
              single ConfirmationPackage before animal cohort design. The two
              existing scaffolds (in-silico, ex-vivo) live here as sub-tracks. */}
          {activeLayer === 2 && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Confirmation framing header */}
              <div className="border-b border-white/8 bg-cyan-950/15 px-5 py-3 flex items-center gap-3 shrink-0">
                <div className="w-7 h-7 rounded-md bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                  <FlaskConical className="w-3.5 h-3.5 text-cyan-300" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-cyan-300 uppercase tracking-widest">Layer 2</span>
                    <h2 className="text-[14px] font-semibold text-white">Confirmation</h2>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                    In-silico ↔ ex-vivo joint synthesis · evidence reconciliation before L3 Animal Cohort
                  </p>
                </div>
                {/* Sub-track tabs */}
                <div className="ml-auto flex items-center gap-0.5 rounded-full bg-white/5 border border-white/10 p-0.5 shrink-0">
                  <button
                    onClick={() => setConfirmationSubTrack("insilico")}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${
                      confirmationSubTrack === "insilico"
                        ? "bg-cyan-600/30 text-cyan-200 border border-cyan-500/40"
                        : "text-slate-400 hover:text-slate-200 border border-transparent"
                    }`}
                  >
                    <Cpu className="w-3 h-3" /> In-Silico sub-track
                  </button>
                  <button
                    onClick={() => setConfirmationSubTrack("exvivo")}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${
                      confirmationSubTrack === "exvivo"
                        ? "bg-cyan-600/30 text-cyan-200 border border-cyan-500/40"
                        : "text-slate-400 hover:text-slate-200 border border-transparent"
                    }`}
                  >
                    <Microscope className="w-3 h-3" /> Ex-Vivo sub-track
                  </button>
                </div>
              </div>
              {/* Active sub-track */}
              <div className="flex-1 overflow-hidden flex flex-col">
                {confirmationSubTrack === "insilico" ? (
                  <Layer2InSilicoScaffold
                    layer1Ready={simStatus[1] === "complete"}
                    simResults={simResults}
                    inVitroResults={inVitroResults}
                    onContinue={() => setActiveLayer(3)}
                    onComplete={() => setSimStatus(prev => ({ ...prev, 2: "complete" }))}
                  />
                ) : (
                  <Layer3ExVivoScaffold
                    layer2Ready={simStatus[2] === "complete"}
                    simResults={simResults}
                    inVitroResults={inVitroResults}
                    onContinue={() => setActiveLayer(3)}
                  />
                )}
              </div>
            </div>
          )}

          {/* Layer 3 — Animal Cohort (relocated from former internal slot 2,
              then moved from slot 4 → slot 3 in May 2026 restructure)
              Same simulation logic — only the slot index moved. ICH M3(R2)
              battery, GLP-grade, hands off to L4 First In Human downstream. */}
          {activeLayer === 3 && (
            <div className="flex-1 flex overflow-hidden">
              <div className="w-[460px] border-r border-white/8 overflow-y-auto flex flex-col">
                <div className="p-5 border-b border-white/8">
                  <div className="flex items-center gap-2 mb-1">
                    <Rabbit className="w-4 h-4 text-emerald-400" />
                    <h2 className="text-[15px] font-semibold text-white">Layer 3 — Animal Cohort</h2>
                  </div>
                  <p className="text-[12px] text-slate-500">ICH M3(R2) rodent + non-rodent battery · PBPK allometric scaling · FIH dose projection</p>
                </div>

                <div className="flex-1 p-5 space-y-6">
                  {/* L2 Recommendations — dynamic, at top */}
                  {(() => {
                    const recs: Array<{text: string; level: "warn" | "ok" | "info"}> = [];
                    if (!simResults) {
                      recs.push({ text: "Run Layer 1 (In Vitro) first to unlock animal PK simulation.", level: "info" });
                    } else {
                      const toxPct = (simResults.admet.toxicity * 100).toFixed(0);
                      const absPct = (simResults.admet.absorption * 100).toFixed(0);
                      const logP = simResults.lipinski.logP;
                      const mw = simResults.lipinski.mw;
                      if (simResults.admet.toxicity > 0.6) recs.push({ text: `L1 toxicity is ${toxPct}% (threshold 60%) — choose a species with higher metabolic tolerance (e.g. beagle dog) and use a conservative starting dose (1/20 NOAEL instead of 1/10).`, level: "warn" });
                      if (logP > 5)    recs.push({ text: `LogP = ${logP.toFixed(2)} exceeds Lipinski limit (>5). Aqueous solubility will be poor — consider lipid-based nano-emulsion or amorphous solid dispersion formulations for this study.`, level: "warn" });
                      if (logP < 0)    recs.push({ text: `LogP = ${logP.toFixed(2)} (very hydrophilic) — tissue penetration may be limited. IV dosing will give cleaner PK data than oral gavage.`, level: "info" });
                      if (simResults.admet.absorption < 0.45)  recs.push({ text: `Predicted absorption is only ${absPct}% — oral bioavailability will be low. Consider IV or IP route, or formulation enhancement to improve exposure.`, level: "warn" });
                      if (mw > 500) recs.push({ text: `MW = ${mw.toFixed(0)} Da exceeds 500 Da — membrane permeability may limit oral absorption. BCS Class II/IV formulations recommended.`, level: "warn" });
                      if (simResults.goNogo === "NO-GO")   recs.push({ text: `L1 returned NO-GO (toxicity ${toxPct}%, absorption ${absPct}%). Animal study data may support re-assessment only if liabilities are formulation-addressable.`, level: "warn" });
                      if (simResults.goNogo === "GO" && simResults.admet.toxicity <= 0.6) recs.push({ text: `L1 returned GO with clean profile (toxicity ${toxPct}%, absorption ${absPct}%). Standard allometric scaling and 1/10 HED starting dose apply.`, level: "ok" });
                      if (simResults.goNogo === "WATCH") recs.push({ text: `L1 returned WATCH (toxicity ${toxPct}%, absorption ${absPct}%). Proceed with enhanced monitoring — plan additional satellite groups for TK sampling.`, level: "info" });
                      if (l2AutoConfigured) {
                        const configParts: string[] = [];
                        if (!l2ManualOverride.current.species) {
                          const spName = SPECIES_LIST.find(s => s.id === animalSpecies)?.displayName ?? animalSpecies;
                          configParts.push(`Species → ${spName}`);
                        }
                        if (!l2ManualOverride.current.study) {
                          const stName = STUDY_TYPE_LIST.find(s => s.id === animalStudyType)?.label ?? animalStudyType;
                          configParts.push(`Study → ${stName}`);
                        }
                        if (!l2ManualOverride.current.route) configParts.push(`Route → ${animalRoute}`);
                        if (!l2ManualOverride.current.formulation && animalRoute === "Oral") {
                          const fName = FORMULATION_LIST.find(f => f.id === animalFormulation)?.label ?? animalFormulation;
                          configParts.push(`Formulation → ${fName}`);
                        }
                        if (configParts.length > 0) {
                          recs.push({ text: `Auto-configured from L1 data: ${configParts.join(" · ")}. Click any option to override.`, level: "info" });
                        }
                      }
                    }
                    if (animalResults) {
                      const halfLife = animalResults.humanHalfLife;
                      const formF = animalResults.formulationResult.formulatedF;
                      const noael = animalResults.noael;
                      const fih = animalResults.fihDoseMgKg;
                      const margin = noael / Math.max(fih, 0.001);
                      if (halfLife < 2)   recs.push({ text: `Projected human t½ = ${halfLife.toFixed(1)} h (very short) — multiple daily doses or modified-release formulation will be required in clinical development.`, level: "warn" });
                      if (halfLife > 24)  recs.push({ text: `Projected human t½ = ${halfLife.toFixed(1)} h — QD dosing is feasible. Monitor for accumulation in renally-impaired populations in L3.`, level: "ok" });
                      if (formF < 0.4) recs.push({ text: `Formulated bioavailability = ${(formF * 100).toFixed(0)}% (below 40% threshold) — explore nanocrystal, solid dispersion, or SEDDS formulation strategies.`, level: "warn" });
                      if (margin < 3) recs.push({ text: `Narrow NOAEL safety margin: ${margin.toFixed(1)}× (NOAEL ${noael.toFixed(1)} mg/kg vs FIH ${fih.toFixed(3)} mg/kg). Threshold is 3×. Consider a more conservative starting dose in L3.`, level: "warn" });
                      if (recs.filter(r => r.level === "warn").length === 0) recs.push({ text: `Animal PK complete — all parameters within acceptable ranges. Pre-clinical package ready for handoff to Hakase Clinical (Phase 1 design) with full allometric scaling and tissue-selectivity dossier attached.`, level: "ok" });
                    }
                    if (recs.length === 0) return null;
                    return (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-widest flex items-center gap-1.5">
                          <AlertTriangle className="w-3 h-3" />
                          Recommendations
                        </p>
                        {recs.map((r, i) => (
                          <div key={i} className={`rounded-lg px-3 py-2 text-[10px] leading-relaxed border ${
                            r.level === "warn" ? "bg-amber-500/8 border-amber-500/20 text-amber-300" :
                            r.level === "ok"   ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-300" :
                                                 "bg-blue-500/8 border-blue-500/20 text-blue-300"
                          }`}>{r.text}</div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Species Selection */}
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <TestTube2 className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-[12px] font-semibold text-slate-300 uppercase tracking-widest">Species Selection</span>
                      {l2AutoConfigured && !l2ManualOverride.current.species && (
                        <span className="text-[8px] bg-violet-500/15 text-violet-400 border border-violet-500/25 px-1.5 py-0.5 rounded font-semibold">L1 Auto</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {SPECIES_LIST.map(sp => (
                        <button
                          key={sp.id}
                          onClick={() => { l2ManualOverride.current.species = true; setAnimalSpecies(sp.id); }}
                          className={`p-3 rounded-lg border text-left transition-all ${
                            animalSpecies === sp.id
                              ? "bg-amber-500/10 border-amber-500/40 text-amber-300"
                              : "bg-white/3 border-white/8 text-slate-400 hover:border-white/20 hover:text-slate-200"
                          }`}
                        >
                          <div className="text-[12px] font-semibold">{sp.species}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{sp.strain}</div>
                          <div className="text-[9px] text-slate-600 mt-1 leading-tight">{sp.regulatory}</div>
                        </button>
                      ))}
                    </div>
                    {animalSpecies && (
                      <div className="mt-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/15">
                        <div className="text-[10px] text-amber-400 font-semibold mb-1">FDA Km factor: {SPECIES_LIST.find(s => s.id === animalSpecies)?.kmFactor} · Body weight: {((SPECIES_LIST.find(s => s.id === animalSpecies)?.bodyWeight ?? 0) * 1000).toFixed(0)} g</div>
                        <div className="text-[10px] text-slate-500">{SPECIES_LIST.find(s => s.id === animalSpecies)?.regulatory}</div>
                      </div>
                    )}
                  </section>

                  {/* Study Type */}
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-[12px] font-semibold text-slate-300 uppercase tracking-widest">Study Design</span>
                      {l2AutoConfigured && !l2ManualOverride.current.study && (
                        <span className="text-[8px] bg-violet-500/15 text-violet-400 border border-violet-500/25 px-1.5 py-0.5 rounded font-semibold">L1 Auto</span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {STUDY_TYPE_LIST.map(st => (
                        <button
                          key={st.id}
                          onClick={() => { l2ManualOverride.current.study = true; setAnimalStudyType(st.id); }}
                          className={`w-full p-3 rounded-lg border text-left transition-all ${
                            animalStudyType === st.id
                              ? "bg-amber-500/10 border-amber-500/40"
                              : "bg-white/3 border-white/8 hover:border-white/20"
                          }`}
                        >
                          <div className={`text-[12px] font-semibold ${animalStudyType === st.id ? "text-amber-300" : "text-slate-300"}`}>{st.label}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{st.oecd} · {st.ich}</div>
                          <div className="text-[10px] text-slate-600 mt-1">
                            Rodent: {st.animalsPerSexRodent}/sex · Non-rodent: {st.animalsPerSexNonRodent}/sex
                            {st.recoveryGroup && " · Recovery group"}
                            {st.satelliteTK && " · Satellite TK"}
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Route of Administration */}
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <Activity className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-[12px] font-semibold text-slate-300 uppercase tracking-widest">Route of Administration</span>
                      {l2AutoConfigured && !l2ManualOverride.current.route && (
                        <span className="text-[8px] bg-violet-500/15 text-violet-400 border border-violet-500/25 px-1.5 py-0.5 rounded font-semibold">L1 Auto</span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {["Oral", "IV", "SC", "IM", "Topical", "Inhalation"].map(r => (
                        <button
                          key={r}
                          onClick={() => { l2ManualOverride.current.route = true; setAnimalRoute(r); }}
                          className={`py-2 px-3 rounded-lg border text-[11px] font-medium transition-all ${
                            animalRoute === r
                              ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                              : "bg-white/3 border-white/8 text-slate-400 hover:border-white/20"
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Formulation Type — BCS-aware */}
                  {animalRoute === "Oral" && (
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-[12px] font-semibold text-slate-300 uppercase tracking-widest">Formulation / Drug Delivery</span>
                        <span className="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded font-semibold">FDA IIG</span>
                        {l2AutoConfigured && !l2ManualOverride.current.formulation && (
                          <span className="text-[8px] bg-violet-500/15 text-violet-400 border border-violet-500/25 px-1.5 py-0.5 rounded font-semibold">L1 Auto</span>
                        )}
                      </div>
                      <div className="space-y-2">
                        {FORMULATION_LIST.map(f => (
                          <button
                            key={f.id}
                            onClick={() => { l2ManualOverride.current.formulation = true; setAnimalFormulation(f.id); }}
                            className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                              animalFormulation === f.id
                                ? "bg-amber-500/10 border-amber-500/35 text-amber-200"
                                : "bg-white/[0.02] border-white/8 text-slate-400 hover:border-white/20"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold">{f.label}</span>
                              {f.bestFor.includes("II") && (
                                <span className="text-[8px] bg-amber-500/20 text-amber-400 px-1 rounded">BCS II/IV</span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{f.keyExcipients.slice(0, 2).join(" · ")}</div>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* L1 → L4 Cascade Applied (L2 / L3 are scaffolds — animal sim consumes L1 directly) */}
                  <div className="rounded-xl border border-violet-500/25 bg-violet-500/6 p-3.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-violet-400 shrink-0" />
                      <span className="text-[11px] font-semibold text-violet-300">
                        {simResults ? "Layer 1 → Layer 3 Cascade Applied" : "Layer 1 → Layer 3 Cascade Pending"}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      {simResults
                        ? `In vitro results from ${simResults.molName} are informing this animal simulation:`
                        : "Complete Layer 1 (In Vitro) first. Assay results will auto-populate animal PK parameters."}
                    </p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
                      {[
                        ["Compound",   simResults ? simResults.molName                                        : "–"],
                        ["MW",         simResults ? `${simResults.lipinski.mw.toFixed(0)} Da`                 : "–"],
                        ["LogP",       simResults ? simResults.lipinski.logP.toFixed(2)                        : "–"],
                        ["TPSA",       simResults ? `${simResults.lipinski.tpsa.toFixed(0)} Å²`               : "–"],
                        ["Absorption", simResults ? `${(simResults.admet.absorption * 100).toFixed(0)}%`       : "–"],
                        ["Go/No-Go",   simResults ? simResults.goNogo                                           : "–"],
                      ].map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-1">
                          <span className="text-slate-500">{k}</span>
                          <span className={v === "–" ? "text-slate-600" : "text-violet-300 font-semibold"}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>

                <div id="demo-run-l2" className="p-5 border-t border-white/8 mt-auto">
                  {/* Cascade-gate enforcement: block L2 advance unless gate passes or user has overridden */}
                  {simResults && !cascadeGate.canAutoCascade && !cascadeOverride && (
                    <div className="mb-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 flex items-start gap-1.5">
                      <Info className="w-3 h-3 text-rose-400 shrink-0 mt-0.5" />
                      <span className="text-[9px] text-rose-300 leading-tight">
                        Stage-gate review required before running L3 Animal Cohort. Return to Layer 1 and acknowledge the gate banner.
                      </span>
                    </div>
                  )}
                  <Button
                    onClick={runSimulation}
                    disabled={simStatus[3] === "running" || !simResults || (!cascadeGate.canAutoCascade && !cascadeOverride)}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold h-10 gap-2 text-[13px] disabled:opacity-50"
                  >
                    {simStatus[3] === "running" ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Simulating Animal Cohort…</>
                    ) : (
                      <><Rabbit className="w-4 h-4" /> Run Animal Cohort Simulation</>
                    )}
                  </Button>
                  {!simResults && (
                    <p className="text-[10px] text-amber-700 text-center mt-2">Complete Layer 1 (In Vitro) first</p>
                  )}
                  {simResults && cascadeOverride && (
                    <p className="text-[10px] text-amber-500 text-center mt-2">Cascade-gate override active — advance permitted with logged justification</p>
                  )}
                  <p className="text-[10px] text-slate-600 text-center mt-1">PBPK · Allometric scaling · NOAEL/MTD · FIH dose</p>
                </div>
              </div>

              {/* L3 Animal Cohort Output (relocated — formerly slot 2, then
                   slot 4, now slot 3 per the May 2026 4-layer restructure).
                   All `simStatus[*]` references in this block read slot 3. */}
              <div className="flex-1 overflow-y-auto p-5">
                {simStatus[3] === "idle" && (
                  <EmptyState
                    icon={Rabbit}
                    title="No animal cohort results yet"
                    description="Select a species, study design, and route of administration, then run the simulation to see PBPK outputs, NOAEL/MTD predictions, study group design, and the Human Translation Panel with FIH dose."
                  />
                )}
                {simStatus[3] === "running" && (
                  <div className="flex flex-col items-center justify-center h-full gap-4">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                      <Rabbit className="w-8 h-8 text-emerald-400 animate-pulse" />
                    </div>
                    <div className="text-[14px] font-medium text-white">Running Animal Cohort Simulation</div>
                    <Progress value={simProgress} className="w-64 h-2 bg-white/10" />
                    <p className="text-[11px] text-slate-500">PBPK modeling · Allometric scaling · Tox prediction</p>
                  </div>
                )}
                {simStatus[3] === "complete" && animalResults && (
                  <>
                    {getFlagsForLayer(safetyFlags, 3).length > 0 && (
                      <SafetyFlagCascadeBanner flags={getFlagsForLayer(safetyFlags, 3)} layerLabel="Upstream" upstream />
                    )}
                    {safetyOverrides.some(o => o.toLayer <= 3) && (
                      <OverrideBanner overrides={safetyOverrides.filter(o => o.toLayer <= 3)} />
                    )}
                    <GracefulDegradationBanner warnings={dbDegradationWarnings.filter(w => (provenanceL3?.databaseQueries ?? []).some(q => q.database === w.database))} />
                    <Layer2AnimalResults ar={animalResults} molName={simResults?.molName ?? "Compound"} />
                    {provenanceL3 && <ProvenanceFooter provenance={provenanceL3} layer={3} />}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Layer 4 — First In Human (NEW · May 2026 restructure)
              Receives ConfirmationPackage (L2) + AnimalCohortPackage (L3) and
              derives Phase 1 design seeds: MABEL starting dose, escalation
              scheme, special-pop arms, IND-gate readiness. Phase 1 planner
              redesign is staged as a follow-up. */}
          {activeLayer === 4 && (
            <FirstInHumanPanel
              hasL3={simStatus[3] === "complete"}
              animalResults={animalResults}
              simResults={simResults}
              molName={simResults?.molName ?? molName ?? "Compound"}
              onSendBack={() => setActiveLayer(3)}
            />
          )}

          {/* LEGACY Layer 3 — Patient Cohort Twin (PRESERVED AS DEAD CODE)
              Patient Cohort moved out of pre-clinical scope per April 2026
              4-layer redesign. The new L3 slot is Ex Vivo (scaffold above). */}
          {!HIDE_PATIENT_TRIAL_LAYERS && activeLayer === 3 && (

            <div className="flex-1 flex overflow-hidden">
              <div className="w-[440px] border-r border-white/8 overflow-y-auto flex flex-col">
                <div className="p-5 border-b border-white/8">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="w-4 h-4 text-blue-400" />
                    <h2 className="text-[15px] font-semibold text-white">Layer 3 — Patient Cohort Twin</h2>
                  </div>
                  <p className="text-[11px] text-slate-500">Configure virtual patient population for PK/PD simulation</p>
                </div>

                <div className="p-5 space-y-5">

                  {/* L2 → L3 cascade banner */}
                  {animalResults && (
                    <div className="rounded-xl border border-amber-500/25 bg-amber-500/6 p-3.5 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                        <span className="text-[11px] font-semibold text-amber-300">Layer 2 → Layer 3 Cascade Applied</span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        Parameters below were auto-populated from your Animal Cohort results ({animalResults.species.displayName} study, {animalResults.routeOfAdmin} route):
                      </p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
                        {[
                          ["FIH Starting Dose",    `${animalResults.fihDoseMgKg.toFixed(3)} mg/kg`],
                          ["Human t½ (projected)", `${animalResults.humanHalfLife.toFixed(1)} h`],
                          ["Bioavailability (F%)", `${(animalResults.formulationResult.formulatedF * 100).toFixed(0)}%`],
                          ["Route of Admin.",      routeOfAdmin],
                          ["Dosing Frequency",     dosingFreq],
                          ["Disease Severity",     severity],
                        ].map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-1">
                            <span className="text-slate-500">{k}</span>
                            <span className="text-amber-300 font-semibold">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* L3 Recommendations */}
                  {(() => {
                    const recs: Array<{text: string; level: "warn" | "ok" | "info"}> = [];
                    if (!animalResults) {
                      recs.push({ text: "Run Layers 1 & 2 first. Animal study results will cascade here and inform patient PK/PD parameters.", level: "info" });
                    } else if (!cohortResults) {
                      recs.push({ text: "Review the cascaded dose and PK parameters above before running. Adjust patient demographics and disease severity as needed.", level: "info" });
                      if (animalResults.humanHalfLife < 4)  recs.push({ text: "Short projected t½ — BID or TID dosing is auto-selected. Verify patients can comply with frequent dosing in this indication.", level: "info" });
                      if (cohortSize[0] < 100)              recs.push({ text: "Small cohort size may underpower subgroup analyses. Consider ≥ 200 patients for reliable PK variability estimates.", level: "info" });
                    } else {
                      if (cohortResults.responderRate < 0.40) recs.push({ text: "Low predicted responder rate (< 40%) — revisit indication alignment and consider patient stratification by biomarker status.", level: "warn" });
                      if (cohortResults.dltRate > 0.20)       recs.push({ text: "Elevated DLT rate (> 20%) — consider starting at 50% of the FIH dose in the escalation scheme.", level: "warn" });
                      if (cohortResults.dltRate < 0.10 && cohortResults.responderRate > 0.60) recs.push({ text: "Excellent efficacy/safety profile — strong foundation for Phase II design in L4.", level: "ok" });
                      if (cohortResults.halfLifeHr > 0 && cohortResults.halfLifeHr < 6) recs.push({ text: "Short effective half-life in the cohort — document PK rationale for dosing interval in your IND application.", level: "info" });
                    }
                    if (recs.length === 0) return null;
                    return (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Recommendations</p>
                        {recs.map((r, i) => (
                          <div key={i} className={`rounded-lg px-3 py-2 text-[10px] leading-relaxed border ${
                            r.level === "warn" ? "bg-amber-500/8 border-amber-500/20 text-amber-300" :
                            r.level === "ok"   ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-300" :
                                                 "bg-blue-500/8 border-blue-500/20 text-blue-300"
                          }`}>{r.text}</div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* 3.1 Indication */}
                  <section>
                    <SectionHeader icon={Target} label="Indication & Disease" />
                    <div className="space-y-3">
                      <FieldGroup label="Primary Indication (ICD-10)" required>
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                          <Input
                            value={indication}
                            onChange={e => setIndication(e.target.value)}
                            className="bg-white/5 border-white/10 text-white text-[12px] pl-8 focus:border-blue-500/60"
                          />
                        </div>
                      </FieldGroup>

                      <FieldGroup label="Disease Severity">
                        <div className="grid grid-cols-4 gap-1.5">
                          {["Mild","Moderate","Severe","Critical"].map(s => (
                            <button
                              key={s}
                              onClick={() => setSeverity(s)}
                              className={`py-1.5 text-[11px] font-medium rounded border transition-all ${
                                severity === s
                                  ? "bg-blue-600/20 border-blue-500/50 text-blue-300"
                                  : "border-white/10 text-slate-500 hover:border-white/20"
                              }`}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </FieldGroup>

                      <FieldGroup label="Comorbid Conditions" hint="Max 10 · ICD-10 codes">
                        <div className="relative" ref={comorbidRef}>
                          <div className="flex gap-1.5 flex-wrap">
                            {comorbidConditions.map(c => (
                              <Badge
                                key={c.code + c.label}
                                variant="secondary"
                                className="text-[10px] gap-1 bg-white/8 text-slate-400 hover:bg-red-500/10 hover:text-red-400 cursor-pointer transition-colors select-none"
                                onClick={() => setComorbidConditions(prev => prev.filter(x => !(x.code === c.code && x.label === c.label)))}
                              >
                                <span className="font-mono text-blue-400/70 mr-0.5 text-[9px]">{c.code}</span>
                                {c.label} <X className="w-2.5 h-2.5 shrink-0" />
                              </Badge>
                            ))}
                            {comorbidConditions.length < 10 && (
                              <button
                                className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5 transition-colors"
                                onClick={() => { setComorbidSearch(""); setComorbidOpen(true); }}
                              >
                                <Plus className="w-3 h-3" /> Add
                              </button>
                            )}
                          </div>
                          {comorbidOpen && (
                            <div className="absolute z-50 top-full mt-1.5 left-0 w-72 rounded-xl border border-white/10 bg-[#0e1018] shadow-2xl">
                              <div className="p-2 border-b border-white/8">
                                <input
                                  autoFocus
                                  value={comorbidSearch}
                                  onChange={e => setComorbidSearch(e.target.value)}
                                  onKeyDown={e => e.key === "Escape" && setComorbidOpen(false)}
                                  placeholder="Search ICD-10 code or condition…"
                                  className="w-full bg-white/5 rounded-lg px-3 py-1.5 text-[11px] text-white placeholder:text-slate-600 outline-none border border-white/8 focus:border-blue-500/40"
                                />
                              </div>
                              <div className="max-h-52 overflow-y-auto py-1">
                                {(() => {
                                  const q = comorbidSearch.toLowerCase();
                                  const filtered = ICD10_LIST.filter(item => {
                                    const already = comorbidConditions.some(c => c.code === item.code && c.label === item.label);
                                    return !already && (item.label.toLowerCase().includes(q) || item.code.toLowerCase().includes(q));
                                  });
                                  if (filtered.length === 0) return (
                                    <div className="px-3 py-4 text-[11px] text-slate-600 text-center">No matches found</div>
                                  );
                                  return filtered.slice(0, 8).map(item => (
                                    <button
                                      key={item.code + item.label}
                                      className="w-full text-left px-3 py-1.5 flex items-center gap-2.5 hover:bg-white/5 transition-colors"
                                      onMouseDown={e => e.preventDefault()}
                                      onClick={() => {
                                        setComorbidConditions(prev => [...prev, item]);
                                        setComorbidSearch("");
                                        setComorbidOpen(false);
                                      }}
                                    >
                                      <span className="font-mono text-[10px] text-blue-400 w-14 shrink-0">{item.code}</span>
                                      <span className="text-[11px] text-slate-300">{item.label}</span>
                                    </button>
                                  ));
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      </FieldGroup>
                    </div>
                  </section>

                  <Separator className="bg-white/8" />

                  {/* 3.2 Demographics */}
                  <section>
                    <SectionHeader icon={Users} label="Cohort Demographics" />
                    <div className="space-y-3">
                      <FieldGroup label={`Cohort Size: ${cohortSize[0].toLocaleString()} patients`} required>
                        <Slider
                          value={cohortSize}
                          onValueChange={setCohortSize}
                          min={500} max={10000} step={100}
                          className="[&_[role=slider]]:bg-blue-500 [&_[role=slider]]:border-0"
                        />
                        <div className="flex justify-between text-[10px] text-slate-600 mt-0.5">
                          <span>500</span><span>10,000</span>
                        </div>
                      </FieldGroup>

                      <DualRangeField
                        label="Age Range"
                        value={ageRange}
                        onChange={setAgeRange}
                        min={0} max={100}
                        unit=" yrs"
                        color="blue"
                        required
                      />

                      <FieldGroup label="Sex Distribution" required>
                        <div className="space-y-2">
                          {[
                            { key: "male", label: "Male", color: "bg-blue-500" },
                            { key: "female", label: "Female", color: "bg-pink-500" }
                          ].map(({ key, label, color }) => (
                            <div key={key} className="flex items-center gap-3">
                              <span className="text-[11px] text-slate-400 w-12">{label}</span>
                              <div className="flex-1 relative h-5">
                                <div className="absolute inset-0 bg-white/5 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full ${color} rounded-full transition-all`}
                                    style={{ width: `${sexDistrib[key as "male" | "female"]}%` }}
                                  />
                                </div>
                              </div>
                              <Input
                                value={sexDistrib[key as "male" | "female"]}
                                onChange={e => {
                                  const v = Number(e.target.value);
                                  if (key === "male") setSexDistrib({ male: v, female: 100 - v });
                                  else setSexDistrib({ male: 100 - v, female: v });
                                }}
                                className="w-14 bg-white/5 border-white/10 text-white text-[12px] text-center"
                                type="number" min={0} max={100}
                              />
                              <span className="text-[11px] text-slate-500">%</span>
                            </div>
                          ))}
                          {sexDistrib.male + sexDistrib.female !== 100 && (
                            <p className="text-[10px] text-red-400 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> Must sum to 100%
                            </p>
                          )}
                        </div>
                      </FieldGroup>

                      <DualRangeField
                        label="Body Weight Range"
                        value={bodyWeightRange}
                        onChange={setBodyWeightRange}
                        min={30} max={200}
                        unit=" kg"
                        color="blue"
                      />
                    </div>
                  </section>

                  <Separator className="bg-white/8" />

                  {/* 3.3 Organ Function */}
                  <section>
                    <SectionHeader icon={HeartPulse} label="Organ Function Parameters" />
                    <div className="space-y-3">
                      <FieldGroup label={`eGFR Range: ${eGFRRange[0]}–${eGFRRange[1]} mL/min/1.73m²`} required>
                        <Slider
                          value={eGFRRange as [number, number]}
                          onValueChange={setEGFRRange}
                          min={0} max={150} step={5}
                          className="[&_[role=slider]]:bg-blue-500 [&_[role=slider]]:border-0"
                        />
                        <div className="text-[10px] text-blue-400 mt-0.5">
                          {eGFRRange[0] < 30 ? "CKD Stage 3+–5" : eGFRRange[0] < 60 ? "CKD Stage 3a–3b" : "Normal function"}
                        </div>
                      </FieldGroup>

                      <DualRangeField label="ALT (Hepatic)" value={altRange} onChange={setAltRange} min={0} max={300} unit=" U/L" color="blue" />
                      <DualRangeField label="LVEF (Cardiac)" value={lvefRange} onChange={setLvefRange} min={10} max={80} unit="%" color="blue" required />
                    </div>
                  </section>

                  <Separator className="bg-white/8" />

                  {/* 3.4 PGx */}
                  <CollapsibleSection label="Pharmacogenomic Parameters (PGx)" open={pgxOpen} setOpen={setPgxOpen} accentColor="blue">
                    <div className="space-y-2 pt-1">
                      {[
                        { label: "CYP2D6 Modeling", val: cyp2d6, set: setCyp2d6, hint: "Poor/IM/EM/UM metabolizers" },
                        { label: "CYP3A4 Modeling", val: cyp3a4, set: setCyp3a4, hint: "Major drug metabolism" },
                        { label: "CYP2C19 Modeling", val: cyp2c19, set: setCyp2c19, hint: "Selected drug classes" },
                        { label: "CYP2C9 Modeling", val: cyp2c9, set: setCyp2c9, hint: "Warfarin-type metabolism" },
                      ].map(item => (
                        <ToggleRow
                          key={item.label}
                          label={item.label}
                          description={item.hint}
                          value={item.val}
                          onChange={item.set}
                        />
                      ))}
                    </div>
                  </CollapsibleSection>

                  <Separator className="bg-white/8" />

                  {/* 3.5 ADMET Profile */}
                  <section>
                    <SectionHeader icon={Activity} label="ADMET Profile" />
                    <div className="space-y-3">
                      <FieldGroup label="Source">
                        <div className="flex gap-3">
                          {["From Layer 1","Manual Entry"].map(s => (
                            <label key={s} className="flex items-center gap-2 cursor-pointer">
                              <div
                                onClick={() => setAdmetSource(s)}
                                className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center cursor-pointer ${
                                  admetSource === s ? "border-blue-400" : "border-slate-600"
                                }`}
                              >
                                {admetSource === s && <div className="w-2 h-2 rounded-full bg-blue-400" />}
                              </div>
                              <span className={`text-[11px] ${admetSource === s ? "text-blue-300" : "text-slate-400"}`}>{s}</span>
                            </label>
                          ))}
                        </div>
                      </FieldGroup>

                      {admetSource === "From Layer 1" && simStatus[1] !== "idle" && (
                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2.5 text-[10px] text-emerald-400 flex items-center gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Auto-populated from Layer 1 results
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: "Absorption Probability", val: absorptionProb, set: setAbsorptionProb, unit: "", hint: "0.0–1.0" },
                          { label: "Distribution Volume", val: distribVolume, set: setDistribVolume, unit: "L/kg", hint: "0.1–50.0" },
                          { label: "Metabolic Half-Life", val: halfLife, set: setHalfLife, unit: "hr", hint: "0.1–200" },
                          { label: "Renal Clearance", val: renalClearance, set: setRenalClearance, unit: "mL/min", hint: "0–500" },
                        ].map(({ label, val, set, unit, hint }) => (
                          <FieldGroup key={label} label={label} hint={hint}>
                            <div className="flex">
                              <Input
                                value={val}
                                onChange={e => set(e.target.value)}
                                className="bg-white/5 border-white/10 text-white text-[12px] rounded-r-none border-r-0 focus:border-blue-500/60"
                              />
                              {unit && <span className="bg-white/5 border border-white/10 border-l-0 px-2 text-[11px] text-slate-500 flex items-center rounded-r-md">{unit}</span>}
                            </div>
                          </FieldGroup>
                        ))}
                      </div>

                      <FieldGroup label="Toxicity Risk Vector">
                        <div className="space-y-2">
                          {(() => {
                            const riskColor = (r: number) =>
                              r > 0.30 ? "bg-red-500" : r > 0.15 ? "bg-yellow-500" : "bg-emerald-500";
                            if (!simResults) return [
                              { label: "hERG",      val: 0.12, color: "bg-emerald-500" },
                              { label: "Hepatotox", val: 0.08, color: "bg-yellow-500"  },
                              { label: "Genotox",   val: 0.04, color: "bg-emerald-500" },
                            ];
                            const herg  = simResults.organs.find(o => o.name === "Heart (hERG)");
                            const liver = simResults.organs.find(o => o.name === "Liver");
                            const genotoxAlert = simResults.toxAlerts.find(a => a.category === "Genotox");
                            const genotoxVal = genotoxAlert
                              ? (genotoxAlert.severity === "High" ? 0.40 : genotoxAlert.severity === "Medium" ? 0.22 : 0.10)
                              : 0.03;
                            return [
                              { label: "hERG",      val: herg?.risk  ?? 0.10, color: riskColor(herg?.risk  ?? 0.10) },
                              { label: "Hepatotox", val: liver?.risk ?? 0.07, color: riskColor(liver?.risk ?? 0.07) },
                              { label: "Genotox",   val: genotoxVal,          color: riskColor(genotoxVal)          },
                            ];
                          })().map(({ label, val, color }) => (
                            <div key={label} className="flex items-center gap-3">
                              <span className="text-[10px] text-slate-400 w-16">{label}</span>
                              <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                                <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${Math.min(val * 100, 100)}%` }} />
                              </div>
                              <span className="text-[10px] text-slate-500 w-8 text-right">{val.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      </FieldGroup>
                    </div>
                  </section>

                  <Separator className="bg-white/8" />

                  {/* 3.6 Dose & Admin */}
                  <section>
                    <SectionHeader icon={Beaker} label="Dose & Administration" />
                    <div className="space-y-3">
                      <FieldGroup label="Starting Dose" required>
                        <div className="flex gap-2">
                          <Input
                            value={startingDose}
                            onChange={e => setStartingDose(e.target.value)}
                            className="bg-white/5 border-white/10 text-white text-[12px] flex-1 focus:border-blue-500/60"
                            placeholder="0.001 – 10,000"
                          />
                          <Select value={doseUnit} onValueChange={setDoseUnit}>
                            <SelectTrigger className="w-20 bg-white/5 border-white/10 text-white text-[12px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                              {["mg","mcg","mg/kg"].map(u => (
                                <SelectItem key={u} value={u} className="text-[12px] focus:bg-blue-600/20">{u}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </FieldGroup>

                      <div className="grid grid-cols-2 gap-2">
                        <FieldGroup label="Escalation Scheme" required>
                          <Select value={escalationScheme} onValueChange={setEscalationScheme}>
                            <SelectTrigger className="bg-white/5 border-white/10 text-white text-[12px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                              {["Linear","Modified Fibonacci","Bayesian Optimal Interval (BOIN)","3+3 Design"].map(e => (
                                <SelectItem key={e} value={e} className="text-[12px] focus:bg-blue-600/20">{e}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FieldGroup>

                        <FieldGroup label="Dose Levels" required>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setNumDoseLevels(n => Math.max(2, n - 1))}
                              className="w-8 h-9 rounded border border-white/10 bg-white/5 hover:bg-white/10 text-slate-400 flex items-center justify-center"
                            >−</button>
                            <span className="flex-1 text-center text-[13px] font-medium text-white">{numDoseLevels}</span>
                            <button
                              onClick={() => setNumDoseLevels(n => Math.min(8, n + 1))}
                              className="w-8 h-9 rounded border border-white/10 bg-white/5 hover:bg-white/10 text-slate-400 flex items-center justify-center"
                            >+</button>
                          </div>
                        </FieldGroup>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <FieldGroup label="Route of Admin." required>
                          <Select value={routeOfAdmin} onValueChange={setRouteOfAdmin}>
                            <SelectTrigger className="bg-white/5 border-white/10 text-white text-[12px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                              {["Oral","IV Bolus","IV Infusion","Subcutaneous","Intramuscular","Transdermal"].map(r => (
                                <SelectItem key={r} value={r} className="text-[12px] focus:bg-blue-600/20">{r}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FieldGroup>

                        <FieldGroup label="Dosing Frequency" required>
                          <Select value={dosingFreq} onValueChange={setDosingFreq}>
                            <SelectTrigger className="bg-white/5 border-white/10 text-white text-[12px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                              {["QD","BID","TID","QW","Q2W","Q4W","Single Dose"].map(f => (
                                <SelectItem key={f} value={f} className="text-[12px] focus:bg-blue-600/20">{f}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FieldGroup>
                      </div>
                    </div>
                  </section>
                </div>

                <div id="demo-run-l3" className="p-5 border-t border-white/8 mt-auto">
                  <Button
                    onClick={runSimulation}
                    disabled={simStatus[3] === "running"}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold h-10 gap-2 text-[13px] disabled:opacity-50"
                  >
                    {simStatus[3] === "running" ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Simulating Cohort…</>
                    ) : (
                      <><Play className="w-4 h-4" /> Run Cohort Simulation</>
                    )}
                  </Button>
                  <p className="text-[10px] text-slate-600 text-center mt-2">Est. runtime: 2–7 minutes</p>
                </div>
              </div>

              {/* L3 Patient Cohort Output */}
              <div className="flex-1 overflow-y-auto p-5">
                {simStatus[3] === "idle" && (
                  <EmptyState
                    icon={Users}
                    title="No cohort results yet"
                    description="Configure patient cohort parameters and run the simulation to see PK/PD curves, responder classification, and adverse event predictions."
                  />
                )}
                {simStatus[3] === "running" && (
                  <div className="flex flex-col items-center justify-center h-full gap-4">
                    <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                      <Users className="w-8 h-8 text-blue-400 animate-pulse" />
                    </div>
                    <div className="text-[14px] font-medium text-white">Simulating {cohortSize[0].toLocaleString()} virtual patients</div>
                    <Progress value={simProgress} className="w-64 h-2 bg-white/10" />
                    <p className="text-[11px] text-slate-500">PK/PD modeling · Responder analysis · AE prediction</p>
                  </div>
                )}
                {simStatus[3] === "complete" && (
                  <>
                    {getFlagsForLayer(safetyFlags, 3).length > 0 && (
                      <SafetyFlagCascadeBanner flags={getFlagsForLayer(safetyFlags, 3)} layerLabel="Upstream" upstream />
                    )}
                    {safetyOverrides.some(o => o.toLayer <= 3) && (
                      <OverrideBanner overrides={safetyOverrides.filter(o => o.toLayer <= 3)} />
                    )}
                    <GracefulDegradationBanner warnings={dbDegradationWarnings.filter(w => (provenanceL3?.databaseQueries ?? []).some(q => q.database === w.database))} />
                    <Layer2Results cohortResults={cohortResults} indication={indication} simResults={simResults} aiReport={l2AiReport} aiLoading={l2AiLoading} aiError={l2AiError} aiStream={l2AiStream} onRunAi={runL2AiAnalysis} safetyFlags={safetyFlags} flagsAcknowledged={haIOpsCtx.reviewAcknowledged} onAcknowledgeFlags={() => setHAIOpsCtx(prev => acknowledgeReview(prev))} />
                    {provenanceL3 && <ProvenanceFooter provenance={provenanceL3} layer={3} />}
                    <div className="px-6 pb-6">
                      <ExternalDbPanel
                        layer={2}
                        loading={extDbLoading}
                        extToxCast={extToxCast}
                        extEcotox={extEcotox}
                        extToxRef={extToxRef}
                        extAnimalPk={extAnimalPk}
                        layer2Confidence={layer2Confidence}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* LEGACY Layer 4 — Trial Digital Twin (PRESERVED AS DEAD CODE)
              Trial design moved out of pre-clinical scope into Hakase Clinical
              per April 2026 4-layer redesign (architecture doc §1.3 module
              boundaries). The new L4 slot renders the relocated Animal Cohort
              panel (see "Layer 4 — Animal Cohort" block below). */}
          {!HIDE_PATIENT_TRIAL_LAYERS && activeLayer === 4 && (
            <div className="flex-1 flex overflow-hidden">
              <div className="w-[460px] border-r border-white/8 overflow-y-auto flex flex-col">
                <div className="p-5 border-b border-white/8">
                  <div className="flex items-center gap-2 mb-1">
                    <Beaker className="w-4 h-4 text-emerald-400" />
                    <h2 className="text-[15px] font-semibold text-white">Layer 4 — Trial Digital Twin</h2>
                  </div>
                  <p className="text-[11px] text-slate-500">Configure clinical trial design, endpoints, and simulation parameters</p>
                </div>

                <div className="p-5 space-y-5">
                  {/* L3 → L4 Cascade Banner */}
                  <div className="rounded-xl border border-blue-500/25 bg-blue-500/6 p-3.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                      <span className="text-[11px] font-semibold text-blue-300">
                        {cohortResults ? "Layer 3 → Layer 4 Cascade Applied" : "Layer 3 → Layer 4 Cascade Pending"}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      {cohortResults
                        ? "Patient Cohort PK/PD results are informing trial design and statistical power:"
                        : "Complete Layers 1–3 first. Cohort PK/PD results will auto-populate trial parameters."}
                    </p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
                      {[
                        ["Responder Rate",  cohortResults ? `${(cohortResults.responderRate * 100).toFixed(0)}%`  : "–"],
                        ["DLT Rate",        cohortResults ? `${(cohortResults.dltRate * 100).toFixed(0)}%`        : "–"],
                        ["Cmax (ng/mL)",    cohortResults ? cohortResults.cmax.toFixed(2)                         : "–"],
                        ["t½ (h)",          cohortResults ? cohortResults.halfLifeHr.toFixed(1)                   : "–"],
                        ["AUC (ng·h/mL)",   cohortResults ? cohortResults.auc.toFixed(0)                         : "–"],
                        ["Vdss (L/kg)",     cohortResults ? cohortResults.vdss.toFixed(2)                         : "–"],
                      ].map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-1">
                          <span className="text-slate-500">{k}</span>
                          <span className={v === "–" ? "text-slate-600" : "text-blue-300 font-semibold"}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* L4 Recommendations */}
                  {(() => {
                    const recs: Array<{text: string; level: "warn" | "ok" | "info"}> = [];
                    if (!cohortResults) {
                      recs.push({ text: "Run Layers 1, 2, and 3 first. Cohort results will cascade here to inform sample size and power calculations.", level: "info" });
                    } else {
                      if (cohortResults.responderRate < 0.35)  recs.push({ text: "Low responder rate from L3 — increase sample size or broaden inclusion criteria to achieve adequate statistical power.", level: "warn" });
                      if (cohortResults.dltRate > 0.25)        recs.push({ text: "High DLT rate (> 25%) from L3 — consider Phase I dose escalation before moving to Phase II efficacy testing.", level: "warn" });
                      if (trialPhase === "Phase I" || trialPhase === "Phase I/II") recs.push({ text: "Phase I focus: define the DLT window (typically Cycle 1, 28 days), document PK sampling schedule, and pre-specify dose escalation rules.", level: "info" });
                      if (trialPhase === "Phase II" || trialPhase === "Phase II/III") recs.push({ text: "Phase II: pre-specify your primary endpoint, specify an interim futility analysis, and document the Bayesian or frequentist adaptation rules.", level: "info" });
                      if (trialPhase === "Phase III") recs.push({ text: "Phase III: ensure the MCID aligns with your regulatory discussion. Document all multiplicity adjustments in the SAP.", level: "info" });
                      if (adaptiveEnabled) recs.push({ text: "Adaptive design enabled — pre-specify adaptation rules, blinding protocols, and DMC charter in the Statistical Analysis Plan.", level: "info" });
                      if (cohortResults.dltRate < 0.10 && cohortResults.responderRate > 0.55) recs.push({ text: "Strong L3 efficacy/safety profile — consider accelerated approval pathway discussion with regulatory agency.", level: "ok" });
                    }
                    if (trialResults) {
                      if (trialResults.power < 0.80)  recs.push({ text: `Simulated power (${(trialResults.power * 100).toFixed(0)}%) is below 80% — increase sample size or widen primary endpoint window.`, level: "warn" });
                      if (trialResults.power >= 0.80) recs.push({ text: `Statistical power target met (${(trialResults.power * 100).toFixed(0)}%) — design is well-powered for the primary endpoint.`, level: "ok" });
                    }
                    if (recs.length === 0) return null;
                    return (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Recommendations</p>
                        {recs.map((r, i) => (
                          <div key={i} className={`rounded-lg px-3 py-2 text-[10px] leading-relaxed border ${
                            r.level === "warn" ? "bg-amber-500/8 border-amber-500/20 text-amber-300" :
                            r.level === "ok"   ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-300" :
                                                 "bg-blue-500/8 border-blue-500/20 text-blue-300"
                          }`}>{r.text}</div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* 4.1 Trial Design */}
                  <section>
                    <SectionHeader icon={GitBranch} label="Trial Design Parameters" />
                    <div className="space-y-3">
                      <FieldGroup label="Trial Phase" required>
                        <div className="grid grid-cols-5 gap-1">
                          {["Phase I","Phase I/II","Phase II","Phase II/III","Phase III"].map(p => (
                            <button
                              key={p}
                              onClick={() => setTrialPhase(p)}
                              className={`py-1.5 text-[10px] font-medium rounded border transition-all ${
                                trialPhase === p
                                  ? "bg-emerald-600/20 border-emerald-500/50 text-emerald-300"
                                  : "border-white/10 text-slate-500 hover:border-white/20"
                              }`}
                            >
                              {p.replace("Phase ", "Ph")}
                            </button>
                          ))}
                        </div>
                      </FieldGroup>

                      <FieldGroup label="Study Type" required>
                        <Select value={studyType} onValueChange={setStudyType}>
                          <SelectTrigger className="bg-white/5 border-white/10 text-white text-[12px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                            {["Randomized Controlled","Single-Arm + Synthetic Control","Open-Label","Crossover"].map(s => (
                              <SelectItem key={s} value={s} className="text-[12px] focus:bg-emerald-600/20">{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FieldGroup>

                      <div className="grid grid-cols-2 gap-3">
                        <FieldGroup label="Number of Arms" required>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setNumArms(n => Math.max(1, n - 1))} className="w-8 h-9 rounded border border-white/10 bg-white/5 hover:bg-white/10 text-slate-400 flex items-center justify-center">−</button>
                            <span className="flex-1 text-center text-[13px] font-medium text-white">{numArms}</span>
                            <button onClick={() => setNumArms(n => Math.min(4, n + 1))} className="w-8 h-9 rounded border border-white/10 bg-white/5 hover:bg-white/10 text-slate-400 flex items-center justify-center">+</button>
                          </div>
                        </FieldGroup>

                        {numArms >= 2 && (
                          <FieldGroup label="Randomization Ratio">
                            <Input
                              value={randomizationRatio}
                              onChange={e => setRandomizationRatio(e.target.value)}
                              className="bg-white/5 border-white/10 text-white text-[12px] focus:border-emerald-500/60"
                              placeholder="e.g. 1:1"
                            />
                          </FieldGroup>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <FieldGroup label="Blinding" required>
                          <Select value={blinding} onValueChange={setBlinding}>
                            <SelectTrigger className="bg-white/5 border-white/10 text-white text-[12px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                              {["Open-Label","Single-Blind","Double-Blind","Triple-Blind"].map(b => (
                                <SelectItem key={b} value={b} className="text-[12px] focus:bg-emerald-600/20">{b}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FieldGroup>

                        <FieldGroup label="Primary Endpoint Type" required>
                          <Select value={primaryEndpointType} onValueChange={setPrimaryEndpointType}>
                            <SelectTrigger className="bg-white/5 border-white/10 text-white text-[12px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                              {["Time-to-Event","Continuous","Binary","Composite","Count"].map(t => (
                                <SelectItem key={t} value={t} className="text-[12px] focus:bg-emerald-600/20">{t}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FieldGroup>
                      </div>
                    </div>
                  </section>

                  <Separator className="bg-white/8" />

                  {/* 4.2 Endpoints */}
                  <section>
                    <SectionHeader icon={Target} label="Endpoint Configuration" />
                    <div className="space-y-3">
                      <FieldGroup label="Primary Endpoint Name" required>
                        <Input
                          value={primaryEndpointName}
                          onChange={e => setPrimaryEndpointName(e.target.value)}
                          className="bg-white/5 border-white/10 text-white text-[12px] focus:border-emerald-500/60"
                          placeholder="e.g. Overall Survival"
                        />
                      </FieldGroup>

                      <div className="grid grid-cols-3 gap-2">
                        <FieldGroup label="Measurement Type" required>
                          <Select value={measurementType} onValueChange={setMeasurementType}>
                            <SelectTrigger className="bg-white/5 border-white/10 text-white text-[12px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                              {["Months","Weeks","Days","Score","Percentage","Rate"].map(m => (
                                <SelectItem key={m} value={m} className="text-[12px] focus:bg-emerald-600/20">{m}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FieldGroup>

                        <FieldGroup label="Assessment" required>
                          <div className="flex">
                            <Input
                              value={assessmentTimepoint}
                              onChange={e => setAssessmentTimepoint(e.target.value)}
                              className="bg-white/5 border-white/10 text-white text-[12px] rounded-r-none border-r-0"
                            />
                            <span className="bg-white/5 border border-white/10 border-l-0 px-2 text-[10px] text-slate-500 flex items-center rounded-r-md">{measurementType}</span>
                          </div>
                        </FieldGroup>

                        <FieldGroup label="Effect Size" required>
                          <div className="flex">
                            <Input
                              value={clinicalDiff}
                              onChange={e => setClinicalDiff(e.target.value)}
                              className="bg-white/5 border-white/10 text-white text-[12px] rounded-r-none border-r-0"
                            />
                            <span className="bg-white/5 border border-white/10 border-l-0 px-2 text-[10px] text-slate-500 flex items-center rounded-r-md">Δ</span>
                          </div>
                        </FieldGroup>
                      </div>

                      {/* Secondary Endpoints */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-[11px] text-slate-400">Secondary Endpoints</Label>
                          <button
                            onClick={addSecondaryEndpoint}
                            disabled={secondaryEndpoints.length >= 5}
                            className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 disabled:opacity-40"
                          >
                            <Plus className="w-3 h-3" /> Add
                          </button>
                        </div>
                        {secondaryEndpoints.map((ep) => (
                          <div key={ep.id} className="flex gap-2 items-center mb-1.5">
                            <Input
                              value={ep.name}
                              onChange={e => setSecondaryEndpoints(prev => prev.map(x => x.id === ep.id ? { ...x, name: e.target.value } : x))}
                              className="flex-1 bg-white/5 border-white/10 text-white text-[11px] h-7"
                              placeholder="Endpoint name"
                            />
                            <Select value={ep.type} onValueChange={v => setSecondaryEndpoints(prev => prev.map(x => x.id === ep.id ? { ...x, type: v } : x))}>
                              <SelectTrigger className="w-24 bg-white/5 border-white/10 text-white text-[11px] h-7">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                                {["Time-to-Event","Continuous","Binary"].map(t => (
                                  <SelectItem key={t} value={t} className="text-[11px] focus:bg-emerald-600/20">{t}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <button onClick={() => removeSecondaryEndpoint(ep.id)} className="text-slate-600 hover:text-red-400 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Safety Endpoints */}
                      <FieldGroup label="Safety Endpoints" hint="Auto-populated from Layer 2">
                        <div className="flex gap-1.5 flex-wrap">
                          {["Grade ≥3 Neutropenia","ALT >3× ULN","QTc Prolongation","Nausea/Vomiting"].map(ae => (
                            <Badge key={ae} className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20">
                              {ae}
                            </Badge>
                          ))}
                        </div>
                      </FieldGroup>
                    </div>
                  </section>

                  <Separator className="bg-white/8" />

                  {/* 4.3 Population & Enrollment */}
                  <section>
                    <SectionHeader icon={Map} label="Population & Enrollment" />
                    <div className="space-y-3">
                      <FieldGroup label="Target Sample Size">
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Switch
                              checked={targetSampleAuto}
                              onCheckedChange={setTargetSampleAuto}
                              className="data-[state=checked]:bg-emerald-600"
                            />
                            <span className="text-[11px] text-slate-400">Auto</span>
                          </label>
                          {!targetSampleAuto && (
                            <Input
                              value={targetSampleSize}
                              onChange={e => setTargetSampleSize(e.target.value)}
                              type="number"
                              min={10} max={10000}
                              className="flex-1 bg-white/5 border-white/10 text-white text-[12px]"
                            />
                          )}
                          {targetSampleAuto && (
                            <span className="text-[12px] font-medium text-emerald-400">≈ 248 (calculated)</span>
                          )}
                        </div>
                      </FieldGroup>

                      <FieldGroup label="Number of Trial Sites" required>
                        <Input
                          value={numSites}
                          onChange={e => setNumSites(e.target.value)}
                          type="number"
                          min={1} max={200}
                          className="bg-white/5 border-white/10 text-white text-[12px]"
                        />
                      </FieldGroup>

                      <FieldGroup label="Geographic Regions" required>
                        <div className="grid grid-cols-2 gap-1.5">
                          {["North America","Europe","Asia-Pacific","Latin America","MENA","Sub-Saharan Africa"].map(r => (
                            <label key={r} className="flex items-center gap-2 cursor-pointer group">
                              <Checkbox
                                checked={geoRegions.includes(r)}
                                onCheckedChange={() => toggleRegion(r)}
                                className="border-white/20 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                              />
                              <span className="text-[11px] text-slate-400 group-hover:text-slate-300">{r}</span>
                            </label>
                          ))}
                        </div>
                      </FieldGroup>
                    </div>
                  </section>

                  <Separator className="bg-white/8" />

                  {/* 4.4 I/E Criteria Builder */}
                  <section>
                    <SectionHeader icon={Filter} label="Inclusion / Exclusion Criteria" />
                    <div className="space-y-2">
                      <FieldGroup label="Criteria Source">
                        <div className="flex gap-3">
                          {["From Layer 2 (auto-generated)","Manual","Hybrid (L2 + edits)"].map(s => (
                            <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                              <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                                s === "Hybrid (L2 + edits)" ? "border-emerald-400" : "border-slate-600"
                              }`}>
                                {s === "Hybrid (L2 + edits)" && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                              </div>
                              <span className="text-[10px] text-slate-400">{s.split("(")[0]}</span>
                            </label>
                          ))}
                        </div>
                      </FieldGroup>

                      <div className="space-y-1.5">
                        {criteriaRows.map(row => (
                          <div key={row.id} className="flex gap-1.5 items-center">
                            <Badge
                              className={`text-[9px] px-1.5 shrink-0 ${
                                row.type === "Inclusion"
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : "bg-red-500/10 text-red-400 border-red-500/20"
                              }`}
                            >
                              {row.type === "Inclusion" ? "IN" : "EX"}
                            </Badge>
                            <Input
                              value={row.value}
                              onChange={e => setCriteriaRows(prev => prev.map(r => r.id === row.id ? { ...r, value: e.target.value } : r))}
                              className="flex-1 bg-white/5 border-white/10 text-white text-[11px] h-7"
                            />
                            <button onClick={() => removeCriteriaRow(row.id)} className="text-slate-600 hover:text-red-400 shrink-0">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={addCriteriaRow}
                        className="w-full py-1.5 text-[11px] text-slate-400 hover:text-slate-200 border border-dashed border-white/10 hover:border-white/20 rounded-md flex items-center justify-center gap-1.5"
                      >
                        <Plus className="w-3 h-3" /> Add Criterion
                      </button>
                    </div>
                  </section>

                  <Separator className="bg-white/8" />

                  {/* 4.5 Adaptive Design */}
                  <CollapsibleSection
                    label="Adaptive Design Rules"
                    open={adaptiveOpen}
                    setOpen={setAdaptiveOpen}
                    accentColor="emerald"
                    badge={adaptiveEnabled ? "ON" : undefined}
                  >
                    <div className="space-y-3 pt-1">
                      <ToggleRow label="Adaptive Design" description="Opens adaptive configuration" value={adaptiveEnabled} onChange={setAdaptiveEnabled} />
                      {adaptiveEnabled && (
                        <>
                          <FieldGroup label="Interim Analysis Timing">
                            <Select value={interimTiming} onValueChange={setInterimTiming}>
                              <SelectTrigger className="bg-white/5 border-white/10 text-white text-[12px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                                {["At 25% enrollment","At 50% enrollment","At 75% enrollment","Calendar-based","Information fraction-based"].map(o => (
                                  <SelectItem key={o} value={o} className="text-[12px]">{o}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FieldGroup>
                          <div className="grid grid-cols-2 gap-2">
                            <FieldGroup label="Futility Boundary">
                              <Select value={futilityBoundary} onValueChange={setFutilityBoundary}>
                                <SelectTrigger className="bg-white/5 border-white/10 text-white text-[12px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                                  {["O'Brien-Fleming","Pocock","Lan-DeMets"].map(o => (
                                    <SelectItem key={o} value={o} className="text-[12px]">{o}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FieldGroup>
                            <FieldGroup label="Superiority Boundary">
                              <Select value={superiorityBoundary} onValueChange={setSuperiorityBoundary}>
                                <SelectTrigger className="bg-white/5 border-white/10 text-white text-[12px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                                  {["O'Brien-Fleming","Pocock","Lan-DeMets"].map(o => (
                                    <SelectItem key={o} value={o} className="text-[12px]">{o}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FieldGroup>
                          </div>
                          <ToggleRow label="Sample Size Re-estimation" value={sampleSizeReest} onChange={setSampleSizeReest} />
                          <ToggleRow label="Response-Adaptive Randomization" value={responseAdaptiveRand} onChange={setResponseAdaptiveRand} />
                        </>
                      )}
                    </div>
                  </CollapsibleSection>

                  {/* 4.6 Synthetic Control */}
                  {studyType === "Single-Arm + Synthetic Control" && (
                    <>
                      <Separator className="bg-white/8" />
                      <CollapsibleSection
                        label="Synthetic Control Arm"
                        open={syntheticOpen}
                        setOpen={setSyntheticOpen}
                        accentColor="emerald"
                      >
                        <div className="space-y-3 pt-1">
                          <FieldGroup label="Matching Method">
                            <Select value={matchingMethod} onValueChange={setMatchingMethod}>
                              <SelectTrigger className="bg-white/5 border-white/10 text-white text-[12px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                                {["Propensity Score Matching","Inverse Probability Weighting","Exact Matching","CEM (Coarsened Exact)"].map(m => (
                                  <SelectItem key={m} value={m} className="text-[12px]">{m}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FieldGroup>
                          <FieldGroup label="Matching Variables">
                            <div className="grid grid-cols-2 gap-1.5">
                              {["Age","Sex","BMI","Disease Stage","Comorbidity Index","Baseline Labs","Prior Treatments","eGFR","LVEF"].map(v => (
                                <label key={v} className="flex items-center gap-2 cursor-pointer">
                                  <Checkbox
                                    checked={matchingVariables.includes(v)}
                                    onCheckedChange={() => toggleMatchVar(v)}
                                    className="border-white/20 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                                  />
                                  <span className="text-[11px] text-slate-400">{v}</span>
                                </label>
                              ))}
                            </div>
                          </FieldGroup>
                          <FieldGroup label={`Balance Threshold (SMD): ${balanceThreshold[0].toFixed(2)}`}>
                            <Slider value={balanceThreshold} onValueChange={setBalanceThreshold} min={0.01} max={0.25} step={0.01}
                              className="[&_[role=slider]]:bg-emerald-500 [&_[role=slider]]:border-0" />
                          </FieldGroup>
                          <FieldGroup label="Data Sources">
                            {["MIMIC-IV","HCUP","All of Us"].map(ds => (
                              <label key={ds} className="flex items-center gap-2 cursor-pointer mb-1">
                                <Checkbox
                                  checked={syntheticDataSources.includes(ds)}
                                  onCheckedChange={() => setSyntheticDataSources(prev => prev.includes(ds) ? prev.filter(x => x !== ds) : [...prev, ds])}
                                  className="border-white/20 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                                />
                                <span className="text-[11px] text-slate-400">{ds}</span>
                                <Badge className="ml-auto text-[9px] bg-white/8 text-slate-500">{ds === "MIMIC-IV" ? "~47K pts" : ds === "HCUP" ? "~8M pts" : "~312K pts"}</Badge>
                              </label>
                            ))}
                          </FieldGroup>
                        </div>
                      </CollapsibleSection>
                    </>
                  )}

                  <Separator className="bg-white/8" />

                  {/* 4.6b Prognostic Covariate Adjustment (PROCOVA) */}
                  <CollapsibleSection
                    label="AI-Enhanced Trial Design (PROCOVA)"
                    open={procovaOpen}
                    setOpen={setProcovaOpen}
                    accentColor="emerald"
                    badge={procovaEnabled ? "ON" : undefined}
                  >
                    <div className="space-y-3 pt-1">
                      <ToggleRow label="Prognostic Covariate Adjustment" description="Model impact of PROCOVA-style variance reduction on trial design" value={procovaEnabled} onChange={(v: boolean) => { setProcovaEnabled(v); if (!v) setProcovaResults(null); }} />
                      {procovaEnabled && (() => {
                        const vrEntry = lookupVarianceReduction(indication, primaryEndpointType);
                        const autoVal = Math.round(vrEntry.defaultR * 100);
                        return (
                          <>
                            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 p-3 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-semibold text-emerald-300 uppercase tracking-widest">Variance Reduction Estimate</span>
                                <Badge className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">{vrEntry.area}</Badge>
                              </div>
                              <div className="text-[10px] text-slate-500">{vrEntry.source}</div>
                              <div className="text-[10px] text-slate-400">Expected range: {(vrEntry.minR * 100).toFixed(0)}–{(vrEntry.maxR * 100).toFixed(0)}% for {vrEntry.endpointType.toLowerCase()} endpoints</div>
                            </div>

                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <Switch
                                  checked={procovaVarManual}
                                  onCheckedChange={(v) => {
                                    setProcovaVarManual(v);
                                    if (!v) setProcovaVarReduction([autoVal]);
                                  }}
                                  className="data-[state=checked]:bg-emerald-600"
                                />
                                <span className="text-[11px] text-slate-400">Manual Override</span>
                              </label>
                            </div>

                            <FieldGroup label={`Variance Reduction: ${procovaVarManual ? procovaVarReduction[0] : autoVal}%`}>
                              {procovaVarManual ? (
                                <Slider
                                  value={procovaVarReduction}
                                  onValueChange={setProcovaVarReduction}
                                  min={5} max={25} step={1}
                                  className="[&_[role=slider]]:bg-emerald-500 [&_[role=slider]]:border-0"
                                />
                              ) : (
                                <div className="h-8 flex items-center">
                                  <span className="text-[13px] font-bold text-emerald-400">{autoVal}%</span>
                                  <span className="text-[10px] text-slate-600 ml-2">(auto-populated from indication)</span>
                                </div>
                              )}
                            </FieldGroup>

                            <FieldGroup label="Randomization Ratio (Treatment:Control)">
                              <Select value={procovaRatio} onValueChange={setProcovaRatio}>
                                <SelectTrigger className="bg-white/5 border-white/10 text-white text-[12px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                                  {["1:1", "2:1", "3:1", "4:1"].map(r => (
                                    <SelectItem key={r} value={r} className="text-[12px] focus:bg-emerald-600/20">{r}{r === "1:1" ? " (Standard)" : r === "2:1" ? " (Recommended)" : r === "3:1" ? " (Aggressive)" : " (Max reduction)"}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FieldGroup>

                            <div className="rounded-lg bg-blue-500/5 border border-blue-500/15 p-2.5 text-[10px] text-blue-300 leading-relaxed">
                              EMA-qualified (Sep 2022) for continuous endpoints in Phase 2/3. FDA CDER concurs alignment with ICH E9 ANCOVA guidance. Treatment arm size unchanged — savings from control arm reduction only.
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </CollapsibleSection>

                  <Separator className="bg-white/8" />

                  {/* 4.7 Simulation Params */}
                  <section>
                    <SectionHeader icon={BarChart3} label="Simulation Parameters" />
                    <div className="space-y-3">
                      <FieldGroup label={`Monte Carlo Replications: ${monteCarloReps[0].toLocaleString()}`} required>
                        <Slider
                          value={monteCarloReps}
                          onValueChange={setMonteCarloReps}
                          min={100} max={10000} step={100}
                          className="[&_[role=slider]]:bg-emerald-500 [&_[role=slider]]:border-0"
                        />
                        <div className="flex justify-between text-[10px] text-slate-600 mt-0.5">
                          <span>100 (fast)</span><span>10,000 (precise)</span>
                        </div>
                      </FieldGroup>

                      <div className="grid grid-cols-2 gap-2">
                        <FieldGroup label="Significance Level (α)" required>
                          <Input
                            value={sigLevel}
                            onChange={e => setSigLevel(e.target.value)}
                            className="bg-white/5 border-white/10 text-white text-[12px]"
                          />
                        </FieldGroup>
                        <FieldGroup label="Power Target (1-β)" required>
                          <Input
                            value={powerTarget}
                            onChange={e => setPowerTarget(e.target.value)}
                            className="bg-white/5 border-white/10 text-white text-[12px]"
                          />
                        </FieldGroup>
                      </div>

                      <CollapsibleSection label="Dropout Modeling" open={dropoutOpen} setOpen={setDropoutOpen} badge={dropoutModeling ? "ON" : "OFF"}>
                        <div className="space-y-3 pt-1">
                          <ToggleRow label="Enable Dropout Simulation" value={dropoutModeling} onChange={setDropoutModeling} />
                          {dropoutModeling && (
                            <>
                              <FieldGroup label={`Annual Dropout Rate: ${dropoutRate[0]}%`}>
                                <Slider value={dropoutRate} onValueChange={setDropoutRate} min={0} max={50} step={1}
                                  className="[&_[role=slider]]:bg-emerald-500 [&_[role=slider]]:border-0" />
                              </FieldGroup>
                              <FieldGroup label="Dropout Pattern">
                                <Select value={dropoutPattern} onValueChange={setDropoutPattern}>
                                  <SelectTrigger className="bg-white/5 border-white/10 text-white text-[12px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="bg-[#1a1d2b] border-white/10 text-white">
                                    {["Uniform","Front-loaded","Back-loaded","Exponential"].map(p => (
                                      <SelectItem key={p} value={p} className="text-[12px]">{p}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </FieldGroup>
                            </>
                          )}
                        </div>
                      </CollapsibleSection>
                    </div>
                  </section>
                </div>

                <div id="demo-run-l4" className="p-5 border-t border-white/8 mt-auto">
                  <Button
                    onClick={runSimulation}
                    disabled={simStatus[4] === "running"}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold h-10 gap-2 text-[13px] disabled:opacity-50"
                  >
                    {simStatus[4] === "running" ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Simulating Trial…</>
                    ) : (
                      <><Play className="w-4 h-4" /> Run Trial Simulation</>
                    )}
                  </Button>
                  <p className="text-[10px] text-slate-600 text-center mt-2">Est. runtime: 15–30 minutes</p>
                </div>
              </div>

              {/* L4 Trial Output */}
              <div className="flex-1 overflow-y-auto p-5">
                {simStatus[4] === "idle" && (
                  <EmptyState
                    icon={Beaker}
                    title="No trial results yet"
                    description="Configure your trial design and simulation parameters, then run the trial simulation to see success probability, power curves, enrollment trajectories, and adaptive decision trees."
                  />
                )}
                {simStatus[4] === "running" && (
                  <div className="flex flex-col items-center justify-center h-full gap-4">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                      <BarChart3 className="w-8 h-8 text-emerald-400 animate-pulse" />
                    </div>
                    <div className="text-[14px] font-medium text-white">Running Trial Simulation</div>
                    <Progress value={simProgress} className="w-64 h-2 bg-white/10" />
                    <p className="text-[11px] text-slate-500">Monte Carlo · {monteCarloReps[0].toLocaleString()} replications · Power analysis</p>
                  </div>
                )}
                {simStatus[4] === "complete" && (
                  <>
                    {getFlagsForLayer(safetyFlags, 4).length > 0 && (
                      <SafetyFlagCascadeBanner flags={getFlagsForLayer(safetyFlags, 4)} layerLabel="Upstream" upstream />
                    )}
                    {safetyOverrides.length > 0 && (
                      <OverrideBanner overrides={safetyOverrides} />
                    )}
                    <GracefulDegradationBanner warnings={dbDegradationWarnings.filter(w => (provenanceL4?.databaseQueries ?? []).some(q => q.database === w.database))} />
                    <Layer3Results trialResults={trialResults} cohortResults={cohortResults} indication={indication} simResults={simResults} aiReport={l3AiReport} aiLoading={l3AiLoading} aiError={l3AiError} aiStream={l3AiStream} onRunAi={runL3AiAnalysis} safetyFlags={safetyFlags} flagsAcknowledged={haIOpsCtx.reviewAcknowledged} onAcknowledgeFlags={() => setHAIOpsCtx(prev => acknowledgeReview(prev))} />
                    {procovaResults && <ProcovaResultsPanel pr={procovaResults} powerTarget={Number(powerTarget) || 0.80} />}
                    {provenanceL4 && <ProvenanceFooter provenance={provenanceL4} layer={4} />}
                    <div className="px-6 pb-6">
                      <ExternalDbPanel
                        layer={3}
                        loading={extDbLoading}
                        extClinTrials={extClinTrials}
                        extPharmGKB={extPharmGKB}
                        extDisGeNET={extDisGeNET}
                        extGnomAD={extGnomAD}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {demoOpen && (
        <DemoRunner
          onClose={() => setDemoOpen(false)}
          setSmiles={(s: string) => { setSmiles(s); }}
          setMolName={setMolName}
          setUniprotId={setUniprotId}
          setActiveLayer={setActiveLayer}
          runSimulation={runSimulation}
          simStatus={simStatus}
          activeLayer={activeLayer}
        />
      )}

      <FullAiOverlay
        open={fullAiOpen}
        onClose={() => setFullAiOpen(false)}
        report={aiReport}
        loading={aiLoading}
        error={aiError}
        stream={aiStream}
        onRun={runAiAnalysis}
        chatMessages={chatMessages}
        chatInput={chatInput}
        chatLoading={chatLoading}
        sendChatMessage={sendChatMessage}
        onChatInputChange={setChatInput}
      />

      {viewer3DOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col bg-[#04050a]">
          <div className="h-12 flex items-center px-4 gap-3 border-b border-white/8 bg-black/40 backdrop-blur-sm shrink-0">
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
              {([
                { id: "cinematic", label: "🎬 Cinematic", desc: "Immersive" },
                { id: "scientific", label: "🔬 Scientific", desc: "Split Panel" },
                { id: "explorer", label: "🧬 Explorer", desc: "Multi-Molecule" },
                { id: "docking", label: "🎯 Docking", desc: "Protein + Ligand" },
              ] as const).map(({ id, label, desc }) => (
                <button
                  key={id}
                  onClick={() => setViewer3DMode(id)}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-[12px] font-medium transition-all ${
                    viewer3DMode === id
                      ? "bg-violet-600/30 border border-violet-500/40 text-violet-200 shadow-sm"
                      : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
                  }`}
                >
                  {label}
                  <span className={`text-[9px] font-normal ${viewer3DMode === id ? "text-violet-400" : "text-slate-600"}`}>{desc}</span>
                </button>
              ))}
            </div>
            <div className="w-px h-5 bg-white/10 mx-1" />
            <div className="text-[11px] text-slate-500">
              <span className="text-slate-400 font-medium">{molName || "Molecule"}</span>
              {smiles && <span className="text-slate-600 ml-2 font-mono">{smiles.slice(0, 30)}{smiles.length > 30 ? "…" : ""}</span>}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Badge className="text-[9px] bg-emerald-500/10 border-emerald-500/20 text-emerald-400">Live Preview</Badge>
              <button
                onClick={() => setViewer3DOpen(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/8 text-slate-400 hover:text-white text-[12px] font-medium transition-all"
              >
                <X className="w-3.5 h-3.5" />
                Close
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            {viewer3DMode === "cinematic" && <MolViewer3D_Cinematic smiles={smiles} molName={molName || "Molecule"} />}
            {viewer3DMode === "scientific" && <MolViewer3D_Scientific smiles={smiles} molName={molName || "Molecule"} />}
            {viewer3DMode === "explorer" && <MolViewer3D_Explorer smiles={smiles} molName={molName || "Molecule"} />}
            {viewer3DMode === "docking" && (
              <MolViewer3D_Docking
                smiles={smiles}
                molName={molName || "Molecule"}
                pdbId={pdbId}
                uniprotId={uniprotId}
                targetName={targetSuggestions[0] ? `${targetSuggestions[0].geneName ?? ""} (${targetSuggestions[0].uniprotId})`.trim() : (uniprotId || "Auto-matched target")}
              />
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Shared Sub-components ────────────────────────────────────────────

function SectionHeader({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-3.5 h-3.5 text-slate-500" />
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{label}</span>
    </div>
  );
}

function FieldGroup({ label, children, required, hint }: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Label className="text-[11px] text-slate-400 font-medium">{label}</Label>
        {required && <span className="text-[9px] text-violet-400 font-bold">*</span>}
        {hint && <span className="text-[9px] text-slate-600 ml-auto">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({ label, description, value, onChange, locked, disabled }: {
  label: string;
  description?: string;
  value: boolean;
  onChange?: (v: boolean) => void;
  locked?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-1.5 ${disabled ? "opacity-40" : ""}`}>
      <div>
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-slate-300">{label}</span>
          {locked && <Lock className="w-3 h-3 text-slate-600" />}
        </div>
        {description && <p className="text-[10px] text-slate-600 mt-0.5">{description}</p>}
      </div>
      <Switch
        checked={value}
        onCheckedChange={locked || disabled ? undefined : onChange}
        disabled={locked || disabled}
        className="data-[state=checked]:bg-violet-600 shrink-0"
      />
    </div>
  );
}

function DualRangeField({ label, value, onChange, min, max, unit, color, required }: {
  label: string; value: number[]; onChange: (v: number[]) => void;
  min: number; max: number; unit?: string; color?: string; required?: boolean;
}) {
  return (
    <FieldGroup label={`${label}: ${value[0]}${unit ?? ""}–${value[1]}${unit ?? ""}`} required={required}>
      <Slider
        value={value as [number, number]}
        onValueChange={onChange}
        min={min} max={max}
        className={`[&_[role=slider]]:border-0 ${color === "blue" ? "[&_[role=slider]]:bg-blue-500" : color === "emerald" ? "[&_[role=slider]]:bg-emerald-500" : "[&_[role=slider]]:bg-violet-500"}`}
      />
      <div className="flex justify-between text-[10px] text-slate-600 mt-0.5">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </FieldGroup>
  );
}

function CollapsibleSection({ label, open, setOpen, children, accentColor, badge }: {
  label: string; open: boolean; setOpen: (v: boolean) => void;
  children: React.ReactNode; accentColor?: string; badge?: string;
}) {
  return (
    <div className="border border-white/8 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/3 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{label}</span>
          {badge && (
            <Badge className={`text-[9px] px-1.5 py-0 ${badge === "ON" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-white/5 text-slate-500"}`}>
              {badge}
            </Badge>
          )}
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === "," && !inQ) { result.push(cur.trim()); cur = ""; }
    else { cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

function MolFileUpload({ onLoaded }: { onLoaded: (smiles: string, name?: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "parsing" | "ok" | "error">("idle");
  const [msg, setMsg] = useState("");

  const handleFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { setMsg("File exceeds 10 MB"); setStatus("error"); return; }
    setStatus("parsing");
    const text = await file.text();

    const lname = file.name.toLowerCase();

    let molBlock = text;
    if (lname.endsWith(".sdf")) {
      const end = text.indexOf("$$$$");
      molBlock = end > -1 ? text.slice(0, end + 4) : text;
    }

    const nameFromHeader = molBlock.split("\n")[0]?.trim() || undefined;

    const rdkit = getRDKitInstance();
    if (!rdkit) { setMsg("Chemistry engine not ready"); setStatus("error"); return; }

    let mol: any = null;
    try {
      mol = rdkit.get_mol(molBlock);

      if (!mol || !mol.is_valid()) {
        mol?.delete();
        const smilesInData = text.match(/>\s*<(?:SMILES|Smiles|smiles)>\s*\r?\n([^\r\n]+)/);
        if (smilesInData) {
          mol = rdkit.get_mol(smilesInData[1].trim());
        }
      }

      if (!mol || !mol.is_valid()) {
        setMsg("Could not parse molecule");
        setStatus("error");
        mol?.delete();
        return;
      }

      const smiles = mol.get_smiles();
      mol.delete();

      const nm = nameFromHeader && nameFromHeader !== "" && nameFromHeader.length < 60
        ? nameFromHeader
        : undefined;

      setMsg(nm ? `Loaded: ${nm}` : "Loaded");
      setStatus("ok");
      onLoaded(smiles, nm);
      setTimeout(() => setStatus("idle"), 3000);
    } catch (e) {
      mol?.delete();
      setMsg("Parse error");
      setStatus("error");
    }
  };

  const borderCls = status === "ok"
    ? "border-emerald-500/40 bg-emerald-500/5"
    : status === "error"
    ? "border-red-500/30 bg-red-500/5"
    : "border-white/10 hover:border-violet-500/30 hover:bg-violet-500/5";

  return (
    <>
      <input ref={inputRef} type="file" accept=".sdf,.mol,.mol2" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
      <div onClick={() => inputRef.current?.click()}
        className={`border border-dashed rounded-lg p-3 text-center cursor-pointer transition-all group ${borderCls}`}>
        {status === "parsing" && (
          <div className="flex items-center justify-center gap-1.5">
            <div className="w-2.5 h-2.5 border border-violet-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-[11px] text-violet-400">Parsing…</span>
          </div>
        )}
        {status === "ok" && (
          <div className="text-[11px] font-medium text-emerald-400 truncate">{msg}</div>
        )}
        {status === "error" && (
          <div className="text-[11px] font-medium text-red-400">{msg}</div>
        )}
        {status === "idle" && (
          <>
            <div className="text-[11px] font-medium text-slate-400 group-hover:text-violet-300">Import Structure File</div>
            <div className="text-[9px] text-slate-600 mt-0.5">.sdf, .mol2, .mol — extracts SMILES</div>
          </>
        )}
      </div>
    </>
  );
}

function BatchCsvUpload({ onSelected }: { onSelected: (smiles: string, name?: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows]     = useState<Array<{ smiles: string; name?: string }>>([]);
  const [open, setOpen]     = useState(false);
  const [error, setError]   = useState("");
  const panelRef            = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleFile = async (file: File) => {
    setError("");
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { setError("CSV has no data rows"); return; }

    const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/^"|"$/g, "").trim());
    const smilesCol = headers.findIndex(h => h === "smiles" || h === "smile" || h === "canonical_smiles");
    if (smilesCol < 0) { setError("No 'smiles' column found"); return; }
    const nameCol = headers.findIndex(h => ["name", "compound_name", "molecule", "compound", "id", "cmpd_id"].includes(h));

    const parsed: Array<{ smiles: string; name?: string }> = [];
    for (let i = 1; i < Math.min(lines.length, 501); i++) {
      const cols = parseCsvLine(lines[i]);
      const sm = cols[smilesCol]?.trim();
      if (!sm) continue;
      const nm = nameCol >= 0 ? cols[nameCol]?.trim() || undefined : undefined;
      parsed.push({ smiles: sm, name: nm });
    }

    if (parsed.length === 0) { setError("No valid SMILES rows found"); return; }
    setRows(parsed);
    setOpen(true);
  };

  return (
    <div className="relative">
      <input ref={inputRef} type="file" accept=".csv" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />

      <div onClick={() => rows.length > 0 ? setOpen(o => !o) : inputRef.current?.click()}
        className={`border border-dashed rounded-lg p-3 text-center cursor-pointer transition-all group ${rows.length > 0 ? "border-blue-500/40 bg-blue-500/5" : "border-white/10 hover:border-blue-500/30 hover:bg-blue-500/5"}`}>
        {error ? (
          <div className="text-[11px] font-medium text-red-400">{error}</div>
        ) : rows.length > 0 ? (
          <>
            <div className="text-[11px] font-medium text-blue-300">{rows.length} compounds loaded</div>
            <div className="text-[9px] text-blue-400/60 mt-0.5">Click to pick one</div>
          </>
        ) : (
          <>
            <div className="text-[11px] font-medium text-slate-400 group-hover:text-blue-300">Load from CSV</div>
            <div className="text-[9px] text-slate-600 mt-0.5">Pick compound from spreadsheet</div>
          </>
        )}
      </div>

      {open && rows.length > 0 && (
        <div ref={panelRef}
          className="absolute left-0 top-full mt-1 z-50 w-72 bg-[#0f1117] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
          <div className="px-3 py-2 border-b border-white/8 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-300">{rows.length} compounds — click to load</span>
            <div className="flex gap-2">
              <button onClick={() => inputRef.current?.click()} className="text-[10px] text-slate-500 hover:text-slate-300">Replace</button>
              <button onClick={() => setOpen(false)} className="text-[10px] text-slate-500 hover:text-slate-300">✕</button>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-white/5">
            {rows.map((r, i) => (
              <button key={i}
                onClick={() => { onSelected(r.smiles, r.name); setOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors group/row">
                <div className="text-[11px] font-medium text-slate-300 truncate group-hover/row:text-white">
                  {r.name ?? `Row ${i + 1}`}
                </div>
                <div className="text-[9px] text-slate-600 font-mono truncate">{r.smiles}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-3">
      <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
        <Icon className="w-6 h-6 text-slate-600" />
      </div>
      <div>
        <p className="text-[14px] font-medium text-slate-400">{title}</p>
        <p className="text-[12px] text-slate-600 mt-1 max-w-[320px]">{description}</p>
      </div>
    </div>
  );
}


// ── Layer AI Analysis Panel ───────────────────────────────────────────────
const LAYER_AI_LABELS: Record<number, { title: string; subtitle: string; accent: string; border: string; badge: string; btn: string }> = {
  1: { title: "In Vitro AI Analysis", subtitle: "Assay data · Permeability · Clearance · Safety", accent: "text-violet-400", border: "border-violet-500/20", badge: "bg-violet-500/10 text-violet-400", btn: "bg-violet-600 hover:bg-violet-500" },
  2: { title: "Clinical PK/PD AI Analysis", subtitle: "PBPK · Cohort response · Adverse events · Dosing", accent: "text-blue-400", border: "border-blue-500/20", badge: "bg-blue-500/10 text-blue-400", btn: "bg-blue-600 hover:bg-blue-500" },
  3: { title: "Trial & Regulatory AI Analysis", subtitle: "Trial design · Power · Regulatory pathway · GO/NO-GO", accent: "text-emerald-400", border: "border-emerald-500/20", badge: "bg-emerald-500/10 text-emerald-400", btn: "bg-emerald-600 hover:bg-emerald-500" },
};

// ── Rich text renderer: highlights numbers/units inline ─────────────────────
const NUM_RE = /(\d[\d,]*\.?\d*\s*(?:%|ng\/mL|Da|h\b|nM|μM|µM|mL|L\/h|L\/kg|mg\/kg|mg\/mL|ng·h\/mL|nmol|μmol|fold|×|x\b|ki|Ki|IC50|EC50|AUC|Cmax|Tmax|t½|kDa|kcal\/mol|kcal|cal|eV)|n\s*=\s*\d+|HR\s*[=:]\s*[\d.]+|CI\s*[\d.,–\s%()]+|p\s*[<>=]\s*[\d.]+|HBD\s*\d+|HBA\s*\d+|[\d]+\.[\d]+)/g;

function RichText({ text, accent }: { text: string; accent: string }) {
  const tokens: Array<{ t: string; hi: boolean }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(text)) !== null) {
    if (m.index > last) tokens.push({ t: text.slice(last, m.index), hi: false });
    tokens.push({ t: m[0], hi: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ t: text.slice(last), hi: false });
  return (
    <>
      {tokens.map((tok, i) =>
        tok.hi
          ? <span key={i} className={`font-mono font-semibold tabular-nums ${accent}`}>{tok.t}</span>
          : <span key={i}>{tok.t}</span>
      )}
    </>
  );
}

// Split prose at sentence boundaries so each sentence breathes
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
}

const LAYER_AI_KEY_LABELS: Record<string, string> = {
  molecularOverview:            "In Vitro Overview",
  safetyNarrative:              "Safety Assessment",
  targetEngagement:             "Target Engagement",
  structuralAlerts:             "Structural Alerts",
  competitiveContext:           "Competitive Context",
  pkAnalysis:                   "PK Analysis",
  cohortInsights:               "Cohort Insights",
  adverseEventInterpretation:   "Adverse Event Signals",
  dosingRecommendation:         "Dosing Recommendation",
  drugInteractionRisk:          "Drug Interaction Risk",
  trialDesignRationale:         "Trial Design Rationale",
  powerAnalysis:                "Power Analysis",
  regulatoryPathway:            "Regulatory Pathway",
  goNogoRationale:              "GO/NO-GO Rationale",
  costBenefitAssessment:        "Cost-Benefit Assessment",
  riskMitigations:              "Risk Mitigations",
  nextSteps:                    "Recommended Next Steps",
};

interface LayerAiPanelProps {
  layer: 1 | 2 | 3;
  report: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
  stream: string;
  onRun: () => void;
  simResults?: SimResults | null;
  inVitroResults?: InVitroResults | null;
  cohortResults?: CohortResults | null;
  trialResults?: TrialResults | null;
  safetyFlags?: SafetyFlag[];
  onAcknowledgeFlags?: () => void;
  flagsAcknowledged?: boolean;
  targetName?: string;
  targetConfidence?: number;
  targetArea?: string;
}

function AiMiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  const barColor = color === "violet" ? "bg-violet-500" : color === "blue" ? "bg-blue-500" : color === "emerald" ? "bg-emerald-500" : color === "amber" ? "bg-amber-500" : color === "red" ? "bg-red-500" : "bg-slate-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between">
        <span className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-slate-300 font-semibold tabular-nums">{value.toFixed(value < 10 ? 1 : 0)}{max === 1 ? "%" : ""}</span>
      </div>
      <div className="w-full bg-white/5 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AiSafetyGate({ flags, acknowledged, onAcknowledge, accent }: { flags: SafetyFlag[]; acknowledged: boolean; onAcknowledge: () => void; accent: string }) {
  const [expanded, setExpanded] = useState(false);
  const critical = flags.filter(f => f.severity === "critical");
  const major = flags.filter(f => f.severity === "major");
  const warning = flags.filter(f => f.severity === "warning");
  const reviewRequired = flags.some(f => f.reviewRequired && !f.acknowledged);

  if (flags.length === 0) {
    return (
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-4 py-2.5 flex items-center gap-2">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span className="text-[10px] text-emerald-300 font-medium">No safety flags — clear to proceed</span>
      </div>
    );
  }

  return (
    <div className={`border rounded-lg overflow-hidden ${critical.length > 0 ? "border-red-500/25 bg-red-500/5" : major.length > 0 ? "border-amber-500/25 bg-amber-500/5" : "border-yellow-500/25 bg-yellow-500/5"}`}>
      <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-white/3 transition-colors">
        <Shield className={`w-3.5 h-3.5 shrink-0 ${critical.length > 0 ? "text-red-400" : "text-amber-400"}`} />
        <div className="flex-1">
          <span className={`text-[10px] font-semibold ${critical.length > 0 ? "text-red-300" : "text-amber-300"}`}>
            {flags.length} Safety Flag{flags.length > 1 ? "s" : ""} Detected
          </span>
          <div className="flex gap-2 mt-0.5">
            {critical.length > 0 && <span className="text-[8px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-semibold">{critical.length} Critical</span>}
            {major.length > 0 && <span className="text-[8px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-semibold">{major.length} Major</span>}
            {warning.length > 0 && <span className="text-[8px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded font-semibold">{warning.length} Warning</span>}
          </div>
        </div>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2 border-t border-white/5 pt-2">
          {flags.map((f, i) => (
            <div key={i} className="flex items-start gap-2.5 bg-white/3 rounded-lg px-3 py-2">
              <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${f.severity === "critical" ? "bg-red-400" : f.severity === "major" ? "bg-amber-400" : "bg-yellow-400"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-white">{f.label}</span>
                  <span className={`text-[8px] uppercase font-bold px-1.5 py-0.5 rounded ${f.severity === "critical" ? "bg-red-500/20 text-red-400" : f.severity === "major" ? "bg-amber-500/20 text-amber-400" : "bg-yellow-500/20 text-yellow-400"}`}>{f.severity}</span>
                  {f.ichReference && <span className="text-[8px] text-slate-600 font-mono">{f.ichReference}</span>}
                </div>
                <p className="text-[9px] text-slate-400 mt-0.5 leading-relaxed">{f.detail}</p>
                {f.value && <span className={`text-[9px] font-semibold mt-0.5 inline-block ${accent}`}>{f.value}</span>}
              </div>
            </div>
          ))}
          {reviewRequired && !acknowledged && (
            <button
              onClick={onAcknowledge}
              className="w-full text-[10px] bg-red-500/15 hover:bg-red-500/25 text-red-300 px-3 py-2 rounded-lg font-medium transition-colors border border-red-500/30 hover:border-red-500/50 flex items-center justify-center gap-2"
            >
              <Eye className="w-3 h-3" /> I have reviewed all safety findings
            </button>
          )}
          {acknowledged && (
            <div className="flex items-center gap-2 bg-emerald-500/8 rounded-lg px-3 py-2 border border-emerald-500/20">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span className="text-[9px] text-emerald-300 font-medium">All safety flags reviewed and acknowledged</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function L1AiPreSummary({ sim, iv, targetName, targetConfidence, targetArea }: { sim: SimResults | null; iv: InVitroResults | null; targetName?: string; targetConfidence?: number; targetArea?: string }) {
  if (!sim && !iv) return null;
  const admet = sim?.admet;
  const axes = [
    { l: "Absorption",   v: admet?.absorption ?? 0 },
    { l: "Distribution", v: admet?.distribution ?? 0 },
    { l: "Metabolism",   v: admet?.metabolism ?? 0 },
    { l: "Excretion",    v: admet?.excretion ?? 0 },
    { l: "Tox (inv.)",   v: admet ? 1 - admet.toxicity : 0 },
  ];
  const cx = 60, cy = 55, r = 40;
  const toP = (angle: number, dist: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: cx + dist * Math.cos(rad), y: cy + dist * Math.sin(rad) };
  };
  const angles = axes.map((_, i) => (i * 360) / axes.length);
  const radarPts = axes.map((a, i) => toP(angles[i], r * a.v));
  const radarPath = radarPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + "Z";

  return (
    <div className="space-y-3">
      {targetName && (
        <div className="bg-violet-500/5 border border-violet-500/15 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-3 h-3 text-violet-400" />
            <span className="text-[10px] font-semibold text-violet-300 uppercase tracking-wider">Target Auto-Match</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-bold text-white">{targetName}</div>
              <div className="text-[9px] text-slate-500">{targetArea ?? "—"}</div>
            </div>
            <div className="text-right">
              <div className={`text-[14px] font-bold tabular-nums ${(targetConfidence ?? 0) >= 0.65 ? "text-emerald-400" : (targetConfidence ?? 0) >= 0.35 ? "text-amber-400" : "text-red-400"}`}>
                {((targetConfidence ?? 0) * 100).toFixed(1)}%
              </div>
              <div className="text-[8px] text-slate-600 uppercase">Confidence</div>
            </div>
          </div>
          <div className="mt-2 text-[9px] text-slate-500 leading-relaxed">
            Matched via pharmacophore profiling (SMARTS patterns) + molecular descriptor scoring against 29-target catalog.
            {(targetConfidence ?? 0) >= 0.65 ? " Multi-feature match across scaffold, MW, LogP, and functional groups." : (targetConfidence ?? 0) >= 0.35 ? " Partial feature match — verify binding mode." : " Weak resemblance — experimental validation strongly recommended."}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/3 border border-white/5 rounded-lg p-3">
          <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider mb-2">ADMET Radar</div>
          <div className="flex items-center gap-2">
            <svg width="120" height="110" className="shrink-0">
              {[0.33, 0.66, 1].map(f => (
                <polygon key={f} points={angles.map(a => { const p = toP(a, r * f); return `${p.x},${p.y}`; }).join(" ")} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
              ))}
              {axes.map((a, i) => {
                const p = toP(angles[i], r + 10);
                return <text key={i} x={p.x} y={p.y} fill="#64748b" fontSize="6" textAnchor="middle" dominantBaseline="middle">{a.l}</text>;
              })}
              <polygon points={radarPath.replace("Z", "").replace("M", "").replace(/L/g, " ")} fill="rgba(139,92,246,0.15)" stroke="#8b5cf6" strokeWidth="1.5" />
              {radarPts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2" fill="#8b5cf6" />)}
            </svg>
            <div className="space-y-1 flex-1">
              {axes.map(a => (
                <div key={a.l} className="flex justify-between text-[8px]">
                  <span className="text-slate-600">{a.l}</span>
                  <span className={`font-semibold tabular-nums ${a.v >= 0.7 ? "text-emerald-400" : a.v >= 0.4 ? "text-amber-400" : "text-red-400"}`}>{(a.v * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="bg-white/3 border border-white/5 rounded-lg p-3 space-y-2">
          <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Key Metrics</div>
          {iv && (
            <>
              <AiMiniBar label="IC50" value={iv.doseResponse.ic50_nM} max={1000} color={iv.doseResponse.ic50_nM < 100 ? "emerald" : iv.doseResponse.ic50_nM < 500 ? "amber" : "red"} />
              <AiMiniBar label="Caco-2 Papp" value={iv.permeability.caco2Papp} max={60} color={iv.permeability.caco2Class === "High" ? "emerald" : iv.permeability.caco2Class === "Moderate" ? "amber" : "red"} />
              <AiMiniBar label="hERG IC50" value={iv.herg.ic50_uM} max={100} color={iv.herg.riskCategory === "Low" ? "emerald" : iv.herg.riskCategory === "Moderate" ? "amber" : "red"} />
            </>
          )}
          {!iv && sim && (
            <>
              <AiMiniBar label="Absorption" value={(sim.admet.absorption) * 100} max={100} color={sim.admet.absorption >= 0.7 ? "emerald" : "amber"} />
              <AiMiniBar label="QED" value={sim.qed * 100} max={100} color={sim.qed > 0.5 ? "emerald" : "amber"} />
              <AiMiniBar label="Toxicity Risk" value={sim.admet.toxicity * 100} max={100} color={sim.admet.toxicity < 0.3 ? "emerald" : sim.admet.toxicity < 0.6 ? "amber" : "red"} />
            </>
          )}
        </div>
      </div>
      {sim && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { l: "Go/No-Go", v: sim.goNogo, good: sim.goNogo === "GO" },
            { l: "Lipinski", v: `${sim.lipinski.violations}/4 viol.`, good: sim.lipinski.violations <= 1 },
            { l: "QED", v: sim.qed.toFixed(2), good: sim.qed > 0.5 },
            { l: "SA Score", v: sim.saScore.toFixed(1), good: sim.saScore <= 4 },
          ].map(m => (
            <div key={m.l} className={`rounded-lg px-2.5 py-2 text-center border ${m.good ? "border-emerald-500/15 bg-emerald-500/5" : "border-red-500/15 bg-red-500/5"}`}>
              <div className="text-[8px] text-slate-600 uppercase">{m.l}</div>
              <div className={`text-[12px] font-bold mt-0.5 ${m.good ? "text-emerald-400" : "text-red-400"}`}>{m.v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function L2AiPreSummary({ cr }: { cr: CohortResults | null }) {
  if (!cr) return null;
  const cmaxNg = cr.cmax * 1000;
  const pts = cr.pkCurve;
  const maxC = Math.max(...pts.map(p => p.conc), 0.001);
  const maxT = pts[pts.length - 1]?.time ?? 48;
  const W = 200, H = 70, pL = 5, pB = 5;
  const tx = (t: number) => pL + (t / maxT) * (W - pL);
  const ty = (c: number) => H - pB - (c / maxC) * (H - pB - 5);
  const curvePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${tx(p.time).toFixed(1)},${ty(p.conc).toFixed(1)}`).join(" ");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/3 border border-white/5 rounded-lg p-3">
          <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider mb-2">PK Curve Preview</div>
          <svg width={W} height={H} className="w-full" viewBox={`0 0 ${W} ${H}`}>
            <path d={curvePath} fill="none" stroke="#3b82f6" strokeWidth="1.5" />
            <line x1={pL} y1={H - pB} x2={W} y2={H - pB} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
          </svg>
          <div className="flex justify-between mt-1.5 text-[8px] text-slate-600">
            <span>0h</span>
            <span>{maxT.toFixed(0)}h</span>
          </div>
        </div>
        <div className="bg-white/3 border border-white/5 rounded-lg p-3 space-y-2">
          <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Clinical PK</div>
          <AiMiniBar label="Cmax" value={cmaxNg} max={5000} color="blue" />
          <AiMiniBar label="t½" value={cr.halfLifeHr} max={48} color="blue" />
          <AiMiniBar label="Responder %" value={cr.responderRate * 100} max={100} color={cr.responderRate >= 0.5 ? "emerald" : "amber"} />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[
          { l: "Cmax", v: `${cmaxNg.toFixed(0)} ng/mL`, good: true },
          { l: "AUC₀₋₄₈", v: `${cr.auc.toFixed(1)} µg·h/mL`, good: true },
          { l: "Responders", v: `${(cr.responderRate * 100).toFixed(1)}%`, good: cr.responderRate >= 0.4 },
          { l: "Grade≥3 AEs", v: `${(cr.grade3AERate * 100).toFixed(1)}%`, good: cr.grade3AERate < 0.15 },
        ].map(m => (
          <div key={m.l} className={`rounded-lg px-2 py-2 text-center border ${m.good ? "border-blue-500/15 bg-blue-500/5" : "border-amber-500/15 bg-amber-500/5"}`}>
            <div className="text-[8px] text-slate-600 uppercase">{m.l}</div>
            <div className={`text-[11px] font-bold mt-0.5 ${m.good ? "text-blue-300" : "text-amber-300"}`}>{m.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function L3AiPreSummary({ tr }: { tr: TrialResults | null }) {
  if (!tr) return null;
  const prob = tr.successProbability * 100;
  const probColor = prob >= 70 ? "#22c55e" : prob >= 50 ? "#eab308" : "#ef4444";
  const cx2 = 55, cy2 = 50, rr = 38;
  const circ = 2 * Math.PI * rr;
  const trackLen = circ * 0.75;
  const fillLen = (prob / 100) * trackLen;
  const rot = `rotate(135 ${cx2} ${cy2})`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/3 border border-white/5 rounded-lg p-3 flex flex-col items-center">
          <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider mb-2">Success Probability</div>
          <svg width="110" height="75" viewBox="0 0 110 75">
            <circle cx={cx2} cy={cy2} r={rr} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" strokeLinecap="butt" strokeDasharray={`${trackLen} ${circ - trackLen}`} transform={rot} />
            <circle cx={cx2} cy={cy2} r={rr} fill="none" stroke={probColor} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${fillLen} ${circ - fillLen}`} transform={rot} />
            <text x={cx2} y={cy2 + 2} fill={probColor} fontSize="14" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">{prob.toFixed(0)}%</text>
          </svg>
        </div>
        <div className="bg-white/3 border border-white/5 rounded-lg p-3 space-y-2">
          <div className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Trial Metrics</div>
          <AiMiniBar label="Power" value={tr.power * 100} max={100} color={tr.power >= 0.8 ? "emerald" : "amber"} />
          <AiMiniBar label="p-Value" value={Math.max(0.001, tr.pValue) * 1000} max={50} color={tr.pValue < 0.05 ? "emerald" : "red"} />
          <AiMiniBar label="Success" value={prob} max={100} color={prob >= 70 ? "emerald" : prob >= 50 ? "amber" : "red"} />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[
          { l: "Sample", v: String(tr.sampleSize), good: true },
          { l: "Duration", v: `${tr.estimatedDuration}mo`, good: tr.estimatedDuration <= 36 },
          { l: "GO/NO-GO", v: tr.goNogo, good: tr.goNogo === "GO" },
          { l: "p-Value", v: tr.pValue.toFixed(3), good: tr.pValue < 0.05 },
        ].map(m => (
          <div key={m.l} className={`rounded-lg px-2 py-2 text-center border ${m.good ? "border-emerald-500/15 bg-emerald-500/5" : "border-red-500/15 bg-red-500/5"}`}>
            <div className="text-[8px] text-slate-600 uppercase">{m.l}</div>
            <div className={`text-[11px] font-bold mt-0.5 ${m.good ? "text-emerald-300" : "text-red-300"}`}>{m.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LayerAiPanel(props: LayerAiPanelProps) {
  const {
    layer, report, loading, error, stream, onRun,
    simResults: sim, inVitroResults: iv, cohortResults: cr, trialResults: tr,
    safetyFlags: flags, onAcknowledgeFlags, flagsAcknowledged,
    targetName, targetConfidence, targetArea,
  } = props;
  const cfg = LAYER_AI_LABELS[layer];
  const layerFlags = flags?.filter(f => f.originLayer <= layer) ?? [];

  return (
    <div className={`border ${cfg.border} rounded-xl overflow-hidden bg-white/[0.015]`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <Sparkles className={`w-3.5 h-3.5 ${cfg.accent}`} />
          <span className="text-[12px] font-semibold text-white">{cfg.title}</span>
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${cfg.badge}`}>Hakase AI v2</span>
        </div>
        {loading ? (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <div className="w-3 h-3 border border-slate-500 border-t-transparent rounded-full animate-spin" />
            Analyzing…
          </div>
        ) : report ? (
          <button onClick={onRun} className={`flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-md font-medium text-white transition-colors ${cfg.btn}`}>
            <RefreshCw className="w-3 h-3" /> Re-run
          </button>
        ) : (
          <button onClick={onRun} className={`flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md font-semibold text-white transition-colors ${cfg.btn}`}>
            <Sparkles className="w-3 h-3" /> Run AI Analysis
          </button>
        )}
      </div>

      {!loading && !report && !error && (
        <div className="px-4 py-4 space-y-4">
          {layer === 1 && <L1AiPreSummary sim={sim ?? null} iv={iv ?? null} targetName={targetName} targetConfidence={targetConfidence} targetArea={targetArea} />}
          {layer === 2 && <L2AiPreSummary cr={cr ?? null} />}
          {layer === 3 && <L3AiPreSummary tr={tr ?? null} />}

          {onAcknowledgeFlags && (
            <AiSafetyGate flags={layerFlags} acknowledged={flagsAcknowledged ?? false} onAcknowledge={onAcknowledgeFlags} accent={cfg.accent} />
          )}

          {(sim || cr || tr) && (
            <div className="text-center pt-2 pb-1">
              <p className="text-[11px] text-slate-500 max-w-[380px] mx-auto">
                The data above summarizes this layer's simulation outputs.
                Click <span className={`${cfg.accent} font-medium`}>Run AI Analysis</span> for a Claude-powered deep interpretation covering
                {layer === 1 ? " ADMET profiling, binding assessment, structural alerts, and competitive context." : ""}
                {layer === 2 ? " PBPK modeling, cohort PK/PD, adverse events, and dosing recommendations." : ""}
                {layer === 3 ? " trial design rationale, power analysis, regulatory pathway, and cost-benefit assessment." : ""}
              </p>
            </div>
          )}

          {!sim && !cr && !tr && (
            <div className="text-center py-3">
              <div className={`w-10 h-10 rounded-full ${cfg.badge} flex items-center justify-center mx-auto mb-3`}>
                <Sparkles className={`w-5 h-5 ${cfg.accent}`} />
              </div>
              <p className="text-[12px] text-slate-400 font-medium mb-1">{cfg.subtitle}</p>
              <p className="text-[11px] text-slate-600 max-w-[320px] mx-auto">
                Click <span className={`${cfg.accent} font-medium`}>Run AI Analysis</span> to get a Claude-powered deep dive on this simulation layer's results.
              </p>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="px-4 py-5">
          <div className="text-[10px] text-slate-500 mb-2 font-medium">Streaming biomedical analysis…</div>
          <pre className={`text-[10px] ${cfg.accent} leading-relaxed whitespace-pre-wrap font-mono max-h-48 overflow-y-auto`}>
            {stream || "Connecting…"}
          </pre>
        </div>
      )}

      {error && (
        <div className="px-4 py-3">
          <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
        </div>
      )}

      {report && !loading && (
        <div className="divide-y divide-white/[0.04]">
          {onAcknowledgeFlags && (
            <div className="px-4 py-3">
              <AiSafetyGate flags={layerFlags} acknowledged={flagsAcknowledged ?? false} onAcknowledge={onAcknowledgeFlags} accent={cfg.accent} />
            </div>
          )}
          {Object.entries(report).map(([key, val]) => {
            if (!val || (Array.isArray(val) && val.length === 0)) return null;
            const label = LAYER_AI_KEY_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").trim();
            const isArr = Array.isArray(val);
            const text = String(val);
            const sentences = isArr ? [] : splitSentences(text);
            return (
              <div key={key} className="px-5 py-4">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className={`w-[3px] h-4 rounded-full ${cfg.btn}`} />
                  <span className={`text-[9px] font-bold uppercase tracking-[0.12em] ${cfg.accent}`}>{label}</span>
                </div>
                {isArr ? (
                  <ul className="space-y-2">
                    {(val as string[]).map((item, i) => (
                      <li key={i} className="flex items-start gap-3 pl-1">
                        <span className={`mt-[5px] w-1 h-1 rounded-full flex-shrink-0 ${cfg.btn}`} />
                        <span className="text-[12px] text-slate-300 leading-[1.7]">
                          <RichText text={item} accent={cfg.accent} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="space-y-2 pl-[18px]">
                    {sentences.map((s, i) => (
                      <p key={i} className="text-[12px] text-slate-300 leading-[1.75]">
                        <RichText text={s} accent={cfg.accent} />
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Full AI Report Overlay ────────────────────────────────────────────────
function FullAiOverlay({
  open, onClose, report, loading, error, stream, onRun,
  chatMessages, chatInput, chatLoading, sendChatMessage, onChatInputChange,
}: {
  open: boolean;
  onClose: () => void;
  report: AiReport | null;
  loading: boolean;
  error: string | null;
  stream: string;
  onRun: () => void;
  chatMessages: Array<{ role: "user" | "assistant"; content: string }>;
  chatInput: string;
  chatLoading: boolean;
  sendChatMessage: (q: string) => void;
  onChatInputChange: (v: string) => void;
}) {
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);
  if (!open) return null;

  const FULL_KEY_LABELS: Record<string, string> = {
    molecularOverview: "In Vitro Overview", safetyNarrative: "Safety Assessment",
    pkAnalysis: "PK Analysis", targetEngagement: "Target Engagement",
    cohortInsights: "Cohort Insights", trialDesignRationale: "Trial Design",
    competitiveContext: "Competitive Context", regulatoryPathway: "Regulatory Pathway",
    riskMitigations: "Risk Mitigations", goNogoRationale: "GO/NO-GO Rationale",
    nextSteps: "Next Steps",
  };

  return (
    <div className="fixed inset-0 z-[100] flex">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto w-[680px] max-w-[95vw] h-full bg-[#0b0d14] border-l border-white/10 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-white">Full Project AI Analysis</div>
              <div className="text-[11px] text-slate-500">Integrated assessment across all 3 simulation layers</div>
            </div>
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded bg-violet-500/10 text-violet-400">Hakase AI v2</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/8 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!loading && !report && !error && (
            <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-violet-400" />
              </div>
              <div>
                <div className="text-[14px] font-semibold text-white mb-1">Integrated Cross-Layer Analysis</div>
                <div className="text-[12px] text-slate-500 max-w-[320px]">Synthesises molecular safety, PK/PD cohort data, and trial design into a single expert assessment</div>
              </div>
              <button onClick={onRun} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-5 py-2.5 rounded-lg font-semibold text-[13px] transition-colors">
                <Sparkles className="w-4 h-4" /> Generate Full Analysis
              </button>
            </div>
          )}

          {loading && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 border border-violet-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-[11px] text-slate-400 font-medium">Streaming analysis across all layers…</span>
              </div>
              <pre className="text-[10px] text-violet-400 leading-relaxed whitespace-pre-wrap font-mono">{stream || "Connecting…"}</pre>
            </div>
          )}

          {error && <div className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">{error}</div>}

          {report && !loading && (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-slate-500">Analysis complete — {Object.keys(report).length} sections</span>
                <button onClick={onRun} className="flex items-center gap-1.5 text-[10px] bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-md text-slate-400 transition-colors">
                  <RefreshCw className="w-3 h-3" /> Re-run
                </button>
              </div>
              {Object.entries(report).map(([key, val]) => {
                if (!val || (Array.isArray(val) && val.length === 0)) return null;
                const label = FULL_KEY_LABELS[key] ?? key;
                const isArr = Array.isArray(val);
                const text = String(val);
                const sentences = isArr ? [] : splitSentences(text);
                return (
                  <div key={key} className="border border-white/6 rounded-xl overflow-hidden">
                    {/* Section header */}
                    <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white/[0.02] border-b border-white/5">
                      <div className="w-[3px] h-4 rounded-full bg-violet-500" />
                      <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-violet-400">{label}</span>
                    </div>
                    {/* Body */}
                    <div className="px-4 py-3">
                      {isArr ? (
                        <ul className="space-y-2">
                          {(val as string[]).map((item, i) => (
                            <li key={i} className="flex items-start gap-3">
                              <span className="mt-[6px] w-1 h-1 rounded-full bg-violet-500 flex-shrink-0" />
                              <span className="text-[12px] text-slate-300 leading-[1.7]">
                                <RichText text={item} accent="text-violet-400" />
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="space-y-2">
                          {sentences.map((s, i) => (
                            <p key={i} className="text-[12px] text-slate-300 leading-[1.75]">
                              <RichText text={s} accent="text-violet-400" />
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Chat */}
          {report && (
            <div className="border border-white/6 rounded-xl overflow-hidden mt-2">
              <div className="px-4 py-2.5 border-b border-white/6 bg-white/2">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-3.5 h-3.5 text-violet-400" />
                  <span className="text-[11px] font-semibold text-slate-300">Ask the Analysis</span>
                </div>
              </div>
              <div className="max-h-52 overflow-y-auto px-4 py-3 space-y-3">
                {chatMessages.length === 0 && (
                  <p className="text-[11px] text-slate-600 text-center py-4">Ask a follow-up question about this compound…</p>
                )}
                {chatMessages.map((m, i) => (
                  <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                    <div className={`text-[11px] leading-relaxed px-3 py-2 rounded-xl max-w-[85%] ${
                      m.role === "user" ? "bg-violet-600/20 text-violet-200 rounded-tr-sm" : "bg-white/5 text-slate-300 rounded-tl-sm"
                    }`}>{m.content}</div>
                  </div>
                ))}
                {chatLoading && <div className="text-[11px] text-slate-500 animate-pulse">Analysing…</div>}
                <div ref={chatEndRef} />
              </div>
              <div className="px-3 py-2.5 border-t border-white/6 flex gap-2">
                <input
                  value={chatInput}
                  onChange={e => onChatInputChange(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(chatInput); } }}
                  placeholder="Ask about this compound…"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg text-[11px] text-white px-3 py-1.5 placeholder-slate-600 focus:outline-none focus:border-violet-500/50"
                />
                <button
                  onClick={() => sendChatMessage(chatInput)}
                  disabled={!chatInput.trim() || chatLoading}
                  className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-lg text-white text-[11px] font-medium transition-colors"
                >Send</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Simulation Data Sources & References Panel ────────────────────────────
type SrcEntry = { name: string; status: "live" | "estimated" | "unavailable"; detail: string; url?: string };
type RefEntry = { code: string; title: string; url?: string };

function buildL1Sources(
  sr: SimResults | null,
  uniprotId: string,
  pdbId: string,
  proteinName: string,
  alphafoldPlddt: number | null,
): SrcEntry[] {
  return [
    {
      name: "RDKit.js v2022.09",
      status: "live",
      detail: "WebAssembly — 38 molecular descriptors computed from SMILES (MW, LogP, TPSA, HBD, HBA, RotBonds, QED)",
      url: "https://www.rdkit.org",
    },
    {
      name: "ChEMBL API v6",
      status: sr?.similarDrugs?.length ? "live" : "estimated",
      detail: sr?.similarDrugs?.length
        ? `Binding QSAR from similar drugs: ${sr.similarDrugs.join(", ")}`
        : "No similar drugs found — binding estimated from structural features",
      url: "https://www.ebi.ac.uk/chembl/",
    },
    {
      name: "UniProt REST API",
      status: uniprotId ? "live" : "unavailable",
      detail: uniprotId
        ? `Target: ${uniprotId}${proteinName ? ` — ${proteinName}` : ""} — sequence, active sites, binding pockets`
        : "No UniProt ID provided",
      url: uniprotId ? `https://www.uniprot.org/uniprotkb/${uniprotId}` : undefined,
    },
    {
      name: "RCSB PDB",
      status: pdbId ? "live" : "unavailable",
      detail: pdbId
        ? `Crystal structure ${pdbId} loaded — coordinates used for docking estimate`
        : "No PDB structure selected",
      url: pdbId ? `https://www.rcsb.org/structure/${pdbId}` : undefined,
    },
    {
      name: "AlphaFold Database (EBI)",
      status: alphafoldPlddt ? "live" : uniprotId ? "estimated" : "unavailable",
      detail: alphafoldPlddt
        ? `Mean pLDDT ${alphafoldPlddt.toFixed(0)} — structure confidence score`
        : uniprotId ? "Queried — no AlphaFold entry available for this target" : "No UniProt ID — not queried",
      url: uniprotId ? `https://alphafold.ebi.ac.uk/entry/${uniprotId}` : undefined,
    },
    {
      name: "openFDA Drug Labels",
      status: sr?.similarDrugs?.length ? "live" : "unavailable",
      detail: sr?.similarDrugs?.length
        ? `Boxed warning check: ${sr.similarDrugs.join(", ")}`
        : "No similar drugs to check",
      url: "https://api.fda.gov/drug/label.json",
    },
    {
      name: "Lipinski Rule-of-Five (QSAR)",
      status: "estimated",
      detail: `MW=${sr?.lipinski?.mw?.toFixed(0) ?? "?"}Da, LogP=${sr?.lipinski?.logP?.toFixed(2) ?? "?"} — Ro5 oral bioavailability filter`,
    },
    {
      name: "ADMET QSAR Engine (in silico)",
      status: "estimated",
      detail: "Absorption / Distribution / Metabolism / Excretion / Toxicity — rule-based estimates, 0–1 scale",
    },
    {
      name: "BindingDB",
      status: uniprotId ? "live" : "unavailable",
      detail: uniprotId
        ? "Experimental binding affinities (Ki, IC50, Kd) for the target protein — fetched via server proxy"
        : "No UniProt ID — BindingDB not queried",
      url: "https://www.bindingdb.org",
    },
    {
      name: "STRING DB v12",
      status: "live",
      detail: "Protein–protein interaction network — functional associations, co-expression, experimental evidence",
      url: "https://string-db.org",
    },
    {
      name: "KEGG PATHWAY",
      status: "live",
      detail: "KEGG pathway enrichment for gene — maps to molecular pathways and biological processes",
      url: "https://www.kegg.jp",
    },
    {
      name: "Reactome v88",
      status: uniprotId ? "live" : "unavailable",
      detail: uniprotId
        ? "Biological pathway participation for the target — curated reaction-level detail"
        : "No UniProt ID — Reactome not queried",
      url: "https://reactome.org",
    },
    {
      name: "Open Targets Platform",
      status: "live",
      detail: "Target–disease associations, approved drugs, tractability scores, safety liabilities",
      url: "https://platform.opentargets.org",
    },
  ];
}

function buildL2Sources(
  cr: CohortResults | null,
  sr: SimResults | null,
): SrcEntry[] {
  const ds = cr?.dataSources;
  return [
    {
      name: "2-Compartment PBPK Model",
      status: ds?.pbpk === "2-compartment" ? "live" : "estimated",
      detail: "PK-Sim OSP physiological parameters — RK4 ODE solver — central + peripheral compartments — allometric scaling",
    },
    {
      name: "NHANES 2017–2020 (CDC)",
      status: ds?.population === "nhanes" ? "live" : "estimated",
      detail: "Body weight, eGFR, ALT, albumin distributions — virtual patient sampling for population PK",
      url: "https://www.cdc.gov/nchs/nhanes/",
    },
    {
      name: "ChEMBL PD Parameters",
      status: ds?.pd === "chembl-live" ? "live" : "estimated",
      detail: ds?.pd === "chembl-live"
        ? `IC50/Ki from ChEMBL → Emax/Hill EC50 for ${sr?.similarDrugs?.join(", ") ?? "similar drugs"}`
        : "Estimated from ADMET profile — ChEMBL PD data unavailable",
      url: "https://www.ebi.ac.uk/chembl/",
    },
    {
      name: "openFDA FAERS",
      status: ds?.ae === "faers-live" ? "live" : "estimated",
      detail: ds?.ae === "faers-live"
        ? `Post-market AE reports for ${sr?.similarDrugs?.[0] ?? "reference drug"} — MedDRA v26.0 terminology`
        : "FAERS unavailable — AE rates estimated from ADMET tox profile",
      url: "https://api.fda.gov/drug/event.json",
    },
    {
      name: "EPA CompTox Dashboard (ToxCast/DSSTox)",
      status: "live",
      detail: "High-throughput toxicology assay panel — ToxCast AC50 endpoint hits, oral LD50 estimates",
      url: "https://comptox.epa.gov/dashboard",
    },
    {
      name: "ECOTOX Knowledgebase (EPA)",
      status: "live",
      detail: "Environmental toxicology — ecotoxicological endpoints (NOAEC, LOAEC, LD50, LC50) across species",
      url: "https://cfpub.epa.gov/ecotox",
    },
    {
      name: "FDA Inactive Ingredient Guide (IIG)",
      status: "live",
      detail: "Formulation excipient safety limits — BCS-based bioavailability enhancement selection",
      url: "https://www.accessdata.fda.gov/scripts/cder/iig",
    },
  ];
}

function buildL3Sources(sr: SimResults | null): SrcEntry[] {
  return [
    {
      name: "Trial Simulation Engine",
      status: "estimated",
      detail: "Power: exact normal CDF — KM curves: Weibull parametric — O'Brien–Fleming α-spending adaptive boundaries",
    },
    {
      name: "Drugs@FDA API",
      status: sr?.similarDrugs?.length ? "live" : "unavailable",
      detail: sr?.similarDrugs?.length
        ? `NDA/BLA precedent: ${sr.similarDrugs.join(", ")} — approval history, Priority vs Standard review`
        : "No similar drugs — FDA precedent not queried",
      url: "https://api.fda.gov/drug/drugsfda.json",
    },
    {
      name: "openFDA FAERS (Class AE Signal)",
      status: sr?.similarDrugs?.length ? "live" : "unavailable",
      detail: sr?.similarDrugs?.length
        ? `Post-market AE class signal for ${sr.similarDrugs[0]}`
        : "No similar drugs queried",
      url: "https://api.fda.gov/drug/event.json",
    },
    {
      name: "FDA Phase III Precedent (inferred)",
      status: "estimated",
      detail: "Endpoint and sample size precedent inferred from approved similar drugs and indication class",
    },
  ];
}

const L1_REFS: RefEntry[] = [
  { code: "ICH M3(R2)", title: "Nonclinical Safety Studies for Human Clinical Trials and Marketing Authorization (2009)", url: "https://database.ich.org/sites/default/files/M3_R2__Guideline.pdf" },
  { code: "ICH S7A",    title: "Safety Pharmacology Studies for Human Pharmaceuticals (2001)" },
  { code: "ICH S7B",    title: "Nonclinical Evaluation of the Potential for Delayed Ventricular Repolarization (hERG) (2005)" },
  { code: "ICH S2(R1)", title: "Genotoxicity Testing and Data Interpretation for Pharmaceuticals — Ames Test & Micronucleus (2012)" },
  { code: "FDA IND",    title: "Investigational New Drug Application — IND Phase I Guidance (2019)", url: "https://www.fda.gov/drugs/investigational-new-drug-ind-application" },
  { code: "Lipinski RO5", title: "Lipinski et al. — Experimental and Computational Approaches to Estimate Solubility and Permeability, Adv Drug Deliv Rev 1997;23:3–25" },
  { code: "FDA BCS",    title: "FDA Biopharmaceutics Classification System — Absorption ≥70% threshold (Class I/II)" },
];

const L2_REFS: RefEntry[] = [
  { code: "ICH M3(R2)", title: "Nonclinical Safety Studies — timing of non-clinical relative to clinical (2009)" },
  { code: "ICH E14",    title: "Clinical Evaluation of QT/QTc Interval Prolongation and Proarrhythmic Potential (2005)" },
  { code: "FDA PopPK",  title: "FDA Guidance: Population Pharmacokinetics (2022)", url: "https://www.fda.gov/media/128793/download" },
  { code: "FDA MRSD",   title: "FDA Guidance: Estimating the Maximum Safe Starting Dose in Initial Clinical Trials (2005)" },
  { code: "NHANES",     title: "CDC National Health and Nutrition Examination Survey 2017–2020 — physiological parameter distributions" },
  { code: "FAERS",      title: "FDA Adverse Event Reporting System — MedDRA v26.0 Preferred Terms" },
  { code: "PK-Sim OSP", title: "PK-Sim® Open Systems Pharmacology — 2-compartment PBPK physiological parameters" },
];

const L3_REFS: RefEntry[] = [
  { code: "21 CFR 312.82", title: "FDA Breakthrough Therapy Designation criteria and expedited program procedures" },
  { code: "ICH E9(R1)", title: "Statistical Principles for Clinical Trials — Estimands and Sensitivity Analysis (2019)" },
  { code: "FDA Adaptive", title: "FDA Guidance: Adaptive Design Clinical Trials for Drugs and Biologics (2019)", url: "https://www.fda.gov/regulatory-information/search-fda-guidance-documents/adaptive-design-clinical-trials-drugs-and-biologics-guidance-industry" },
  { code: "PDUFA VII",  title: "Prescription Drug User Fee Act VII — Priority Review 6-month standard, Standard Review 12-month" },
  { code: "FDA BT 2018", title: "FDA Guidance: Expedited Programs for Serious Conditions — Breakthrough Therapy (2018)" },
  { code: "ICH E14",    title: "QT/QTc Interval monitoring requirements carried into Phase III design" },
  { code: "FDA NDA",    title: "FDA NDA/BLA Submission — 505(b)(1) and 505(b)(2) pathway criteria" },
];

function SimulationDataSources({
  layer,
  simResults,
  cohortResults,
  uniprotId = "",
  pdbId = "",
  proteinName = "",
  alphafoldPlddt = null,
}: {
  layer: 1 | 2 | 3;
  simResults?: SimResults | null;
  cohortResults?: CohortResults | null;
  uniprotId?: string;
  pdbId?: string;
  proteinName?: string;
  alphafoldPlddt?: number | null;
}) {
  const [open, setOpen] = useState(false);

  const sources: SrcEntry[] =
    layer === 1 ? buildL1Sources(simResults ?? null, uniprotId, pdbId, proteinName, alphafoldPlddt) :
    layer === 2 ? buildL2Sources(cohortResults ?? null, simResults ?? null) :
                  buildL3Sources(simResults ?? null);

  const refs: RefEntry[] = layer === 1 ? L1_REFS : layer === 2 ? L2_REFS : L3_REFS;

  const liveCount = sources.filter(s => s.status === "live").length;
  const layerColor = layer === 1 ? "violet" : layer === 2 ? "blue" : "emerald";
  const borderCls = layerColor === "violet" ? "border-violet-500/20" : layerColor === "blue" ? "border-blue-500/20" : "border-emerald-500/20";
  const textAccent = layerColor === "violet" ? "text-violet-400" : layerColor === "blue" ? "text-blue-400" : "text-emerald-400";

  return (
    <div className={`border ${borderCls} rounded-xl overflow-hidden bg-white/[0.02]`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Database className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-[11px] font-semibold text-slate-300">Data Sources & References</span>
          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 ${textAccent}`}>
            {liveCount} LIVE · {sources.length - liveCount} ESTIMATED
          </span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-600 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-4 pb-5 pt-1 space-y-5 border-t border-white/5">

          {/* Database Queries */}
          <div>
            <div className="text-[9px] font-semibold text-slate-500 uppercase tracking-widest mb-3 mt-3">Database Queries Made</div>
            <div className="space-y-2">
              {sources.map(src => (
                <div key={src.name} className="flex items-start gap-2.5">
                  <span className={`text-[11px] font-mono mt-0.5 shrink-0 ${
                    src.status === "live" ? "text-emerald-400" :
                    src.status === "estimated" ? "text-amber-400" : "text-slate-600"
                  }`}>
                    {src.status === "live" ? "✓" : src.status === "estimated" ? "~" : "—"}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[11px] font-medium ${
                        src.status === "live" ? "text-slate-200" :
                        src.status === "estimated" ? "text-slate-400" : "text-slate-600"
                      }`}>{src.name}</span>
                      <span className={`text-[8px] font-semibold px-1 py-0.5 rounded ${
                        src.status === "live" ? "bg-emerald-500/10 text-emerald-500" :
                        src.status === "estimated" ? "bg-amber-500/10 text-amber-500" :
                        "bg-white/5 text-slate-600"
                      }`}>
                        {src.status === "live" ? "LIVE" : src.status === "estimated" ? "ESTIMATED" : "N/A"}
                      </span>
                      {src.url && (
                        <a href={src.url} target="_blank" rel="noopener noreferrer"
                           className="text-[9px] text-blue-500 hover:text-blue-400 transition-colors">↗</a>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{src.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Regulatory References */}
          <div>
            <div className="text-[9px] font-semibold text-slate-500 uppercase tracking-widest mb-3">Regulatory Guidance References</div>
            <div className="space-y-1.5">
              {refs.map(ref => (
                <div key={ref.code} className="flex items-baseline gap-2.5">
                  <span className={`text-[9px] font-mono shrink-0 w-24 ${textAccent}`}>{ref.code}</span>
                  <span className="text-[10px] text-slate-400 leading-relaxed">
                    {ref.title}
                    {ref.url && (
                      <a href={ref.url} target="_blank" rel="noopener noreferrer"
                         className="ml-1 text-blue-500 hover:text-blue-400">↗</a>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Disclaimer */}
          <div className="rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2.5">
            <div className="text-[9px] text-amber-600/90 leading-relaxed">
              <span className="font-semibold text-amber-500">Important:</span> All simulations are in silico estimates intended for early-stage hypothesis generation. Results must be validated against experimental data. LIVE badge indicates a real-time API query was made; ESTIMATED indicates the value was derived from computational rules. HakaseAI output does not constitute regulatory advice and should not substitute for formal regulatory consultation with qualified experts.
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

// ── Regulatory Insight Card (all 3 layers) ───────────────────────────────
function RegulatoryInsightCard({
  layer, indication, simResults: sr, cohortResults: cr, trialResults: tr, similarDrugs,
}: {
  layer: 1 | 2 | 3;
  indication: string;
  simResults?: SimResults | null;
  cohortResults?: CohortResults | null;
  trialResults?: TrialResults | null;
  similarDrugs?: string[];
}) {
  const indLower   = indication.toLowerCase();
  const isOncology = /c\d{2}|carcinoma|lymphoma|leukemia|melanoma|sarcoma|glioma|myeloma|tumor|cancer/i.test(indication);
  const isRare     = /orphan|rare|ultra-rare|wilson|gaucher|fabry|pompe/i.test(indication);
  const isNeuro    = /alzheimer|parkinson|sclerosis|epilepsy|ad\b|ms\b/i.test(indLower);
  const appType    = isOncology ? "BLA / NDA (oncology)" : "NDA (small molecule)";

  // L1 derived signals
  const toxAlerts  = sr?.toxAlerts ?? [];
  const hergFlag   = toxAlerts.some(a => /herg|cardiac|qt/i.test(a.name + a.detail));
  const mutagFlag  = toxAlerts.some(a => /mutagen|genotox|ames/i.test(a.category + a.name));
  const metabFlag  = toxAlerts.some(a => /cyp|metabol|reactive/i.test(a.category + a.name));
  const admet      = sr?.admet;
  const logP       = sr?.lipinski?.logP ?? 2;
  const mw         = sr?.lipinski?.mw   ?? 400;
  const saScore    = sr?.saScore ?? 2.5;

  // L2 derived signals
  const halfLife   = cr?.halfLifeHr   ?? 0;
  const cmax       = cr?.cmax ? cr.cmax * 1000 : 0;
  const auc        = cr?.auc  ?? 0;
  const grade3Rate = cr?.grade3AERate ?? 0;
  const pkCV       = cr?.cmaxSD && cr?.cmax ? (cr.cmaxSD / cr.cmax) * 100 : 35;
  const mrsdEst    = cmax > 0 ? (cmax * 0.1).toFixed(0) : "—";
  const dosInterval = halfLife > 0 ? (halfLife < 8 ? "BID–TID" : halfLife < 16 ? "QD–BID" : "QD") : "QD";

  // L3 derived signals
  const power   = tr?.power             ?? 0;
  const succP   = tr?.successProbability ?? 0;
  const hr      = tr?.hazardRatio        ?? 1;
  const durMo   = tr?.estimatedDuration  ?? 36;
  const btEligible  = (power >= 0.80 && succP >= 0.70 && hr < 0.75) || isNeuro;
  const ftEligible  = isOncology || isNeuro || isRare || succP >= 0.60;
  const orphEligible = isRare || (isOncology && /rare|small cell|aml|all\b/i.test(indLower));
  const accelApproval = isOncology && hr < 0.70;

  const colorMap: Record<string, string> = {
    slate: "text-slate-400", violet: "text-violet-400",
    blue: "text-blue-400", amber: "text-amber-400",
    emerald: "text-emerald-400", red: "text-red-400",
  };
  const borderMap: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/5",
    blue:    "border-blue-500/30 bg-blue-500/5",
    amber:   "border-amber-500/30 bg-amber-500/5",
    violet:  "border-violet-500/30 bg-violet-500/5",
  };

  // ── openFDA live data ─────────────────────────────────────────────────
  const [fdaLabelData, setFdaLabelData] = useState<Record<string, boolean>>({});
  const [fdaFaers, setFdaFaers]         = useState<Array<{ term: string; count: number; rate: number }>>([]);
  const [fdaTotalReports, setFdaTotalReports] = useState(0);
  const [fdaDrugs, setFdaDrugs]         = useState<Record<string, { appNumber: string; reviewType: string; approvalYear?: string }>>({});

  const allSimilarDrugs = layer === 1 ? (sr?.similarDrugs ?? []) : (similarDrugs ?? []);
  const drugsKey        = allSimilarDrugs.join(",");

  useEffect(() => {
    if (!drugsKey) return;
    const drugs = drugsKey.split(",").filter(Boolean);
    if (drugs.length === 0) return;
    const firstDrug = drugs[0];

    if (layer === 1) {
      Promise.all(
        drugs.slice(0, 4).map(drug => {
          const enc = encodeURIComponent(drug.toLowerCase());
          return fetch(`https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${enc}"&limit=1`)
            .then(r => r.ok ? r.json() : null).catch(() => null)
            .then(data => ({ drug, boxed: !!(data?.results?.[0]?.boxed_warning) }));
        })
      ).then(results => {
        const map: Record<string, boolean> = {};
        results.forEach(({ drug, boxed }) => { map[drug] = boxed; });
        setFdaLabelData(map);
      });
    }

    if (layer === 2) {
      const enc = encodeURIComponent(firstDrug.toLowerCase());
      Promise.all([
        fetch(`https://api.fda.gov/drug/event.json?search=patient.drug.openfda.generic_name:"${enc}"&limit=1`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`https://api.fda.gov/drug/event.json?search=patient.drug.openfda.generic_name:"${enc}"&count=patient.reaction.reactionmeddrapt.exact&limit=8`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]).then(([totalData, countData]) => {
        const total: number = (totalData as any)?.meta?.results?.total ?? 0;
        const rows: Array<{ term: string; count: number }> = (countData as any)?.results ?? [];
        setFdaTotalReports(total);
        setFdaFaers(rows.map(r => ({ term: r.term, count: r.count, rate: total > 0 ? r.count / total : 0 })));
      });
    }

    if (layer === 3) {
      Promise.all(
        drugs.slice(0, 4).map(drug => {
          const enc = encodeURIComponent(drug.toLowerCase());
          return fetch(`https://api.fda.gov/drug/drugsfda.json?search=openfda.generic_name:"${enc}"&limit=1`)
            .then(r => r.ok ? r.json() : null).catch(() => null)
            .then(data => {
              const r = (data as any)?.results?.[0];
              if (!r) return { drug, appNumber: null as string | null, reviewType: null as string | null, approvalYear: null as string | null };
              const subs: Array<{ submission_type?: string; review_priority?: string; submission_status_date?: string }> = r.submissions ?? [];
              const orig = subs.find(s => s.submission_type === "ORIG" || s.submission_type?.startsWith("ORIG-")) ?? subs[0];
              return { drug, appNumber: r.application_number ?? null, reviewType: orig?.review_priority ?? null, approvalYear: orig?.submission_status_date?.slice(0, 4) ?? null };
            });
        })
      ).then(results => {
        const map: Record<string, { appNumber: string; reviewType: string; approvalYear?: string }> = {};
        results.forEach(r => { if (r.appNumber) map[r.drug] = { appNumber: r.appNumber, reviewType: r.reviewType ?? "STANDARD", approvalYear: r.approvalYear ?? undefined }; });
        setFdaDrugs(map);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, drugsKey]);
  // ─────────────────────────────────────────────────────────────────────

  const subtitles: Record<number, string> = {
    1: "In Vitro & Preclinical Regulatory Flags",
    2: "Clinical Pharmacology Regulatory Package",
    3: "Development Pathway & Designation Strategy",
  };
  const accentColors: Record<number, string> = {
    1: "text-violet-400", 2: "text-blue-400", 3: "text-emerald-400",
  };
  const borderAccents: Record<number, string> = {
    1: "border-violet-500/20", 2: "border-blue-500/20", 3: "border-emerald-500/20",
  };

  return (
    <div className={`rounded-xl border ${borderAccents[layer]} bg-white/2 p-4 space-y-4`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Shield className={`w-4 h-4 ${accentColors[layer]}`} />
        <div>
          <div className="text-[12px] font-semibold text-white">Regulatory Outlook</div>
          <div className="text-[10px] text-slate-500">{subtitles[layer]} · {appType} · FDA/EMA</div>
        </div>
      </div>

      {/* ── LAYER 1: In Vitro / Preclinical ── */}
      {layer === 1 && (
        <div className="space-y-3">
          {/* Preclinical Flags */}
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Preclinical Safety Flags (from ADMET profile)</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "hERG / Cardiac QT",   flagged: hergFlag,  detail: hergFlag  ? "hERG inhibition detected — cardiac safety study mandatory" : "Low cardiac liability predicted" },
                { label: "Mutagenicity / Genotox", flagged: mutagFlag, detail: mutagFlag ? "Mutagenicity alert — full Ames + MN battery required" : "No genotoxicity structural alerts" },
                { label: "CYP / Reactive Metabolite", flagged: metabFlag, detail: metabFlag ? "CYP interaction risk — in vitro DDI panel required" : "Moderate CYP interaction potential" },
              ].map(({ label, flagged, detail }) => (
                <div key={label} className={`rounded-lg border p-2.5 ${flagged ? "border-red-500/30 bg-red-500/5" : "border-white/8 bg-white/2"}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    {flagged ? <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" /> : <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
                    <span className={`text-[10px] font-semibold ${flagged ? "text-red-300" : "text-slate-300"}`}>{label}</span>
                  </div>
                  <div className="text-[9px] text-slate-500 leading-snug">{detail}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Required IND Package */}
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Required IND-Enabling Package</div>
            <div className="space-y-1.5">
              {[
                { study: "GLP Repeat-Dose Toxicology",     note: "Rat + Dog, 28-day min",                      priority: hergFlag || mutagFlag ? "Urgent" : "Required" },
                { study: "Genotoxicity Battery",            note: "Ames + in vitro MN" + (mutagFlag ? " + in vivo MN (flagged)" : ""), priority: mutagFlag ? "Urgent" : "Required" },
                { study: "Safety Pharmacology (ICH S7A/B)", note: hergFlag ? "hERG patch-clamp mandatory" : "hERG, CNS, respiratory panels", priority: hergFlag ? "Urgent" : "Required" },
                { study: "ADME / Metabolite Profiling",     note: metabFlag ? "In vitro DDI panel + reactive metabolite trapping" : "Human microsomes + hepatocytes", priority: metabFlag ? "High" : "Required" },
                { study: "CMC & GMP Synthesis",             note: `MW=${mw.toFixed(0)} Da · SA=${saScore.toFixed(1)} — ${saScore > 3.5 ? "complex synthesis, early route scouting" : "standard synthesis"}`, priority: "Required" },
                { study: "Carcinogenicity",                 note: "Rat + Mouse, 2-year",                        priority: isRare ? "Waivable" : "Phase III" },
              ].map(({ study, note, priority }) => (
                <div key={study} className="flex items-start gap-2">
                  <div className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${priority === "Urgent" ? "bg-red-400" : priority === "High" ? "bg-amber-400" : priority === "Required" ? "bg-violet-400" : "bg-slate-600"}`} />
                  <div className="flex-1 flex items-baseline justify-between gap-2">
                    <div>
                      <span className="text-[11px] text-slate-200">{study}</span>
                      <span className="text-[10px] text-slate-500 ml-1.5 leading-snug">({note})</span>
                    </div>
                    <span className={`text-[10px] shrink-0 font-medium ${priority === "Urgent" ? "text-red-400" : priority === "High" ? "text-amber-400" : priority === "Required" ? "text-violet-400" : "text-slate-500"}`}>
                      {priority}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ADMET vs FDA thresholds */}
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Physicochemical vs FDA Guidance Thresholds</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "LogP",   val: logP.toFixed(1), thresh: "≤ 5 (RO5)", ok: logP <= 5  },
                { label: "MW",     val: `${mw.toFixed(0)} Da`, thresh: "≤ 500 Da",    ok: mw <= 500  },
                { label: "Absorption", val: admet ? `${(admet.absorption * 100).toFixed(0)}%` : "—", thresh: "≥ 70% (BCS I/II)", ok: (admet?.absorption ?? 0) >= 0.70 },
              ].map(({ label, val, thresh, ok }) => (
                <div key={label} className={`rounded-lg border p-2 ${ok ? "border-white/8" : "border-amber-500/30 bg-amber-500/5"}`}>
                  <div className={`text-[12px] font-bold ${ok ? "text-white" : "text-amber-300"}`}>{val}</div>
                  <div className="text-[10px] text-slate-400">{label}</div>
                  <div className="text-[9px] text-slate-600">{thresh}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Precedent drugs — with live openFDA drug label boxed-warning badge */}
          {sr?.similarDrugs && sr.similarDrugs.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Approved Precedent Drugs (Same Class)</div>
                {Object.keys(fdaLabelData).length > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[8px] bg-violet-500/10 text-violet-400 border border-violet-500/20 font-mono">LIVE · openFDA Labels</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {sr.similarDrugs.map(d => (
                  <span key={d} className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-[10px] text-violet-300">
                    {d}
                    {fdaLabelData[d] === true && (
                      <span className="px-1 rounded text-[8px] bg-red-500/20 text-red-400 border border-red-500/30 font-mono">BOXED ⚠</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── LAYER 2: Clinical Pharmacology ── */}
      {layer === 2 && (
        <div className="space-y-3">
          {/* Phase I Dose Strategy */}
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Phase I Dose Strategy (from PBPK)</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "MRSD Estimate",     val: `~${mrsdEst} ng/mL`,    note: "1/10 × Cmax (conservative)", color: "blue"    },
                { label: "Dosing Interval",   val: dosInterval,             note: `t½ = ${halfLife.toFixed(1)} h`, color: "violet"  },
                { label: "Grade ≥3 AE Rate",  val: `${(grade3Rate * 100).toFixed(1)}%`, note: grade3Rate > 0.15 ? "Exceeds 15% — DLT risk" : "Within acceptable range", color: grade3Rate > 0.15 ? "amber" : "emerald" },
              ].map(({ label, val, note, color }) => {
                const cardBorder = color === "blue" ? "border-blue-500/20 bg-blue-500/5" : color === "violet" ? "border-violet-500/20 bg-violet-500/5" : color === "amber" ? "border-amber-500/20 bg-amber-500/5" : "border-emerald-500/20 bg-emerald-500/5";
                return (
                <div key={label} className={`rounded-lg border p-2.5 ${cardBorder}`}>
                  <div className={`text-[13px] font-bold ${colorMap[color]}`}>{val}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{label}</div>
                  <div className="text-[9px] text-slate-500 mt-0.5">{note}</div>
                </div>
                ); })}

            </div>
          </div>

          {/* FDA Clinical Pharmacology Package */}
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">FDA Clinical Pharmacology Package Required</div>
            <div className="space-y-1.5">
              {[
                { study: "SAD Study",                  note: "Single-Ascending Dose — primary PK characterisation",              req: true  },
                { study: "MAD Study",                  note: "Multiple-Ascending Dose — steady-state and accumulation",           req: true  },
                { study: "Food Effect Study",           note: `AUC change at high-fat meal — ${logP > 3 ? "likely significant (logP > 3)" : "low risk predicted"}`, req: true  },
                { study: "Renal Impairment Study",     note: `${auc > 0 ? `AUC${auc.toFixed(0)} µg·h/mL — assess dose adj` : "renal elimination assessment"}`, req: true  },
                { study: "Hepatic Impairment Study",   note: "Child-Pugh A/B/C — CYP metabolism characterisation",               req: true  },
                { study: "QT/QTc (TQT) Study",        note: hergFlag ? "Mandatory (hERG flag from L1)" : "Likely required per ICH E14", req: true  },
                { study: "DDI Studies (CYP Panel)",   note: metabFlag ? "High priority (CYP flag from L1) — full in vitro / in vivo" : `PK CV=${pkCV.toFixed(0)}% — standard panel`, req: true  },
                { study: "Popln PK / Exposure-Response", note: "E-R analysis for dose selection and label",                      req: false },
              ].map(({ study, note, req }) => (
                <div key={study} className="flex items-start gap-2">
                  <div className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${req ? "bg-blue-400" : "bg-slate-600"}`} />
                  <div className="flex-1 flex items-baseline justify-between gap-2">
                    <div>
                      <span className="text-[11px] text-slate-200">{study}</span>
                      <span className="text-[10px] text-slate-500 ml-1.5">({note})</span>
                    </div>
                    <span className={`text-[10px] shrink-0 font-medium ${req ? "text-blue-400" : "text-slate-500"}`}>{req ? "Required" : "Recommended"}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* PK Variability Assessment */}
          <div className={`rounded-lg border p-3 ${pkCV > 50 ? "border-amber-500/30 bg-amber-500/5" : "border-white/8"}`}>
            <div className="flex items-center gap-1.5 mb-1">
              {pkCV > 50 ? <AlertTriangle className="w-3 h-3 text-amber-400" /> : <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
              <span className="text-[11px] font-semibold text-white">PK Variability (Cmax CV%: {pkCV.toFixed(0)}%)</span>
            </div>
            <div className="text-[10px] text-slate-400">
              {pkCV > 50
                ? "High inter-patient variability — FDA will require therapeutic drug monitoring guidance and a concentration-response analysis for label."
                : "Acceptable variability — standard dosing regimen supportable without TDM requirement."}
            </div>
          </div>

          {/* AE Signals — real openFDA FAERS data when available, fallback to simulated */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                {fdaFaers.length > 0 ? "Real-World AE Signal for Label" : "FAERS-Calibrated AE Signals for Label"}
              </div>
              {fdaFaers.length > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[8px] bg-blue-500/15 text-blue-400 border border-blue-500/25 font-mono">LIVE · FDA FAERS</span>
              )}
            </div>
            {fdaFaers.length > 0 ? (
              <>
                <div className="text-[9px] text-slate-600 mb-1.5">
                  Based on {allSimilarDrugs[0]} · {fdaTotalReports.toLocaleString()} post-market reports · normalized reporting rate
                </div>
                <div className="space-y-1">
                  {fdaFaers.slice(0, 5).map(ae => (
                    <div key={ae.term} className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-300">{ae.term}</span>
                      <span className="text-[10px] text-slate-500">
                        Rate: <span className="text-white">{(ae.rate * 100).toFixed(2)}%</span>
                        <span className="text-slate-600 ml-1">({ae.count.toLocaleString()} reports)</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="text-[9px] text-slate-600 mt-1.5">These will inform the WARNINGS AND PRECAUTIONS section of the product label. Source: openFDA FAERS.</div>
              </>
            ) : cr?.adverseEvents && cr.adverseEvents.length > 0 ? (
              <>
                <div className="space-y-1">
                  {cr.adverseEvents.slice(0, 4).map(ae => (
                    <div key={ae.name} className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-300">{ae.name}</span>
                      <div className="flex gap-3">
                        <span className="text-[10px] text-slate-500">Any-grade: <span className="text-white">{ae.anyGrade.toFixed(1)}%</span></span>
                        <span className={`text-[10px] ${ae.grade3Plus > 10 ? "text-amber-400" : "text-slate-500"}`}>Gr≥3: {ae.grade3Plus.toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-[9px] text-slate-600 mt-1.5">These will inform the WARNINGS AND PRECAUTIONS section of the product label.</div>
              </>
            ) : (
              <div className="text-[10px] text-slate-600 italic">Loading FAERS signals…</div>
            )}
          </div>
        </div>
      )}

      {/* ── LAYER 3: Pathway & Designation ── */}
      {layer === 3 && (
        <div className="space-y-3">
          {/* Designation Eligibility */}
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">FDA Designation Eligibility</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { name: "Breakthrough Therapy",    eligible: btEligible,    detail: "≥80% power, HR<0.75, substantial improvement",  color: "emerald" },
                { name: "Fast Track",              eligible: ftEligible,    detail: "Serious condition + unmet medical need",          color: "blue"    },
                { name: "Accelerated Approval",    eligible: accelApproval, detail: "Surrogate endpoint acceptable (HR<0.70)",         color: "amber"   },
                { name: "Orphan Drug Designation", eligible: orphEligible,  detail: "< 200,000 US patients / year",                    color: "violet"  },
              ].map(({ name, eligible, detail, color }) => (
                <div key={name} className={`rounded-lg border p-2.5 ${eligible ? borderMap[color] : "border-white/5 opacity-40"}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    {eligible ? <CheckCircle2 className={`w-3 h-3 ${colorMap[color]}`} /> : <XCircle className="w-3 h-3 text-slate-600" />}
                    <span className={`text-[10px] font-semibold ${eligible ? "text-white" : "text-slate-600"}`}>{name}</span>
                  </div>
                  <div className={`text-[9px] ${eligible ? "text-slate-400" : "text-slate-700"}`}>{detail}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Full Development Timeline */}
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Estimated Development Timeline to Approval</div>
            <div className="space-y-2">
              {[
                { phase: "IND-Enabling Studies",        duration: "6–9 months",   color: "slate"   },
                { phase: "IND Filing + 30-day Review",  duration: "1–2 months",   color: "violet"  },
                { phase: "Phase I (Safety / Dose)",     duration: "12–18 months", color: "blue"    },
                { phase: "Phase II (Proof of Concept)", duration: "18–30 months", color: "amber"   },
                { phase: "Phase III (Pivotal — simulated)", duration: `${durMo} months`, color: "emerald" },
                { phase: "NDA / BLA + PDUFA Review",   duration: btEligible ? "6 months (Priority)" : "12 months (Standard)", color: "red" },
              ].map(({ phase, duration, color }, i) => (
                <div key={phase} className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border ${colorMap[color]} border-current shrink-0`}>
                    {i + 1}
                  </div>
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-[11px] text-slate-300">{phase}</span>
                    <span className={`text-[11px] font-semibold ${colorMap[color]}`}>{duration}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Adaptive trial regulatory note */}
          {tr?.interimAnalyses && tr.interimAnalyses.length > 0 && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="text-[10px] font-semibold text-emerald-300 mb-1">Adaptive Design — Regulatory Precedent</div>
              <div className="text-[10px] text-slate-400">
                {tr.interimAnalyses.length} interim look{tr.interimAnalyses.length > 1 ? "s" : ""} detected in the trial simulation.
                FDA requires a pre-specified Statistical Analysis Plan (SAP) and blinded DMC charter filed with the IND before enrollment.
                O'Brien-Fleming boundaries are widely accepted; Bayesian adaptive designs require a simulations-based package.
              </div>
            </div>
          )}

          {/* Precedent drugs — with live Drugs@FDA NDA/BLA metadata */}
          {similarDrugs && similarDrugs.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Approved Precedent Drugs (Same Class)</div>
                {Object.keys(fdaDrugs).length > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[8px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">LIVE · Drugs@FDA</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {similarDrugs.map(d => (
                  <div key={d} className="flex flex-col px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                    <span className="text-[10px] text-emerald-300 font-semibold">{d}</span>
                    {fdaDrugs[d] ? (
                      <span className="text-[9px] text-slate-500 mt-0.5">
                        {fdaDrugs[d].appNumber}
                        {" · "}
                        {fdaDrugs[d].reviewType === "PRIORITY"
                          ? <span className="text-amber-400">Priority Review</span>
                          : <span>Standard Review</span>
                        }
                        {fdaDrugs[d].approvalYear && <span className="text-slate-600"> · {fdaDrugs[d].approvalYear}</span>}
                      </span>
                    ) : (
                      <span className="text-[9px] text-slate-700">Loading…</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="text-[9px] text-slate-600 mt-1.5">Review approval dossiers for endpoint precedent, primary analysis methods, and required safety data packages.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Layer 1 Results ───────────────────────────────────────────────────
type AiReport = {
  molecularOverview?: string;
  safetyNarrative?: string;
  pkAnalysis?: string;
  targetEngagement?: string;
  cohortInsights?: string;
  trialDesignRationale?: string;
  competitiveContext?: string;
  regulatoryPathway?: string;
  riskMitigations?: string[];
  goNogoRationale?: string;
  nextSteps?: string[];
};

// ── Layer 2 Animal Cohort Results ─────────────────────────────────────────────

function Layer2AnimalResults({ ar, molName }: { ar: AnimalCohortResults; molName: string }) {
  const riskColors = { low: "text-emerald-400", moderate: "text-amber-400", high: "text-red-400" } as const;
  const riskBgs   = { low: "bg-emerald-500/10 border-emerald-500/25", moderate: "bg-amber-500/10 border-amber-500/25", high: "bg-red-500/10 border-red-500/25" } as const;
  const groupColors: Record<string, string> = {
    control: "bg-slate-500/20 text-slate-300", low: "bg-blue-500/20 text-blue-300",
    mid: "bg-amber-500/20 text-amber-300", high: "bg-red-500/20 text-red-300",
    recovery: "bg-emerald-500/20 text-emerald-300", satellite: "bg-violet-500/20 text-violet-300",
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Rabbit className="w-4 h-4 text-amber-400" />
            <h3 className="text-[15px] font-semibold text-white">Animal Cohort Results</h3>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${riskBgs[ar.overallRisk]}`}>
              {ar.overallRisk.toUpperCase()} RISK
            </span>
          </div>
          <p className="text-[12px] text-slate-500">{ar.species.displayName} · {ar.studyType.label} · {ar.routeOfAdmin}</p>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-slate-500">Total animals</div>
          <div className="text-[20px] font-bold text-amber-300">{ar.totalAnimals}</div>
          <div className="text-[10px] text-slate-600">${ar.estimatedCostM.toFixed(2)}M est.</div>
        </div>
      </div>

      {/* Core PBPK Metrics */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "NOAEL", val: `${ar.noael} mg/kg`, sub: `Range ${ar.loqNoael}–${ar.hiNoael}`, color: "emerald" },
          { label: "MTD", val: `${ar.mtd.toFixed(1)} mg/kg`, sub: "Maximum tolerated dose", color: "amber" },
          { label: "t½ (animal)", val: `${ar.animalHalfLife.toFixed(1)}h`, sub: `Cmax ${ar.animalCmax.toFixed(0)} ng/mL`, color: "blue" },
        ].map(m => (
          <div key={m.label} className={`p-3 rounded-xl border bg-${m.color}-500/8 border-${m.color}-500/20`}>
            <div className={`text-[10px] font-semibold text-${m.color}-400 uppercase tracking-widest mb-1`}>{m.label}</div>
            <div className="text-[18px] font-bold text-white">{m.val}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{m.sub}</div>
          </div>
        ))}
      </div>

      {/* PK Curves: Animal vs Projected Human */}
      <div className="p-4 rounded-xl bg-white/3 border border-white/8">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest">PK Profiles</span>
          <div className="flex items-center gap-3 text-[10px]">
            <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-amber-400 rounded"/><span className="text-amber-300">{ar.species.species}</span></div>
            <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-blue-400 rounded"/><span className="text-blue-300">Human (projected)</span></div>
          </div>
        </div>
        {(() => {
          const W = 500;
          const H = 150;
          const pad = { t: 10, r: 10, b: 22, l: 44 };
          const pw = W - pad.l - pad.r;
          const ph = H - pad.t - pad.b;

          const aCurve = ar.animalPkCurve;
          const hCurve = ar.humanPkCurve;
          const allConc = [...aCurve.map(p => p.conc), ...hCurve.map(p => p.conc)];
          const maxConc = Math.max(...allConc, 0.01);
          const maxTime = Math.max(aCurve[aCurve.length - 1]?.time ?? 1, hCurve[hCurve.length - 1]?.time ?? 1);

          const toX = (t: number) => pad.l + (t / maxTime) * pw;
          const toY = (c: number) => pad.t + ph - (c / maxConc) * ph;

          const subsample = (curve: typeof aCurve, n: number) => {
            if (curve.length <= n) return curve;
            const step = Math.max(1, Math.floor(curve.length / n));
            return curve.filter((_, i) => i % step === 0).slice(0, n);
          };

          const aPoints = subsample(aCurve, 60);
          const hPoints = subsample(hCurve, 60);

          const buildPath = (pts: typeof aPoints) =>
            pts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.time).toFixed(1)},${toY(p.conc).toFixed(1)}`).join(" ");

          const buildAreaPath = (pts: typeof aPoints) =>
            buildPath(pts) + ` L${toX(pts[pts.length - 1].time).toFixed(1)},${toY(0).toFixed(1)} L${toX(pts[0].time).toFixed(1)},${toY(0).toFixed(1)} Z`;

          const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxConc);
          const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxTime);

          const formatConc = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 1 ? v.toFixed(0) : v.toFixed(2);

          return (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
              {yTicks.map((v, i) => (
                <g key={`y${i}`}>
                  <line x1={pad.l} x2={W - pad.r} y1={toY(v)} y2={toY(v)} stroke="#334155" strokeWidth="0.5" strokeDasharray={i === 0 ? "none" : "2,2"} />
                  <text x={pad.l - 4} y={toY(v) + 3} textAnchor="end" fill="#64748b" fontSize="7" fontFamily="monospace">{formatConc(v)}</text>
                </g>
              ))}
              {xTicks.map((v, i) => (
                <text key={`x${i}`} x={toX(v)} y={H - 4} textAnchor="middle" fill="#64748b" fontSize="7" fontFamily="monospace">{v.toFixed(0)}h</text>
              ))}
              <text x={2} y={pad.t + ph / 2} textAnchor="middle" fill="#64748b" fontSize="6" fontFamily="monospace" transform={`rotate(-90, 2, ${pad.t + ph / 2})`}>ng/mL</text>

              <path d={buildAreaPath(hPoints)} fill="rgba(59,130,246,0.08)" />
              <path d={buildPath(hPoints)} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4,2" opacity="0.8" />

              <path d={buildAreaPath(aPoints)} fill="rgba(245,158,11,0.1)" />
              <path d={buildPath(aPoints)} fill="none" stroke="#f59e0b" strokeWidth="1.5" opacity="0.9" />

              {aPoints.length > 0 && (() => {
                const peak = aPoints.reduce((best, p) => p.conc > best.conc ? p : best, aPoints[0]);
                return (
                  <g>
                    <circle cx={toX(peak.time)} cy={toY(peak.conc)} r="2.5" fill="#f59e0b" stroke="#0f172a" strokeWidth="1" />
                    <text x={toX(peak.time)} y={toY(peak.conc) - 5} textAnchor="middle" fill="#fbbf24" fontSize="6.5" fontFamily="monospace" fontWeight="bold">
                      Cmax {formatConc(peak.conc)}
                    </text>
                  </g>
                );
              })()}
              {hPoints.length > 0 && (() => {
                const peak = hPoints.reduce((best, p) => p.conc > best.conc ? p : best, hPoints[0]);
                return (
                  <circle cx={toX(peak.time)} cy={toY(peak.conc)} r="2" fill="#3b82f6" stroke="#0f172a" strokeWidth="1" />
                );
              })()}
            </svg>
          );
        })()}
        <div className="flex justify-between text-[9px] text-slate-600 mt-1">
          <span>Concentration–Time Profile</span>
          <span>Cmax / AUC derived from 1-compartment PBPK</span>
        </div>
      </div>

      {/* Study Groups */}
      <div className="p-4 rounded-xl bg-white/3 border border-white/8">
        <div className="flex items-center gap-2 mb-3">
          <Database className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest">Study Groups</span>
        </div>
        <div className="space-y-1.5">
          {ar.studyGroups.map((g, i) => (
            <div key={i} className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${groupColors[g.type]}`}>{g.name}</span>
              </div>
              <div className="flex items-center gap-4 text-slate-400">
                <span>{g.doseLevel > 0 ? `${g.doseLevel} mg/kg/day` : "Vehicle only"}</span>
                {g.doseMultiple > 0 && <span className="text-slate-600">{g.doseMultiple}×</span>}
                <span className="text-slate-500">{g.nPerSex}/sex</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 pt-2 border-t border-white/8 flex justify-between text-[10px] text-slate-500">
          <span>Total: {ar.totalAnimals} animals ({Math.ceil(ar.totalAnimals / 2)}/sex)</span>
          <span>{ar.studyType.durationWeeks > 0 ? `${ar.studyType.durationWeeks}w duration` : "Single dose"}</span>
        </div>
      </div>

      {/* Toxicity Flags */}
      <div className="p-4 rounded-xl bg-white/3 border border-white/8">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest">Predicted Toxicity Signals</span>
        </div>
        <div className="space-y-2">
          {ar.toxicityFlags.map((f, i) => (
            <div key={i} className={`p-2.5 rounded-lg border ${riskBgs[f.risk]}`}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] font-semibold text-white">{f.organ}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] font-bold uppercase ${riskColors[f.risk]}`}>{f.risk}</span>
                  <span className="text-[9px] text-slate-600">{f.ich}</span>
                </div>
              </div>
              <div className="text-[10px] text-slate-400">{f.finding}</div>
              <div className="text-[9px] text-slate-600 mt-0.5">{f.basis}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ HUMAN TRANSLATION PANEL ═══ */}
      <div className="p-4 rounded-xl border border-blue-500/25 bg-blue-500/5">
        <div className="flex items-center gap-2 mb-4">
          <ArrowUpRight className="w-4 h-4 text-blue-400" />
          <span className="text-[13px] font-bold text-blue-300 uppercase tracking-widest">Human Translation Panel</span>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/25 text-blue-400 font-semibold">PROJECTED — not a clinical simulation</span>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          {[
            { label: "HED (BSA / Km method)", val: `${ar.hedBsa.toFixed(2)} mg/kg`, sub: `FDA 2005 guidance · Km=${ar.species.kmFactor}`, color: "blue" },
            { label: "HED (PBPK-refined)", val: `${ar.hedPbpk.toFixed(2)} mg/kg`, sub: "Clearance-corrected allometric", color: "violet" },
            { label: "Proposed FIH Dose", val: `${ar.fihDose.toFixed(1)} mg`, sub: `${ar.fihDoseMgKg.toFixed(3)} mg/kg · 1/10 HED (conservative)`, color: "emerald" },
            { label: "Safety Margin (NOAEL)", val: `${ar.safetyMarginNoael.toFixed(1)}×`, sub: `HED ÷ NOAEL · ${ar.safetyMarginNoael > 10 ? "Excellent" : ar.safetyMarginNoael > 5 ? "Acceptable" : "Narrow — review"}`, color: ar.safetyMarginNoael > 10 ? "emerald" : ar.safetyMarginNoael > 5 ? "amber" : "red" },
          ].map(m => (
            <div key={m.label} className={`p-3 rounded-lg bg-${m.color}-500/8 border border-${m.color}-500/20`}>
              <div className={`text-[9px] font-bold text-${m.color}-400 uppercase tracking-widest mb-1`}>{m.label}</div>
              <div className="text-[16px] font-bold text-white">{m.val}</div>
              <div className="text-[9px] text-slate-500 mt-0.5">{m.sub}</div>
            </div>
          ))}
        </div>

        <div className="p-3 rounded-lg bg-white/3 border border-white/8 mb-3">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Projected Human PK at FIH Dose</div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><div className="text-[14px] font-bold text-blue-300">{ar.humanCmax.toFixed(0)} ng/mL</div><div className="text-[9px] text-slate-600">Projected Cmax</div></div>
            <div><div className="text-[14px] font-bold text-blue-300">{ar.humanAuc.toFixed(0)} ng·h/mL</div><div className="text-[9px] text-slate-600">Projected AUC</div></div>
            <div><div className="text-[14px] font-bold text-blue-300">{ar.humanHalfLife.toFixed(1)}h</div><div className="text-[9px] text-slate-600">Projected t½</div></div>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/15 text-[10px] text-slate-400 leading-relaxed">
          <span className="font-semibold text-blue-300">Species Justification: </span>
          {ar.speciesJustification}
        </div>

        <div className="mt-3 p-2.5 rounded-lg bg-emerald-500/8 border border-emerald-500/20 flex items-center gap-2">
          <ArrowRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <p className="text-[10px] text-emerald-300">
            <span className="font-semibold">Layer 3 pre-populated:</span> FIH dose of {ar.fihDoseMgKg.toFixed(3)} mg/kg has been set as the starting dose for Patient Cohort simulation.
          </p>
        </div>
      </div>

      {/* Regulatory Checklist */}
      <div className="p-4 rounded-xl bg-white/3 border border-white/8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest">IND-Enabling Regulatory Checklist</span>
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ar.indEnablingComplete ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" : "bg-amber-500/15 text-amber-400 border border-amber-500/25"}`}>
            {ar.indEnablingComplete ? "IND-READY" : "GAPS DETECTED"}
          </span>
        </div>
        <div className="space-y-2">
          {ar.checklist.map((item, i) => (
            <div key={i} className="flex items-start gap-2.5 text-[11px]">
              <div className="mt-0.5 shrink-0">
                {item.status === "pass" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  : item.status === "warn" ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  : <div className="w-3.5 h-3.5 rounded-full border border-slate-600" />}
              </div>
              <div>
                <div className="font-semibold text-slate-300">{item.guideline} — {item.requirement}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{item.note}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GracefulDegradationBanner({ warnings }: { warnings: DatabaseQueryRecord[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mx-4 mt-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
        <span className="text-[11px] font-semibold text-yellow-300">Database Degradation Notice</span>
        <span className="text-[9px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">{warnings.length} source{warnings.length > 1 ? "s" : ""}</span>
      </div>
      <div className="space-y-1.5">
        {warnings.map((w, i) => (
          <div key={i} className="flex items-center gap-2 text-[10px]">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${w.status === "failed" ? "bg-red-400" : "bg-yellow-400"}`} />
            <span className="text-slate-300 font-medium">{w.database}</span>
            <span className={`${w.status === "failed" ? "text-red-400" : "text-yellow-400"}`}>
              {w.status === "failed" ? "unavailable" : "stale cache"}
            </span>
            {w.staleness && <span className="text-slate-500 italic">— {w.staleness}</span>}
          </div>
        ))}
      </div>
      <div className="text-[9px] text-slate-500 mt-2 leading-relaxed">
        Results may be based on cached or fallback reference data. Re-run when connectivity is restored for full fidelity.
      </div>
    </div>
  );
}

function ReviewAcknowledgmentButton({ flags, acknowledged, onAcknowledge }: { flags: SafetyFlag[]; acknowledged: boolean; onAcknowledge: () => void }) {
  const reviewRequired = flags.some(f => f.reviewRequired && !f.acknowledged);
  if (!reviewRequired && !acknowledged) return null;
  if (acknowledged) {
    return (
      <div className="mx-4 mt-2 bg-emerald-500/8 border border-emerald-500/25 rounded-lg px-4 py-2.5 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        <div>
          <span className="text-[11px] font-semibold text-emerald-300">Findings Reviewed</span>
          <span className="text-[10px] text-emerald-400/70 ml-2">All safety flags have been acknowledged by the reviewer</span>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-4 mt-2 bg-red-500/8 border border-red-500/25 rounded-lg px-4 py-2.5 flex items-center gap-2.5">
      <Shield className="w-4 h-4 text-red-400 shrink-0 animate-pulse" />
      <div className="flex-1">
        <span className="text-[11px] font-semibold text-red-300">Review Required</span>
        <span className="text-[10px] text-red-400/70 ml-2">{flags.filter(f => f.reviewRequired && !f.acknowledged).length} flag(s) require clinical review before proceeding</span>
      </div>
      <button
        onClick={onAcknowledge}
        className="text-[10px] bg-red-500/20 hover:bg-red-500/30 text-red-300 px-3 py-1.5 rounded-md font-medium transition-colors border border-red-500/30 hover:border-red-500/50 shrink-0"
      >
        I have reviewed these findings
      </button>
    </div>
  );
}

function CrossSourceConsistencyCheck({ simIC50_uM, bindingDB }: { simIC50_uM: number | null; bindingDB: BindingDBResult | null }) {
  if (!simIC50_uM || !bindingDB || bindingDB.medianIC50_nM === null) return null;
  const simIC50_nM = simIC50_uM * 1000;
  const dbIC50_nM = bindingDB.medianIC50_nM;
  const ratio = simIC50_nM > dbIC50_nM ? simIC50_nM / dbIC50_nM : dbIC50_nM / simIC50_nM;
  const isDiscrepant = ratio > 10;
  if (!isDiscrepant) {
    return (
      <div className="mx-4 mt-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-4 py-2.5 flex items-center gap-2">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span className="text-[10px] text-emerald-300">Cross-source IC50 consistent — Sim: {simIC50_nM.toFixed(1)} nM vs BindingDB: {dbIC50_nM.toFixed(1)} nM ({ratio.toFixed(1)}× ratio)</span>
      </div>
    );
  }
  return (
    <div className="mx-4 mt-2 bg-orange-500/8 border border-orange-500/25 rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />
        <span className="text-[11px] font-semibold text-orange-300">Cross-Source IC50 Discrepancy Detected</span>
        <span className="text-[9px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded font-semibold">&gt;10× DIVERGENCE</span>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-2">
        <div className="bg-white/3 rounded-lg p-2.5 border border-white/5">
          <div className="text-[9px] text-slate-500 mb-0.5">Simulation Engine</div>
          <div className="text-[13px] font-bold text-violet-300">{simIC50_nM.toFixed(1)} nM</div>
          <div className="text-[9px] text-slate-500">inVitroSim.ts (RDKit-derived)</div>
        </div>
        <div className="bg-white/3 rounded-lg p-2.5 border border-white/5">
          <div className="text-[9px] text-slate-500 mb-0.5">BindingDB (Experimental)</div>
          <div className="text-[13px] font-bold text-blue-300">{dbIC50_nM.toFixed(1)} nM</div>
          <div className="text-[9px] text-slate-500">Median of {bindingDB.ligandCount} ligands</div>
        </div>
      </div>
      <div className="text-[9px] text-orange-400/70 mt-2 leading-relaxed">
        {ratio.toFixed(1)}× discrepancy between simulated and experimental IC50. Consider: (1) verify SMILES structure accuracy, (2) check assay conditions in BindingDB source, (3) experimental IC50 may reflect different binding mode.
      </div>
    </div>
  );
}

function SafetyFlagCascadeBanner({ flags, layerLabel, upstream }: { flags: SafetyFlag[]; layerLabel: string; upstream?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (flags.length === 0) return null;
  return (
    <div className={`mx-4 mt-3 ${upstream ? "bg-red-500/5 border-red-500/20" : "bg-amber-500/5 border-amber-500/20"} border rounded-xl overflow-hidden`}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left"
      >
        <Shield className={`w-4 h-4 ${upstream ? "text-red-400" : "text-amber-400"} shrink-0`} />
        <div className="flex-1">
          <span className={`text-[11px] font-semibold ${upstream ? "text-red-300" : "text-amber-300"}`}>
            {upstream ? "Upstream Safety Flags" : "Safety Flags Detected"} ({flags.length})
          </span>
          <span className="text-[10px] text-slate-500 ml-2">
            {upstream ? "Cascaded from upstream layers — these flags persist through all downstream analysis" : `Detected in ${layerLabel}`}
          </span>
        </div>
        <div className="flex gap-1">
          {flags.map((f, i) => {
            const sc = SAFETY_FLAG_COLORS[f.severity];
            return <span key={i} className={`w-2 h-2 rounded-full ${sc.glow} shadow-[0_0_4px]`} />;
          })}
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2 border-t border-white/5">
          {flags.map((f, i) => {
            const sc = SAFETY_FLAG_COLORS[f.severity];
            return (
              <div key={i} className={`${sc.bg} border ${sc.border} rounded-lg p-3 mt-2`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${sc.glow} shadow-[0_0_6px]`} />
                  <span className={`text-[11px] font-bold ${sc.text}`}>{f.label}</span>
                  <span className="text-[9px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">L{f.originLayer}</span>
                  {f.ichReference && <span className="text-[9px] text-slate-500">{f.ichReference}</span>}
                  {f.reviewRequired && !f.acknowledged && (
                    <span className="text-[8px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-semibold ml-auto">REVIEW REQUIRED</span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 leading-relaxed">{f.detail}</div>
                {f.value && <div className="text-[10px] text-slate-500 mt-1">Measured: <span className={`font-semibold ${sc.text}`}>{f.value}</span></div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OverrideBanner({ overrides }: { overrides: SafetyOverride[] }) {
  if (overrides.length === 0) return null;
  return (
    <div className="mx-4 mt-2 bg-amber-500/8 border border-amber-500/25 rounded-lg px-4 py-2.5 flex items-start gap-2">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
      <div>
        <div className="text-[11px] font-semibold text-amber-300">Override Logged</div>
        <div className="text-[10px] text-amber-400/80 leading-relaxed">
          {overrides.map((o, i) => (
            <span key={i}>
              Layer {o.fromLayer} {o.verdict} verdict overridden → advanced to Layer {o.toLayer} ({new Date(o.timestamp).toLocaleTimeString()})
              {i < overrides.length - 1 ? " · " : ""}
            </span>
          ))}
        </div>
        <div className="text-[9px] text-slate-500 mt-1">Per HAIOps framework: all downstream outputs carry this annotation for audit traceability</div>
      </div>
    </div>
  );
}

function ProvenanceFooter({ provenance, layer }: { provenance: ProvenanceRecord; layer: number }) {
  const [open, setOpen] = useState(false);
  const layerColors: Record<number, string> = { 1: "violet", 2: "amber", 3: "blue", 4: "emerald" };
  const color = layerColors[layer] ?? "slate";
  const borderCls = color === "violet" ? "border-violet-500/15" : color === "amber" ? "border-amber-500/15" : color === "blue" ? "border-blue-500/15" : "border-emerald-500/15";
  const textCls = color === "violet" ? "text-violet-400" : color === "amber" ? "text-amber-400" : color === "blue" ? "text-blue-400" : "text-emerald-400";
  return (
    <div className={`mx-4 mt-3 mb-2 border ${borderCls} rounded-lg overflow-hidden bg-white/2`}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <FileText className={`w-3 h-3 ${textCls}`} />
        <span className={`text-[10px] font-semibold ${textCls}`}>Provenance Metadata</span>
        <span className="text-[9px] text-slate-600 ml-1">HAIOps Audit Trail</span>
        <ChevronDown className={`w-3 h-3 text-slate-600 ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-3 pb-2.5 border-t border-white/5 space-y-1.5 mt-0">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px] mt-2">
            <div><span className="text-slate-600">Engine:</span> <span className="text-slate-400 font-mono">{provenance.engineFile}</span></div>
            <div><span className="text-slate-600">Version:</span> <span className="text-slate-400 font-mono">{provenance.engineVersion}</span></div>
            <div><span className="text-slate-600">Timestamp:</span> <span className="text-slate-400 font-mono">{new Date(provenance.timestamp).toLocaleString()}</span></div>
            <div><span className="text-slate-600">RDKit:</span> <span className="text-slate-400 font-mono">{provenance.rdkitVersion}</span></div>
            <div><span className="text-slate-600">Input:</span> <span className="text-slate-400 font-mono">{provenance.inputSource}</span></div>
            {provenance.randomSeed !== undefined && <div><span className="text-slate-600">Seed:</span> <span className="text-slate-400 font-mono">{provenance.randomSeed}</span></div>}
          </div>
          {provenance.databaseQueries.length > 0 && (
            <div className="mt-1.5">
              <div className="text-[9px] text-slate-600 mb-1">Database Queries:</div>
              <div className="flex flex-wrap gap-1">
                {provenance.databaseQueries.map((q, i) => (
                  <span key={i} className={`text-[8px] px-1.5 py-0.5 rounded border ${
                    q.status === "success" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    : q.status === "failed" ? "bg-red-500/10 border-red-500/20 text-red-400"
                    : q.status === "cached" ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                    : "bg-slate-500/10 border-slate-500/20 text-slate-500"
                  } font-mono`}>
                    {q.database}: {q.status}{q.version ? ` v${q.version}` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Layer1Results({
  smiles,
  molProps, simResults, inVitroResults, indication,
  l1AiReport, l1AiLoading, l1AiError, l1AiStream, runL1AiAnalysis,
  uniprotId, pdbId, alphafoldPlddt, proteinName,
  bindingOn, toxOn, confidenceThreshold,
  safetyFlags, flagsAcknowledged, onAcknowledgeFlags,
  topTarget, therapeuticArea,
}: {
  smiles: string;
  molProps: MolecularProperties | null;
  simResults: SimResults | null;
  inVitroResults: InVitroResults | null;
  indication: string;
  l1AiReport: Record<string, unknown> | null;
  l1AiLoading: boolean;
  l1AiError: string | null;
  l1AiStream: string;
  runL1AiAnalysis: () => void;
  uniprotId?: string;
  pdbId?: string;
  alphafoldPlddt?: number | null;
  proteinName?: string;
  bindingOn: boolean;
  toxOn: boolean;
  confidenceThreshold: number[];
  safetyFlags?: SafetyFlag[];
  flagsAcknowledged?: boolean;
  onAcknowledgeFlags?: () => void;
  topTarget?: TargetSuggestion | null;
  therapeuticArea?: string;
}) {
  const [activeTab, setActiveTab] = useState("ml-admet");
  const [admetOpen, setAdmetOpen] = useState(false);

  const iv = inVitroResults;
  const goColor = !iv ? "emerald" : iv.overallRisk === "Low" ? "emerald" : iv.overallRisk === "Moderate" ? "yellow" : "red";
  const goBg    = goColor === "emerald" ? "from-emerald-950/60 to-emerald-900/30 border-emerald-500/25"
                : goColor === "yellow"  ? "from-yellow-950/60 to-yellow-900/30 border-yellow-500/25"
                :                        "from-red-950/60 to-red-900/30 border-red-500/25";
  const goText  = goColor === "emerald" ? "text-emerald-400" : goColor === "yellow" ? "text-yellow-400" : "text-red-400";
  const glowCls = goColor === "emerald" ? "bg-emerald-400 shadow-emerald-400" : goColor === "yellow" ? "bg-yellow-400 shadow-yellow-400" : "bg-red-400 shadow-red-400";
  const goLabel = !iv ? "PENDING" : iv.overallRisk === "Low" ? "GO" : iv.overallRisk === "Moderate" ? "WATCH" : "NO-GO";

  return (
    <div className="space-y-4">
      {/* Go/No-Go Summary Card */}
      <div className={`bg-gradient-to-r ${goBg} border rounded-xl p-5`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-2.5 h-2.5 rounded-full shadow-[0_0_8px] ${glowCls}`} />
              <span className={`text-[20px] font-bold ${goText}`}>{goLabel}</span>
              {iv && (iv.herg.ic50_uM < 10 || iv.bioactivation.mechanisticToxicities.some(t => t.confidence > 0.7)) && (
                <span className="text-[9px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-semibold border border-red-500/30 animate-pulse">
                  REVIEW REQUIRED
                </span>
              )}
            </div>
            <p className="text-[13px] text-white font-medium">
              {iv ? `In Vitro Score: ${(iv.inVitroScore * 100).toFixed(1)}% — ${iv.overallRisk === "Low" ? "Advance to Animal Studies" : iv.overallRisk === "Moderate" ? "Review Safety Signals" : "Significant Risks Detected"}` : "Run simulation to generate in vitro results"}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Confidence Score: <span className={`font-semibold ${goText}`}>{simResults ? (simResults.confidence * 100).toFixed(1) : "—"}%</span>
              <span className="text-slate-600 ml-2">HAIOps Governed</span>
            </p>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-slate-500 mb-2">Key metrics</div>
            <div className="flex gap-1.5 flex-wrap justify-end">
              {iv && [
                { l: "IC50", v: `${iv.doseResponse.ic50_nM.toFixed(1)} nM` },
                { l: "Perm", v: iv.permeability.caco2Class },
                { l: "hERG", v: iv.herg.riskCategory },
              ].map(m => (
                <Badge key={m.l} className="text-[9px] bg-white/5 text-slate-400">{m.l}: {m.v}</Badge>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-white/8 flex gap-4 flex-wrap">
          {[
            { label: "IC50",         val: iv ? `${iv.doseResponse.ic50_nM.toFixed(1)} nM` : "—", good: (iv?.doseResponse.ic50_nM ?? 999) < 100 },
            { label: "Caco-2",       val: iv ? `${iv.permeability.caco2Papp.toFixed(1)} ×10⁻⁶` : "—", good: iv?.permeability.caco2Class !== "Low" },
            { label: "CLint",        val: iv ? `${iv.metabolicStability.microsomalCLint.toFixed(1)} µL/min/mg` : "—", good: iv?.metabolicStability.microsomalClass !== "Unstable" },
            { label: "fu%",          val: iv ? `${iv.plasmaProteinBinding.fuPercent.toFixed(1)}%` : "—", good: (iv?.plasmaProteinBinding.fuPercent ?? 0) > 5 },
            { label: "hERG IC50",    val: iv ? `${iv.herg.ic50_uM.toFixed(1)} µM` : "—", good: iv?.herg.riskCategory === "Low" },
            { label: "TI",           val: iv ? `${iv.cellViability.therapeuticIndex.toFixed(0)}×` : "—", good: (iv?.cellViability.therapeuticIndex ?? 0) > 30 },
          ].map(({ label, val, good }) => (
            <div key={label}>
              <div className="text-[9px] text-slate-600 uppercase tracking-wider">{label}</div>
              <div className={`text-[12px] font-semibold mt-0.5 ${good ? "text-emerald-400" : "text-red-400"}`}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Confidence threshold warning */}
      {simResults && simResults.confidence < confidenceThreshold[0] && (
        <div className="bg-amber-500/8 border border-amber-500/25 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-[10px] text-amber-300 leading-relaxed">
            <span className="font-semibold">Below confidence threshold</span> — simulation confidence {(simResults.confidence * 100).toFixed(1)}% is under your {(confidenceThreshold[0] * 100).toFixed(0)}% threshold.
          </div>
        </div>
      )}

      {/* In Vitro Tabs */}
      <div className="flex gap-1 bg-white/5 p-1 rounded-lg flex-wrap">
        {[
          { id: "ml-admet",      label: "ML-Enhanced",   icon: Brain },
          { id: "dose-response", label: "Dose-Response", icon: TrendingUp },
          { id: "permeability",  label: "Permeability",  icon: Layers },
          { id: "clearance",     label: "Clearance",     icon: Activity },
          { id: "safety",        label: "Safety",        icon: Shield },
          { id: "mechanism",     label: "Mechanism",     icon: GitBranch },
          { id: "bioactivation", label: "Bioactivation", icon: Zap },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
              activeTab === id ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {/* ML-Enhanced ADMET Tab */}
      {activeTab === "ml-admet" && (
        <MlAdmetCard smiles={smiles} heuristicAdmet={simResults?.admet ?? null} />
      )}

      {/* Dose-Response Tab */}
      {activeTab === "dose-response" && iv && (
        <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[12px] font-semibold text-slate-300">Dose-Response Curve</h3>
            <Badge className={`text-[9px] ${iv.doseResponse.potencyClass === "High" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : iv.doseResponse.potencyClass === "Moderate" ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" : "bg-red-500/15 text-red-400 border-red-500/30"}`}>
              {iv.doseResponse.potencyClass} Potency
            </Badge>
          </div>
          <svg viewBox="0 0 400 200" className="w-full h-auto">
            <defs>
              <linearGradient id="drGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[0, 25, 50, 75, 100].map(v => (
              <g key={v}>
                <line x1="50" y1={180 - v * 1.6} x2="390" y2={180 - v * 1.6} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                <text x="45" y={183 - v * 1.6} fill="#64748b" fontSize="8" textAnchor="end">{v}%</text>
              </g>
            ))}
            {(() => {
              const pts = iv.doseResponse.curve;
              const minLog = -2, maxLog = 5;
              const toX = (c: number) => 50 + ((Math.log10(Math.max(0.01, c)) - minLog) / (maxLog - minLog)) * 340;
              const toY = (r: number) => 180 - (r / 100) * 160;
              const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.concentration).toFixed(1)},${toY(p.response).toFixed(1)}`).join(" ");
              const areaPath = linePath + ` L${toX(pts[pts.length - 1].concentration).toFixed(1)},180 L${toX(pts[0].concentration).toFixed(1)},180 Z`;
              return (
                <>
                  <path d={areaPath} fill="url(#drGrad)" />
                  <path d={linePath} fill="none" stroke="#8b5cf6" strokeWidth="2" />
                  {pts.map((p, i) => (
                    <circle key={i} cx={toX(p.concentration)} cy={toY(p.response)} r="2" fill="#8b5cf6" />
                  ))}
                  <line x1={toX(iv.doseResponse.ic50_nM)} y1={20} x2={toX(iv.doseResponse.ic50_nM)} y2={180} stroke="#f59e0b" strokeWidth="1" strokeDasharray="3,3" />
                  <text x={toX(iv.doseResponse.ic50_nM)} y={16} fill="#f59e0b" fontSize="8" textAnchor="middle">IC50 = {iv.doseResponse.ic50_nM.toFixed(1)} nM</text>
                </>
              );
            })()}
            <text x="220" y="198" fill="#64748b" fontSize="8" textAnchor="middle">Concentration (nM, log scale)</text>
          </svg>
          <div className="grid grid-cols-4 gap-3">
            {[
              { l: "IC50", v: `${iv.doseResponse.ic50_nM.toFixed(1)} nM` },
              { l: "EC50", v: `${iv.doseResponse.ec50_nM.toFixed(1)} nM` },
              { l: "Hill Coefficient", v: iv.doseResponse.hillCoefficient.toFixed(2) },
              { l: "Max Inhibition", v: `${iv.doseResponse.maxInhibition.toFixed(1)}%` },
            ].map(m => (
              <div key={m.l} className="bg-white/5 rounded-lg p-2.5 text-center">
                <div className="text-[9px] text-slate-500 uppercase">{m.l}</div>
                <div className="text-[13px] font-bold text-violet-300 mt-0.5">{m.v}</div>
              </div>
            ))}
          </div>
          <div className="bg-white/5 rounded-lg p-3">
            <div className="text-[10px] font-semibold text-slate-400 mb-2">Cell Viability ({iv.cellViability.cellLine})</div>
            <div className="grid grid-cols-3 gap-3">
              <div><div className="text-[9px] text-slate-500">CC50</div><div className="text-[12px] font-semibold text-white">{iv.cellViability.cc50_uM.toFixed(1)} µM</div></div>
              <div><div className="text-[9px] text-slate-500">Therapeutic Index</div><div className={`text-[12px] font-semibold ${iv.cellViability.therapeuticIndex > 30 ? "text-emerald-400" : "text-red-400"}`}>{iv.cellViability.therapeuticIndex.toFixed(0)}×</div></div>
              <div><div className="text-[9px] text-slate-500">Viability @10µM</div><div className={`text-[12px] font-semibold ${iv.cellViability.viabilityAt10uM > 80 ? "text-emerald-400" : "text-red-400"}`}>{iv.cellViability.viabilityAt10uM.toFixed(0)}%</div></div>
            </div>
          </div>
        </div>
      )}

      {/* Permeability Tab */}
      {activeTab === "permeability" && iv && (
        <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5 space-y-4">
          <h3 className="text-[12px] font-semibold text-slate-300">Permeability & Absorption</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white/5 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-300">Caco-2 Papp</span>
                <Badge className={`text-[9px] ${iv.permeability.caco2Class === "High" ? "bg-emerald-500/15 text-emerald-400" : iv.permeability.caco2Class === "Moderate" ? "bg-yellow-500/15 text-yellow-400" : "bg-red-500/15 text-red-400"}`}>
                  {iv.permeability.caco2Class}
                </Badge>
              </div>
              <div className="text-[24px] font-bold text-white">{iv.permeability.caco2Papp.toFixed(1)}</div>
              <div className="text-[9px] text-slate-500">×10⁻⁶ cm/s</div>
              <div className="w-full bg-white/5 rounded-full h-2">
                <div className={`h-2 rounded-full ${iv.permeability.caco2Class === "High" ? "bg-emerald-500" : iv.permeability.caco2Class === "Moderate" ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${Math.min(100, (iv.permeability.caco2Papp / 60) * 100)}%` }} />
              </div>
            </div>
            <div className="bg-white/5 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-300">PAMPA Pe</span>
                <Badge className={`text-[9px] ${iv.permeability.pampaClass === "High" ? "bg-emerald-500/15 text-emerald-400" : iv.permeability.pampaClass === "Moderate" ? "bg-yellow-500/15 text-yellow-400" : "bg-red-500/15 text-red-400"}`}>
                  {iv.permeability.pampaClass}
                </Badge>
              </div>
              <div className="text-[24px] font-bold text-white">{iv.permeability.pampaPe.toFixed(1)}</div>
              <div className="text-[9px] text-slate-500">×10⁻⁶ cm/s</div>
              <div className="w-full bg-white/5 rounded-full h-2">
                <div className={`h-2 rounded-full ${iv.permeability.pampaClass === "High" ? "bg-emerald-500" : iv.permeability.pampaClass === "Moderate" ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${Math.min(100, (iv.permeability.pampaPe / 50) * 100)}%` }} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-[10px] text-slate-500 mb-1">Efflux Ratio</div>
              <div className={`text-[16px] font-bold ${iv.permeability.effluxRatio < 2.5 ? "text-emerald-400" : "text-red-400"}`}>{iv.permeability.effluxRatio.toFixed(1)}</div>
              <div className="text-[9px] text-slate-500 mt-0.5">{iv.permeability.effluxRatio < 2.5 ? "Not P-gp limited" : "P-gp efflux likely"}</div>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-[10px] text-slate-500 mb-1">P-gp Substrate</div>
              <div className={`text-[16px] font-bold ${iv.permeability.pgpSubstrate ? "text-amber-400" : "text-emerald-400"}`}>{iv.permeability.pgpSubstrate ? "Yes" : "No"}</div>
              <div className="text-[9px] text-slate-500 mt-0.5">{iv.permeability.pgpSubstrate ? "May limit oral absorption" : "No efflux concern"}</div>
            </div>
          </div>
          <div className="bg-white/5 rounded-lg p-3">
            <div className="text-[10px] font-semibold text-slate-400 mb-2">Plasma Protein Binding</div>
            <div className="flex items-center gap-4">
              <div>
                <div className="text-[20px] font-bold text-white">{iv.plasmaProteinBinding.boundPercent.toFixed(1)}%</div>
                <div className="text-[9px] text-slate-500">Bound</div>
              </div>
              <div className="flex-1 h-4 bg-white/5 rounded-full overflow-hidden flex">
                <div className="bg-violet-500/60 h-full" style={{ width: `${iv.plasmaProteinBinding.boundPercent}%` }} />
                <div className="bg-emerald-500/40 h-full" style={{ width: `${iv.plasmaProteinBinding.fuPercent}%` }} />
              </div>
              <div>
                <div className="text-[20px] font-bold text-emerald-400">{iv.plasmaProteinBinding.fuPercent.toFixed(1)}%</div>
                <div className="text-[9px] text-slate-500">Free (fu)</div>
              </div>
            </div>
            <div className="text-[9px] text-slate-500 mt-1 text-center">{iv.plasmaProteinBinding.bindingClass}</div>
          </div>
        </div>
      )}

      {/* Clearance Tab */}
      {activeTab === "clearance" && iv && (
        <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5 space-y-4">
          <h3 className="text-[12px] font-semibold text-slate-300">Metabolic Stability & CYP Panel</h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              { l: "Microsomal CLint", v: `${iv.metabolicStability.microsomalCLint.toFixed(1)}`, u: "µL/min/mg", cls: iv.metabolicStability.microsomalClass },
              { l: "Hepatocyte CLint", v: `${iv.metabolicStability.hepatocyteCLint.toFixed(1)}`, u: "µL/min/10⁶", cls: iv.metabolicStability.hepatocyteClass },
              { l: "t½ (microsomal)", v: `${iv.metabolicStability.halfLifeMin.toFixed(0)}`, u: "min", cls: iv.metabolicStability.microsomalClass },
            ].map(m => (
              <div key={m.l} className="bg-white/5 rounded-lg p-3 text-center">
                <div className="text-[9px] text-slate-500 mb-1">{m.l}</div>
                <div className={`text-[18px] font-bold ${m.cls === "Stable" ? "text-emerald-400" : m.cls === "Moderate" ? "text-yellow-400" : "text-red-400"}`}>{m.v}</div>
                <div className="text-[8px] text-slate-600">{m.u}</div>
                <Badge className={`mt-1 text-[8px] ${m.cls === "Stable" ? "bg-emerald-500/15 text-emerald-400" : m.cls === "Moderate" ? "bg-yellow-500/15 text-yellow-400" : "bg-red-500/15 text-red-400"}`}>{m.cls}</Badge>
              </div>
            ))}
          </div>
          <div className="bg-white/5 rounded-lg p-4">
            <div className="text-[10px] font-semibold text-slate-400 mb-3">CYP Inhibition Panel</div>
            <div className="space-y-2">
              {Object.entries(iv.metabolicStability.cypInhibition).map(([enzyme, data]) => (
                <div key={enzyme} className="flex items-center gap-3">
                  <span className="text-[10px] text-slate-400 w-16 font-mono">{enzyme}</span>
                  <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${data.risk === "Low" ? "bg-emerald-500/60" : data.risk === "Moderate" ? "bg-yellow-500/60" : "bg-red-500/60"}`}
                      style={{ width: `${Math.min(100, (1 - data.ic50_uM / 50) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-300 w-16 text-right">{data.ic50_uM} µM</span>
                  <Badge className={`text-[8px] w-16 justify-center ${data.risk === "Low" ? "bg-emerald-500/15 text-emerald-400" : data.risk === "Moderate" ? "bg-yellow-500/15 text-yellow-400" : "bg-red-500/15 text-red-400"}`}>{data.risk}</Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Safety Tab */}
      {activeTab === "safety" && iv && (
        <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5 space-y-4">
          <h3 className="text-[12px] font-semibold text-slate-300">Safety Assessment</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white/5 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-slate-300">hERG Channel</span>
                <Badge className={`text-[9px] ${iv.herg.riskCategory === "Low" ? "bg-emerald-500/15 text-emerald-400" : iv.herg.riskCategory === "Moderate" ? "bg-yellow-500/15 text-yellow-400" : "bg-red-500/15 text-red-400"}`}>
                  {iv.herg.riskCategory} Risk
                </Badge>
              </div>
              <div className="text-[24px] font-bold text-white mb-1">{iv.herg.ic50_uM.toFixed(2)} <span className="text-[12px] text-slate-400">µM</span></div>
              <div className="text-[9px] text-slate-500 mb-2">{iv.herg.patchClampResult}</div>
              <div className="flex justify-between text-[9px]">
                <span className="text-slate-500">Safety Margin</span>
                <span className={`font-semibold ${iv.herg.safetyMargin > 30 ? "text-emerald-400" : "text-red-400"}`}>{iv.herg.safetyMargin.toFixed(0)}×</span>
              </div>
            </div>
            <div className="bg-white/5 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-slate-300">Selectivity</span>
                <Badge className={`text-[9px] ${iv.selectivity.selectivityClass === "Selective" ? "bg-emerald-500/15 text-emerald-400" : iv.selectivity.selectivityClass === "Moderately Selective" ? "bg-yellow-500/15 text-yellow-400" : "bg-red-500/15 text-red-400"}`}>
                  {iv.selectivity.selectivityClass}
                </Badge>
              </div>
              <div className="text-[24px] font-bold text-white mb-1">{(iv.selectivity.kinaseSelectivityScore * 100).toFixed(0)}<span className="text-[12px] text-slate-400">%</span></div>
              <div className="text-[9px] text-slate-500 mb-2">{iv.selectivity.offTargetHits} off-target hits / {iv.selectivity.totalTargetsTested} tested</div>
            </div>
          </div>
          {iv.selectivity.topOffTargets.length > 0 && (
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-[10px] font-semibold text-slate-400 mb-2">Top Off-Target Hits</div>
              <div className="space-y-1.5">
                {iv.selectivity.topOffTargets.map((t, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className="text-slate-300 font-medium">{t.name}</span>
                    <div className="flex gap-3">
                      <span className="text-slate-400">IC50: {t.ic50_nM.toFixed(0)} nM</span>
                      <span className="text-slate-500">Ratio: {t.selectivityRatio.toFixed(0)}×</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mechanism Tab */}
      {activeTab === "mechanism" && iv && (
        <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[12px] font-semibold text-slate-300">Mechanistic Toxicity Analysis</h3>
            <Badge className={`text-[9px] ${iv.bioactivation.overallBioactivationRisk === "Low" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : iv.bioactivation.overallBioactivationRisk === "Moderate" ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" : "bg-red-500/15 text-red-400 border-red-500/30"}`}>
              {iv.bioactivation.totalAlertsDetected} Alert{iv.bioactivation.totalAlertsDetected !== 1 ? "s" : ""} Detected
            </Badge>
          </div>

          {iv.bioactivation.mechanisticToxicities.length === 0 && (
            <div className="bg-emerald-500/8 border border-emerald-500/20 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-[11px] font-semibold text-emerald-300">No Structural Alerts Detected</div>
                <div className="text-[10px] text-slate-400 mt-1">No known bioactivation-prone structural motifs were identified. Standard safety pharmacology package recommended.</div>
              </div>
            </div>
          )}

          {iv.bioactivation.mechanisticToxicities.map((tox, idx) => (
            <div key={idx} className="bg-white/3 border border-white/8 rounded-lg overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${tox.risk === "High" ? "bg-red-400 shadow-[0_0_6px] shadow-red-400" : tox.risk === "Moderate" ? "bg-yellow-400 shadow-[0_0_6px] shadow-yellow-400" : "bg-emerald-400"}`} />
                  <span className="text-[11px] font-semibold text-white">{tox.organ}</span>
                  <Badge className="text-[8px] bg-white/5 text-slate-500">{tox.aopId}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-500">Confidence</span>
                  <span className={`text-[10px] font-bold ${tox.confidence > 0.7 ? "text-red-400" : tox.confidence > 0.5 ? "text-yellow-400" : "text-emerald-400"}`}>{(tox.confidence * 100).toFixed(0)}%</span>
                </div>
              </div>
              <div className="px-4 py-3 space-y-3">
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Structural Alert</div>
                  <div className="text-[10px] text-violet-300 font-medium">{tox.structuralAlert}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1.5">Adverse Outcome Pathway</div>
                  <div className="space-y-1">
                    {tox.aopChain.map((step, si) => (
                      <div key={si} className="flex items-start gap-2">
                        <div className="flex flex-col items-center shrink-0 mt-0.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${si === tox.aopChain.length - 1 ? "bg-red-400" : "bg-violet-400/60"}`} />
                          {si < tox.aopChain.length - 1 && <div className="w-px h-3 bg-violet-400/20" />}
                        </div>
                        <span className={`text-[10px] leading-tight ${si === tox.aopChain.length - 1 ? "text-red-300 font-medium" : "text-slate-400"}`}>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">Mechanistic Explanation</div>
                  <div className="text-[10px] text-slate-300 leading-relaxed">{tox.mechanism}</div>
                </div>
                <div className="bg-blue-500/8 border border-blue-500/15 rounded-lg p-3">
                  <div className="text-[9px] uppercase tracking-wider text-blue-400 mb-1">Mitigation Strategy</div>
                  <div className="text-[10px] text-blue-200 leading-relaxed">{tox.mitigationStrategy}</div>
                </div>
              </div>
            </div>
          ))}

          {iv.bioactivation.recommendedStudies.length > 0 && (
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-[10px] font-semibold text-slate-400 mb-2">Recommended Follow-Up Studies</div>
              <div className="space-y-1.5">
                {iv.bioactivation.recommendedStudies.map((s, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="w-1 h-1 rounded-full bg-amber-400 shrink-0 mt-1.5" />
                    <span className="text-[10px] text-slate-300">{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bioactivation Tab */}
      {activeTab === "bioactivation" && iv && (
        <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[12px] font-semibold text-slate-300">Metabolic Bioactivation Pathways</h3>
            <div className="flex items-center gap-2">
              {iv.bioactivation.gshTrappingRecommended && (
                <Badge className="text-[8px] bg-amber-500/15 text-amber-400 border-amber-500/30">GSH Trapping Recommended</Badge>
              )}
              <Badge className={`text-[9px] ${iv.bioactivation.overallBioactivationRisk === "Low" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : iv.bioactivation.overallBioactivationRisk === "Moderate" ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" : "bg-red-500/15 text-red-400 border-red-500/30"}`}>
                {iv.bioactivation.overallBioactivationRisk} Risk
              </Badge>
            </div>
          </div>

          {iv.bioactivation.bioactivationPathways.length === 0 && (
            <div className="bg-emerald-500/8 border border-emerald-500/20 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-[11px] font-semibold text-emerald-300">No Bioactivation Pathways Identified</div>
                <div className="text-[10px] text-slate-400 mt-1">No structural motifs susceptible to metabolic bioactivation were detected. Standard in vitro metabolism studies are sufficient.</div>
              </div>
            </div>
          )}

          {iv.bioactivation.bioactivationPathways.map((pw, idx) => (
            <div key={idx} className="bg-white/3 border border-white/8 rounded-lg overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Zap className={`w-3.5 h-3.5 ${pw.riskLevel === "High" ? "text-red-400" : pw.riskLevel === "Moderate" ? "text-yellow-400" : "text-emerald-400"}`} />
                  <span className="text-[11px] font-semibold text-white">{pw.alertName}</span>
                </div>
                <Badge className={`text-[8px] ${pw.riskLevel === "High" ? "bg-red-500/15 text-red-400" : pw.riskLevel === "Moderate" ? "bg-yellow-500/15 text-yellow-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                  {pw.riskLevel}
                </Badge>
              </div>
              <div className="px-4 py-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-0.5">Structural Motif</div>
                    <div className="text-[10px] text-violet-300 font-medium">{pw.structuralMotif}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-0.5">CYP Enzyme(s)</div>
                    <div className="text-[10px] text-blue-300 font-medium">{pw.cypEnzyme}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-0.5">Reactive Intermediate</div>
                    <div className="text-[10px] text-amber-300 font-medium">{pw.reactiveIntermediate}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-0.5">Target Macromolecule</div>
                    <div className="text-[10px] text-red-300 font-medium">{pw.targetMacromolecule}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-0.5">Detoxification Pathway</div>
                    <div className="text-[10px] text-emerald-300">{pw.detoxPathway}</div>
                  </div>
                </div>
                <div className="mt-3 bg-white/3 rounded-lg p-2.5">
                  <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-0.5">Clinical Relevance</div>
                  <div className="text-[10px] text-slate-300 leading-relaxed">{pw.clinicalRelevance}</div>
                </div>
              </div>
            </div>
          ))}

          {iv.bioactivation.metabolicSoftSpots.length > 0 && (
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-[10px] font-semibold text-slate-400 mb-3">Metabolic Soft Spots</div>
              <div className="space-y-2">
                {iv.bioactivation.metabolicSoftSpots.map((ss, i) => (
                  <div key={i} className="flex items-center gap-3 bg-white/3 rounded-lg p-2.5">
                    <div className="text-[10px] text-slate-500 font-mono w-12 shrink-0">{ss.position}</div>
                    <div className="flex-1">
                      <div className="text-[10px] text-white font-medium">{ss.moiety}</div>
                      <div className="text-[9px] text-slate-500 mt-0.5">{ss.primaryCyp} → {ss.metaboliteType}</div>
                    </div>
                    <Badge className={`text-[8px] ${ss.reactivityRisk === "Reactive" ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                      {ss.reactivityRisk}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {iv.bioactivation.bioactivationPathways.length > 0 && (
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-[10px] font-semibold text-slate-400 mb-2">Bioactivation → Toxicity Flow</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {["Parent Compound", "CYP Oxidation", "Reactive Intermediate", "Macromolecule Adduct", "Cellular Stress", "Organ Toxicity"].map((step, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <div className={`text-[9px] px-2 py-1 rounded ${i === 0 ? "bg-violet-500/15 text-violet-300" : i === 2 ? "bg-red-500/15 text-red-300" : i === 5 ? "bg-red-500/20 text-red-300 font-semibold" : "bg-white/5 text-slate-400"}`}>{step}</div>
                    {i < 5 && <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "dose-response" && !iv && (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-600">
          <TestTube2 className="w-8 h-8" />
          <p className="text-[11px]">Run the simulation to generate in vitro assay data</p>
        </div>
      )}
      {(activeTab === "permeability" || activeTab === "clearance" || activeTab === "safety" || activeTab === "mechanism" || activeTab === "bioactivation") && !iv && (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-600">
          <Activity className="w-8 h-8" />
          <p className="text-[11px]">Run the simulation first</p>
        </div>
      )}

      {/* Directional ADMET — collapsible */}
      <div className="bg-[#0d0f17] border border-white/8 rounded-xl overflow-hidden">
        <button
          onClick={() => setAdmetOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-[12px] font-semibold text-slate-300">Directional ADMET Indicators</span>
            <Badge className="text-[8px] bg-violet-500/10 text-violet-400 border-violet-500/20">Computational</Badge>
          </div>
          {admetOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </button>
        {admetOpen && (
          <div className="px-5 pb-4">
            <ADMETRadarChart admet={simResults?.admet ?? null} molProps={molProps} />
          </div>
        )}
      </div>

      {/* Export Options */}
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" className="border-white/10 text-slate-400 hover:text-white text-[11px] gap-1.5">
          <Download className="w-3.5 h-3.5" /> Export PNG
        </Button>
        <Button variant="outline" size="sm" className="border-white/10 text-slate-400 hover:text-white text-[11px] gap-1.5">
          <FileText className="w-3.5 h-3.5" /> PDF Report
        </Button>
        <Button variant="outline" size="sm" className="border-white/10 text-slate-400 hover:text-white text-[11px] gap-1.5">
          <Download className="w-3.5 h-3.5" /> Export JSON
        </Button>
      </div>

      <RegulatoryInsightCard layer={1} indication={indication} simResults={simResults} />
      <SimulationDataSources
        layer={1}
        simResults={simResults}
        uniprotId={uniprotId}
        pdbId={pdbId}
        alphafoldPlddt={alphafoldPlddt}
        proteinName={proteinName}
      />
      <LayerAiPanel
        layer={1}
        report={l1AiReport}
        loading={l1AiLoading}
        error={l1AiError}
        stream={l1AiStream}
        onRun={runL1AiAnalysis}
        simResults={simResults}
        inVitroResults={inVitroResults}
        safetyFlags={safetyFlags}
        flagsAcknowledged={flagsAcknowledged}
        onAcknowledgeFlags={onAcknowledgeFlags}
        targetName={topTarget ? `${topTarget.geneName} (${topTarget.uniprotId})` : proteinName}
        targetConfidence={topTarget?.confidence ?? simResults?.confidence}
        targetArea={therapeuticArea}
      />
    </div>
  );
}

function ADMETRadarChart({ admet, molProps }: { admet: AdmetScores | null; molProps: MolecularProperties | null }) {
  if (!admet) {
    return (
      <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
        <h3 className="text-[12px] font-semibold text-slate-300 mb-4">ADMET Radar Chart</h3>
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-600">
          <Activity className="w-8 h-8" />
          <p className="text-[11px]">Run the simulation to populate the ADMET radar</p>
        </div>
      </div>
    );
  }
  const axes = [
    { label: "Absorption",   val: admet.absorption,   angle: -90 },
    { label: "Distribution", val: admet.distribution, angle: -18 },
    { label: "Metabolism",   val: admet.metabolism,   angle:  54 },
    { label: "Excretion",    val: admet.excretion,    angle: 126 },
    { label: "Toxicity",     val: admet.toxicity,     angle: 198 },
  ];

  const cx = 150, cy = 140, r = 100;
  const toPoint = (angle: number, dist: number) => {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + dist * Math.cos(rad), y: cy + dist * Math.sin(rad) };
  };

  const outerPoints = axes.map(a => toPoint(a.angle, r));
  const innerPoints = axes.map(a => toPoint(a.angle, r * a.val));

  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + "Z";

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">ADMET Radar Chart</h3>
      <div className="flex gap-6 items-center">
        <svg width="300" height="280" className="shrink-0">
          {/* Grid rings */}
          {[0.25, 0.5, 0.75, 1.0].map(f => (
            <polygon
              key={f}
              points={outerPoints.map(p => {
                const dx = p.x - cx, dy = p.y - cy;
                return `${cx + dx * f},${cy + dy * f}`;
              }).join(" ")}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
            />
          ))}

          {/* Axis lines */}
          {outerPoints.map((p, i) => (
            <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          ))}

          {/* Data polygon */}
          <path d={toPath(innerPoints)} fill="rgba(139,92,246,0.15)" stroke="#8b5cf6" strokeWidth="1.5" />

          {/* Data points */}
          {innerPoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#8b5cf6" />
          ))}

          {/* Labels */}
          {axes.map((a, i) => {
            const p = toPoint(a.angle, r + 22);
            return (
              <g key={i}>
                <text x={p.x} y={p.y} fill="#94a3b8" fontSize="10" textAnchor="middle" dominantBaseline="central">{a.label}</text>
                <text x={p.x} y={p.y + 12} fill="#a78bfa" fontSize="9" textAnchor="middle" dominantBaseline="central" fontWeight="600">{a.val.toFixed(2)}</text>
              </g>
            );
          })}
        </svg>

        <div className="flex-1 space-y-3">
          {axes.map(a => (
            <div key={a.label}>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-slate-400">{a.label}</span>
                <span className={`font-semibold ${a.val >= 0.7 ? "text-emerald-400" : a.val >= 0.5 ? "text-yellow-400" : "text-red-400"}`}>{a.val.toFixed(2)}</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${a.val >= 0.7 ? "bg-emerald-500" : a.val >= 0.5 ? "bg-yellow-500" : "bg-red-500"}`}
                  style={{ width: `${a.val * 100}%` }}
                />
              </div>
            </div>
          ))}
          <div className="pt-2 border-t border-white/8">
            <div className="text-[10px] text-slate-600 mb-1">Drug-likeness (Lipinski)</div>
            <div className="flex gap-2 flex-wrap">
              {[
                { rule: "MW ≤ 500",  pass: molProps?.lipinskiMW  ?? true, val: molProps?.mw   != null ? `${molProps.mw} Da` : "206.3 Da" },
                { rule: "logP ≤ 5",  pass: molProps?.lipinskiLogP ?? true, val: molProps?.logP != null ? String(molProps.logP) : "3.20" },
                { rule: "HBD ≤ 5",   pass: molProps?.lipinskiHBD  ?? true, val: molProps?.hbd  != null ? String(molProps.hbd)  : "2" },
                { rule: "HBA ≤ 10",  pass: molProps?.lipinskiHBA  ?? true, val: molProps?.hba  != null ? String(molProps.hba)  : "4" },
              ].map(({ rule, pass, val }) => (
                <div key={rule} className={`text-[9px] px-1.5 py-0.5 rounded border ${pass ? "border-emerald-500/20 text-emerald-400 bg-emerald-500/5" : "border-red-500/20 text-red-400 bg-red-500/5"}`}>
                  {rule}: {val}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BindingHeatmap({ binding, uniprotId }: { binding: BindingEstimate | null; uniprotId: string }) {
  const metrics = ["Kd (nM)", "Ki (nM)", "IC50 (nM)", "Selectivity"];

  const primaryLabel = binding ? `${binding.targetName} (${uniprotId})` : "Primary Target";
  const rows = binding
    ? [
        { label: primaryLabel, vals: [binding.primaryKd, binding.primaryKi, binding.primaryIC50, binding.selectivity] },
        ...binding.offTargets.map(o => ({
          label: o.name, vals: [o.kd, o.ki, o.ic50, o.selectivity],
        })),
      ]
    : [
        { label: "EGFR (P00533)", vals: [12.4,  8.9,   15.2,  4.20] },
        { label: "HER2 (P04626)", vals: [180.3, 210.4, 195.8, 0.07] },
        { label: "HER3 (P21860)", vals: [890.2, 1024.1, 940.5, 0.01] },
      ];

  const getColor = (val: number, col: number) => {
    if (col === 3) return val > 2 ? "#22c55e" : val > 0.5 ? "#eab308" : "#ef4444";
    return val < 50 ? "#22c55e" : val < 500 ? "#eab308" : "#ef4444";
  };

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[12px] font-semibold text-slate-300">Binding Affinity Heatmap</h3>
        {binding && (
          <Badge className="text-[9px] bg-violet-500/10 text-violet-400 border-violet-500/20">
            {binding.targetClass} · Rule-based estimate
          </Badge>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr>
              <th className="text-left text-slate-500 pb-2 pr-4 font-medium">Target</th>
              {metrics.map(m => <th key={m} className="text-center text-slate-500 pb-2 px-3 font-medium">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="text-slate-300 py-2 pr-4 whitespace-nowrap font-medium">{row.label}</td>
                {row.vals.map((v, ci) => (
                  <td key={ci} className="text-center py-2 px-3">
                    <span className="px-2 py-0.5 rounded font-semibold" style={{ color: getColor(v, ci), backgroundColor: getColor(v, ci) + "15" }}>
                      {ci === 3 ? v.toFixed(2) : v.toFixed(1)}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-4 text-[10px] text-slate-600">
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-emerald-500" /> Strong (&lt;50 nM)</div>
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-yellow-500" /> Moderate</div>
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-red-500" /> Weak (&gt;500 nM)</div>
      </div>
    </div>
  );
}

function ToxicityPanel({ organs: realOrgans, toxAlerts: realAlerts }: { organs: OrganRisk[] | null; toxAlerts: ToxicityAlert[] | null }) {
  const defaultOrgans: OrganRisk[] = [
    { name: "Liver",        risk: 0.08, color: "emerald", alerts: ["CYP3A4 substrate"] },
    { name: "Heart (hERG)", risk: 0.12, color: "emerald", alerts: ["Minor QT prolongation risk"] },
    { name: "Kidney",       risk: 0.05, color: "emerald", alerts: [] },
    { name: "CNS",          risk: 0.22, color: "yellow",  alerts: ["BBB penetrant", "CNS active class"] },
    { name: "GI Tract",     risk: 0.09, color: "emerald", alerts: [] },
    { name: "Lung",         risk: 0.04, color: "emerald", alerts: [] },
  ];
  const organs = realOrgans ?? defaultOrgans;

  const riskColor = (risk: number) =>
    risk < 0.20 ? { border: "border-emerald-500/20 bg-emerald-500/5", bar: "bg-emerald-500", text: "text-emerald-400" }
    : risk < 0.50 ? { border: "border-yellow-500/25 bg-yellow-500/5", bar: "bg-yellow-500", text: "text-yellow-400" }
    :               { border: "border-red-500/25 bg-red-500/5",        bar: "bg-red-500",     text: "text-red-400" };

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5 space-y-4">
      <div>
        <h3 className="text-[12px] font-semibold text-slate-300 mb-3">Organ Toxicity Signals</h3>
        <div className="grid grid-cols-3 gap-3">
          {organs.map(o => {
            const c = riskColor(o.risk);
            return (
              <div key={o.name} className={`border rounded-lg p-3 ${c.border}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-slate-300">{o.name}</span>
                  <span className={`text-[12px] font-bold ${c.text}`}>{(o.risk * 100).toFixed(0)}%</span>
                </div>
                <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-2">
                  <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${Math.min(o.risk * 100, 100)}%` }} />
                </div>
                <div className="text-[9px]">
                  {o.alerts.length > 0 ? o.alerts.map(a => <div key={a} className="text-yellow-500/80">⚠ {a}</div>) : <div className="text-emerald-600">No alerts</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {realAlerts && realAlerts.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold text-slate-400 mb-2">Structural Alerts</h4>
          <div className="space-y-1.5">
            {realAlerts.map((a, i) => (
              <div key={i} className={`flex items-start gap-2 text-[10px] px-2.5 py-2 rounded-lg border ${
                a.severity === "High" ? "border-red-500/20 bg-red-500/5 text-red-300"
                : a.severity === "Medium" ? "border-yellow-500/20 bg-yellow-500/5 text-yellow-300"
                : "border-slate-700/40 bg-white/2 text-slate-400"
              }`}>
                <span className="font-bold shrink-0 mt-0.5">[{a.severity}]</span>
                <div>
                  <div className="font-semibold">{a.name}</div>
                  <div className="text-slate-600 mt-0.5">{a.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BatchTable({ simResults, molName }: { simResults: SimResults | null; molName: string }) {
  const toxAlerts = simResults?.toxAlerts ?? [];
  const toxLevel  = toxAlerts.some(a => a.severity === "High") ? "High" : toxAlerts.some(a => a.severity === "Medium") ? "Medium" : "Low";
  const base = simResults
    ? {
        qed: simResults.qed, toxLevel,
        binding: `${simResults.binding.primaryKd.toFixed(1)} nM`,
        composite: simResults.confidence,
      }
    : { qed: 0.72, toxLevel: "Low", binding: "12.4 nM", composite: 0.81 };

  const jitter = (v: number, max: number) => Math.max(0, Math.min(1, v + (Math.random() - 0.5) * max));
  const rows = [
    { rank: 1, name: molName,                      qed: base.qed, tox: base.toxLevel, binding: base.binding, sa: 2.8, composite: base.composite, pareto: true },
    { rank: 2, name: `${molName}-Analog-007`,       qed: jitter(base.qed - 0.04, 0.1), tox: "Low",    binding: "18.2 nM", sa: 3.1, composite: jitter(base.composite - 0.05, 0.05), pareto: true },
    { rank: 3, name: `${molName}-Analog-012`,       qed: jitter(base.qed - 0.11, 0.1), tox: "Medium", binding: "24.7 nM", sa: 2.4, composite: jitter(base.composite - 0.14, 0.05), pareto: false },
    { rank: 4, name: `${molName}-Analog-003`,       qed: jitter(base.qed - 0.17, 0.1), tox: "Low",    binding: "31.0 nM", sa: 3.8, composite: jitter(base.composite - 0.18, 0.05), pareto: false },
    { rank: 5, name: `${molName}-Analog-019`,       qed: jitter(base.qed - 0.13, 0.1), tox: "High",   binding: "9.8 nM",  sa: 2.2, composite: jitter(base.composite - 0.23, 0.05), pareto: false },
  ];

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[12px] font-semibold text-slate-300">Batch Comparison</h3>
        <div className="flex gap-2">
          <Badge className="text-[9px] bg-violet-500/10 text-violet-400 border-violet-500/20">Pareto-optimal highlighted</Badge>
          <Button variant="outline" size="sm" className="h-6 text-[10px] border-white/10 text-slate-400 gap-1">
            <Download className="w-3 h-3" /> CSV
          </Button>
        </div>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-white/8">
            {["#","Name","QED","Toxicity","Binding","SA Score","Composite"].map(h => (
              <th key={h} className="text-left py-2 pr-4 text-slate-500 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.rank} className={`border-b border-white/5 hover:bg-white/3 cursor-pointer ${row.pareto ? "bg-violet-500/3" : ""}`}>
              <td className="py-2 pr-4 font-bold text-slate-500">{row.rank}</td>
              <td className="py-2 pr-4">
                <div className="flex items-center gap-1.5">
                  {row.pareto && <div className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />}
                  <span className={row.pareto ? "text-white" : "text-slate-400"}>{row.name}</span>
                </div>
              </td>
              <td className="py-2 pr-4"><span className="text-emerald-400 font-medium">{row.qed}</span></td>
              <td className="py-2 pr-4">
                <Badge className={`text-[9px] ${row.tox === "Low" ? "bg-emerald-500/10 text-emerald-400" : row.tox === "Medium" ? "bg-yellow-500/10 text-yellow-400" : "bg-red-500/10 text-red-400"}`}>
                  {row.tox}
                </Badge>
              </td>
              <td className="py-2 pr-4 text-slate-300">{row.binding}</td>
              <td className="py-2 pr-4 text-slate-300">{row.sa}</td>
              <td className="py-2 pr-4">
                <div className="flex items-center gap-2">
                  <div className="w-12 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full" style={{ width: `${row.composite * 100}%` }} />
                  </div>
                  <span className="font-semibold text-violet-300">{row.composite.toFixed(2)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Layer 2 Results ───────────────────────────────────────────────────
function Layer2Results({ cohortResults, indication, simResults: sr2, aiReport: l2Rep, aiLoading: l2Load, aiError: l2Err, aiStream: l2Strm, onRunAi: runL2, safetyFlags: sf2, flagsAcknowledged: fa2, onAcknowledgeFlags: oaf2 }: {
  cohortResults: CohortResults | null;
  indication: string;
  simResults: SimResults | null;
  aiReport: Record<string, unknown> | null;
  aiLoading: boolean;
  aiError: string | null;
  aiStream: string;
  onRunAi: () => void;
  safetyFlags?: SafetyFlag[];
  flagsAcknowledged?: boolean;
  onAcknowledgeFlags?: () => void;
}) {
  const [activeTab, setActiveTab] = useState("pkpd");
  const cr = cohortResults;

  const cmaxNgmL = cr ? cr.cmax * 1000 : null;
  const cmaxSDNgmL = cr ? cr.cmaxSD * 1000 : null;
  const summaryStats = [
    { label: "Responder Rate", val: cr ? `${(cr.responderRate * 100).toFixed(1)}%` : "58.4%",         sub: cr ? `n=${cr.cohortSize} patients` : "at 200mg QD",                    color: "blue" },
    { label: "Cmax Mean",      val: cmaxNgmL != null ? `${cmaxNgmL.toFixed(0)} ng/mL` : "2,847 ng/mL", sub: cmaxSDNgmL != null ? `±${cmaxSDNgmL.toFixed(0)} ng/mL SD` : "±412 ng/mL SD", color: "blue" },
    { label: "AUC₀₋₄₈",      val: cr ? `${cr.auc.toFixed(1)} µg·h/mL`             : "28.1 µg·h/mL", sub: "2-compartment PBPK",                                                 color: "blue" },
    { label: "Grade ≥3 AEs",   val: cr ? `${(cr.grade3AERate * 100).toFixed(1)}%`    : "12.3%",        sub: "projected incidence",                                                color: "amber" },
  ];

  const ds = cr?.dataSources;
  const sourceBadges = [
    { label: "2-Cpt PBPK",   active: ds?.pbpk === "2-compartment", color: "blue"   },
    { label: "NHANES Pop.",   active: ds?.population === "nhanes",  color: "blue"   },
    { label: ds?.pd === "chembl-live" ? "ChEMBL PD" : "Est. PD",
      active: ds?.pd === "chembl-live", color: "violet" },
    { label: ds?.ae === "faers-live"  ? "FAERS AE"  : "Est. AE",
      active: ds?.ae === "faers-live",  color: ds?.ae === "faers-live" ? "emerald" : "slate" },
  ];

  return (
    <div className="space-y-4">
      {/* Summary Header */}
      <div className="grid grid-cols-4 gap-3">
        {summaryStats.map(({ label, val, sub, color }) => (
          <div key={label} className={`rounded-xl border p-4 ${color === "blue" ? "border-blue-500/20 bg-blue-500/5" : "border-amber-500/20 bg-amber-500/5"}`}>
            <div className="text-[10px] text-slate-500 mb-1">{label}</div>
            <div className={`text-[16px] font-bold ${color === "blue" ? "text-blue-300" : "text-amber-300"}`}>{val}</div>
            <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>
          </div>
        ))}
      </div>

      {/* Data Source Badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] text-slate-600 uppercase tracking-widest">Data sources:</span>
        {sourceBadges.map(({ label, active, color }) => (
          <span key={label} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
            active
              ? color === "blue"   ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
              : color === "violet" ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
              : color === "emerald"? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-white/10 bg-white/5 text-slate-400"
              : "border-white/8 bg-white/3 text-slate-600"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${active ? (color === "emerald" ? "bg-emerald-400" : color === "violet" ? "bg-violet-400" : "bg-blue-400") : "bg-slate-600"}`} />
            {label}
          </span>
        ))}
      </div>

      <div className="flex gap-1 bg-white/5 p-1 rounded-lg">
        {[
          { id: "pkpd", label: "PK/PD Curves", icon: LineChart },
          { id: "responders", label: "Responders", icon: PieChart },
          { id: "ae", label: "Adverse Events", icon: Shield },
          { id: "subgroup", label: "Subgroup", icon: BarChart3 },
          { id: "dose", label: "Dose-Response", icon: TrendingUp },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-medium transition-all ${
              activeTab === id ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "pkpd"       && <PKPDCurves       cr={cr} />}
      {activeTab === "responders" && <ResponderChart    cr={cr} />}
      {activeTab === "ae"         && <AETable           cr={cr} />}
      {activeTab === "subgroup"   && <SubgroupHeatmap   cr={cr} />}
      {activeTab === "dose"       && <DoseResponseCurve cr={cr} />}

      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" className="border-white/10 text-slate-400 hover:text-white text-[11px] gap-1.5">
          <Download className="w-3.5 h-3.5" /> CSV
        </Button>
        <Button variant="outline" size="sm" className="border-white/10 text-slate-400 hover:text-white text-[11px] gap-1.5">
          <FileText className="w-3.5 h-3.5" /> PDF
        </Button>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-500 text-white text-[11px] gap-1.5">
          Export I/E Criteria to Layer 3 <ArrowRight className="w-3.5 h-3.5" />
        </Button>
      </div>

      <RegulatoryInsightCard layer={2} indication={indication} cohortResults={cr} similarDrugs={sr2?.similarDrugs} />
      <SimulationDataSources layer={2} simResults={sr2} cohortResults={cr} />
      <LayerAiPanel
        layer={2}
        report={l2Rep}
        loading={l2Load}
        error={l2Err}
        stream={l2Strm}
        onRun={runL2}
        simResults={sr2}
        cohortResults={cr}
        safetyFlags={sf2}
        flagsAcknowledged={fa2}
        onAcknowledgeFlags={oaf2}
      />
    </div>
  );
}

function PKPDCurves({ cr }: { cr: CohortResults | null }) {
  const colors = ["#6366f1","#3b82f6","#06b6d4","#22c55e"];

  if (cr) {
    const pts = cr.pkCurve;
    const maxConc = Math.max(...pts.map(p => p.ci_hi), 0.001);
    const maxT    = pts[pts.length - 1]?.time ?? 48;
    const W = 470, H = 190, padL = 42, padB = 20;

    const tx = (t: number) => padL + (t / maxT) * W;
    const ty = (c: number) => H - (c / maxConc) * (H - padB);

    const polyPts = pts.map(p => `${tx(p.time).toFixed(1)},${ty(p.conc).toFixed(1)}`).join(" ");
    const ciPath  = [
      ...pts.map(p => `${tx(p.time).toFixed(1)},${ty(p.ci_hi).toFixed(1)}`),
      ...[...pts].reverse().map(p => `${tx(p.time).toFixed(1)},${ty(p.ci_lo).toFixed(1)}`),
    ].join(" ");

    return (
      <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[12px] font-semibold text-slate-300">PK/PD Concentration Curve</h3>
          <div className="flex gap-3 text-[10px] text-slate-500">
            <span>Cmax: <span className="text-blue-300 font-semibold">{(cr.cmax * 1000).toFixed(0)} ng/mL</span></span>
            <span>t½: <span className="text-blue-300 font-semibold">{cr.halfLifeHr.toFixed(1)} h</span></span>
            <span>Tmax: <span className="text-blue-300 font-semibold">{cr.tmax.toFixed(1)} h</span></span>
          </div>
        </div>
        <svg width="100%" height="200" viewBox={`0 0 ${padL + W + 10} ${H + 12}`} className="overflow-visible">
          {[0, 0.25, 0.5, 0.75, 1].map(f => (
            <line key={f} x1={padL} y1={ty(maxConc * f)} x2={padL + W} y2={ty(maxConc * f)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          ))}
          {pts.filter((_, i) => i % 3 === 0).map(p => (
            <text key={p.time} x={tx(p.time)} y={H + 12} fill="#4b5563" fontSize="9" textAnchor="middle">{p.time}h</text>
          ))}
          <polygon points={ciPath} fill="rgba(59,130,246,0.10)" />
          <polyline points={polyPts} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round" />
          <text x="10" y={ty(maxConc * 0.5)} fill="#6b7280" fontSize="9" transform={`rotate(-90 10 ${ty(maxConc * 0.5)})`}>ng/mL</text>
        </svg>
        <div className="flex items-center gap-4 mt-1 text-[10px]">
          <div className="flex items-center gap-1.5"><div className="w-6 h-0.5 rounded bg-blue-400" /> Observed PK</div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-blue-500/10" /> 95% CI</div>
        </div>
      </div>
    );
  }

  const doses = [100, 200, 400, 800];
  const timePoints = [0, 1, 2, 4, 6, 8, 12, 24];
  const pk = (dose: number, t: number) =>
    dose * 14.2 * (Math.exp(-0.058 * t) - Math.exp(-0.693 * t)) / (0.693 - 0.058);

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">PK/PD Concentration Curves</h3>
      <svg width="100%" height="220" viewBox="0 0 520 220" className="overflow-visible">
        {[0, 50, 100, 150, 200].map(y => (
          <line key={y} x1="40" y1={200 - y} x2="510" y2={200 - y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        ))}
        {timePoints.map((t, i) => (
          <text key={t} x={40 + i * 67} y="215" fill="#4b5563" fontSize="9" textAnchor="middle">{t}h</text>
        ))}
        <rect x="40" y="100" width="470" height="60" fill="rgba(34,197,94,0.05)" />
        <text x="44" y="108" fill="#22c55e" fontSize="8">Therapeutic Window</text>
        {doses.map((dose, di) => {
          const pts = timePoints.map((t, i) => {
            const val = pk(dose, t) / 60;
            return `${40 + i * 67},${Math.max(0, 200 - val)}`;
          });
          return <polyline key={dose} points={pts.join(" ")} fill="none" stroke={colors[di]} strokeWidth="2" opacity="0.85" />;
        })}
        <text x="10" y="120" fill="#6b7280" fontSize="9" transform="rotate(-90 10 120)">Conc (ng/mL)</text>
      </svg>
      <div className="flex gap-4 mt-2">
        {doses.map((d, i) => (
          <div key={d} className="flex items-center gap-1.5">
            <div className="w-6 h-0.5 rounded" style={{ backgroundColor: colors[i] }} />
            <span className="text-[10px] text-slate-500">{d} mg QD</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResponderChart({ cr }: { cr: CohortResults | null }) {
  const segments = cr
    ? [
        { label: "Responder",     pct: parseFloat((cr.responderRate    * 100).toFixed(1)), color: "#22c55e" },
        { label: "Partial",       pct: parseFloat((cr.partialRate      * 100).toFixed(1)), color: "#eab308" },
        { label: "Non-responder", pct: parseFloat((cr.nonResponderRate * 100).toFixed(1)), color: "#ef4444" },
      ]
    : [
        { label: "Responder",     pct: 58.4, color: "#22c55e" },
        { label: "Partial",       pct: 24.1, color: "#eab308" },
        { label: "Non-responder", pct: 17.5, color: "#ef4444" },
      ];

  const cx = 80, cy = 80, r = 65;
  let cumAngle = -90;
  const slices = segments.map(s => {
    const angle = (s.pct / 100) * 360;
    const startAngle = cumAngle;
    cumAngle += angle;
    const start = { x: cx + r * Math.cos((startAngle * Math.PI) / 180), y: cy + r * Math.sin((startAngle * Math.PI) / 180) };
    const end = { x: cx + r * Math.cos(((startAngle + angle) * Math.PI) / 180), y: cy + r * Math.sin(((startAngle + angle) * Math.PI) / 180) };
    const largeArc = angle > 180 ? 1 : 0;
    return { ...s, d: `M${cx},${cy} L${start.x},${start.y} A${r},${r} 0 ${largeArc} 1 ${end.x},${end.y} Z` };
  });

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">Responder Classification</h3>
      <div className="flex gap-6 items-center">
        <svg width="160" height="160" className="shrink-0">
          {slices.map((s, i) => (
            <path key={i} d={s.d} fill={s.color} opacity="0.85" className="cursor-pointer hover:opacity-100" />
          ))}
          <circle cx={cx} cy={cy} r="28" fill="#0d0f17" />
          <text x={cx} y={cy - 6} fill="white" fontSize="14" textAnchor="middle" fontWeight="700">{segments[0].pct}%</text>
          <text x={cx} y={cy + 8} fill="#6b7280" fontSize="8" textAnchor="middle">Response</text>
        </svg>
        <div className="flex-1 space-y-3">
          {segments.map(s => (
            <div key={s.label}>
              <div className="flex justify-between text-[11px] mb-1">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-slate-400">{s.label}</span>
                </div>
                <span className="font-semibold" style={{ color: s.color }}>{s.pct}%</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${s.pct}%`, backgroundColor: s.color, opacity: 0.7 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AETable({ cr }: { cr: CohortResults | null }) {
  const aes = cr
    ? cr.adverseEvents.map(e => ({
        ae:         e.name,
        incidence:  parseFloat((e.anyGrade * 100).toFixed(1)),
        mild:       parseFloat(((e.anyGrade - e.grade3Plus) * 0.65 * 100).toFixed(1)),
        moderate:   parseFloat(((e.anyGrade - e.grade3Plus) * 0.35 * 100).toFixed(1)),
        severe:     parseFloat((e.grade3Plus * 100).toFixed(1)),
        onset:      0,
      }))
    : [
        { ae: "Nausea",              incidence: 28.4, mild: 18.2, moderate: 8.6, severe: 1.6, onset: 3  },
        { ae: "Fatigue",             incidence: 22.1, mild: 14.3, moderate: 7.1, severe: 0.7, onset: 7  },
        { ae: "Neutropenia (Gr ≥3)", incidence: 12.3, mild:  0.0, moderate: 4.2, severe: 8.1, onset: 21 },
        { ae: "ALT Elevation",       incidence:  8.9, mild:  4.2, moderate: 3.9, severe: 0.8, onset: 14 },
        { ae: "QTc Prolongation",    incidence:  4.2, mild:  2.8, moderate: 1.1, severe: 0.3, onset: 10 },
      ];

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">Adverse Event Predictions</h3>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-white/8">
            {["Adverse Event","Incidence","Mild","Moderate","Severe","Onset (d)"].map(h => (
              <th key={h} className="text-left py-2 pr-4 text-slate-500 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {aes.map(ae => (
            <tr key={ae.ae} className="border-b border-white/5 hover:bg-white/3 cursor-pointer">
              <td className="py-2 pr-4 text-slate-300">{ae.ae}</td>
              <td className="py-2 pr-4">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${ae.incidence}%` }} />
                  </div>
                  <span className="text-amber-400 font-medium">{ae.incidence}%</span>
                </div>
              </td>
              <td className="py-2 pr-4 text-slate-500">{ae.mild > 0 ? `${ae.mild}%` : "—"}</td>
              <td className="py-2 pr-4 text-yellow-500/80">{ae.moderate > 0 ? `${ae.moderate}%` : "—"}</td>
              <td className="py-2 pr-4 text-red-400">{ae.severe > 0 ? `${ae.severe}%` : "—"}</td>
              <td className="py-2 pr-4 text-slate-400">Day {ae.onset}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubgroupHeatmap({ cr }: { cr: CohortResults | null }) {
  const rows = ["18–40 yrs","41–60 yrs","61–75 yrs","Male","Female","White","Hispanic","Asian","eGFR >90","eGFR 30–60"];
  const cols = ["Response Rate","AE Rate","Cmax","AUC","PFS"];

  const getVal = (ri: number, ci: number) => {
    const base = [0.62, 0.56, 0.48, 0.61, 0.55, 0.58, 0.54, 0.61, 0.63, 0.49];
    return (base[ri] * [1, 0.8, 1.1, 0.9, 1.05][ci] + Math.random() * 0.05).toFixed(2);
  };

  const valToColor = (v: string) => {
    const n = parseFloat(v);
    if (n > 0.65) return "#22c55e";
    if (n > 0.55) return "#84cc16";
    if (n > 0.45) return "#eab308";
    return "#ef4444";
  };

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5 overflow-x-auto">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">Subgroup Analysis Heatmap</h3>
      <table className="text-[10px]">
        <thead>
          <tr>
            <th className="text-slate-500 font-medium pr-4 pb-2 text-left">Subgroup</th>
            {cols.map(c => <th key={c} className="text-slate-500 font-medium px-3 pb-2">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r}>
              <td className="text-slate-400 pr-4 py-1.5 whitespace-nowrap">{r}</td>
              {cols.map((_, ci) => {
                const v = getVal(ri, ci);
                return (
                  <td key={ci} className="px-3 py-1.5 text-center">
                    <span
                      className="px-2 py-0.5 rounded text-[10px] font-medium"
                      style={{ color: valToColor(v), backgroundColor: valToColor(v) + "18" }}
                    >
                      {v}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DoseResponseCurve({ cr }: { cr: CohortResults | null }) {
  const doses    = cr ? cr.doseGroups.map(g => g.dose)     : [50, 100, 200, 400, 800];
  const response = cr ? cr.doseGroups.map(g => g.respRate) : [0.18, 0.34, 0.58, 0.71, 0.74];
  const ciLow = response.map(r => r - 0.08);
  const ciHigh = response.map(r => r + 0.08);

  const xScale = (i: number) => 50 + i * 100;
  const yScale = (v: number) => 180 - v * 170;

  const line = response.map((r, i) => `${xScale(i)},${yScale(r)}`).join(" ");
  const ciPath = `${ciHigh.map((v, i) => `${i === 0 ? "M" : "L"}${xScale(i)},${yScale(v)}`).join(" ")} ${ciLow.slice().reverse().map((v, i) => `L${xScale(doses.length - 1 - i)},${yScale(v)}`).join(" ")} Z`;

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">Dose-Response Curve</h3>
      <svg width="100%" height="220" viewBox="0 0 540 220">
        {[0, 0.25, 0.5, 0.75, 1.0].map((v, i) => (
          <g key={i}>
            <line x1="40" y1={yScale(v)} x2="520" y2={yScale(v)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            <text x="36" y={yScale(v) + 4} fill="#4b5563" fontSize="9" textAnchor="end">{(v * 100).toFixed(0)}%</text>
          </g>
        ))}

        {doses.map((d, i) => (
          <text key={d} x={xScale(i)} y="200" fill="#4b5563" fontSize="9" textAnchor="middle">{d}mg</text>
        ))}

        <path d={ciPath} fill="rgba(59,130,246,0.1)" />
        <polyline points={line} fill="none" stroke="#3b82f6" strokeWidth="2.5" />

        {response.map((r, i) => (
          <circle key={i} cx={xScale(i)} cy={yScale(r)} r="5" fill="#3b82f6" className="cursor-pointer" />
        ))}

        {/* Markers */}
        <line x1={xScale(2)} y1="0" x2={xScale(2)} y2="190" stroke="#22c55e" strokeWidth="1" strokeDasharray="4,3" opacity="0.5" />
        <text x={xScale(2)} y="10" fill="#22c55e" fontSize="8" textAnchor="middle">RP2D</text>

        <line x1={xScale(3)} y1="0" x2={xScale(3)} y2="190" stroke="#eab308" strokeWidth="1" strokeDasharray="4,3" opacity="0.5" />
        <text x={xScale(3)} y="10" fill="#eab308" fontSize="8" textAnchor="middle">MTD</text>
      </svg>
    </div>
  );
}

// ── PROCOVA Results Panel ─────────────────────────────────────────────
function ProcovaResultsPanel({ pr, powerTarget }: { pr: ProcovaResults; powerTarget: number }) {
  const [activeTab, setActiveTab] = useState("comparison");
  const pctTarget = (powerTarget * 100).toFixed(0);

  const tabs = [
    { id: "comparison", label: "Design Comparison" },
    { id: "power",      label: "Dual Power Curve" },
    { id: "enrollment", label: "Enrollment Impact" },
    { id: "cost",       label: "Cost Savings" },
    { id: "sensitivity",label: "Sensitivity" },
    { id: "regulatory", label: "Regulatory" },
  ];

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-1 h-6 rounded-full bg-emerald-500" />
        <h3 className="text-[14px] font-bold text-white">AI-Enhanced Trial Design (PROCOVA)</h3>
        <Badge className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Prognostic Covariate Adjustment</Badge>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Patients Saved",     val: `${pr.standardN - pr.enhancedN}`,           sub: `${pr.standardN} → ${pr.enhancedN} total`,         color: "emerald" },
          { label: "Cost Savings",       val: `$${pr.costSavings.toFixed(1)}M`,           sub: `−${pr.costSavingsPct.toFixed(0)}% vs standard`,    color: "emerald" },
          { label: "Time Saved",         val: `${pr.durationSavingsMonths} months`,       sub: `${pr.standardDuration} → ${pr.enhancedDuration}mo`, color: "blue" },
          { label: "Placebo Reduction",  val: `${pr.placeboReduction} fewer`,             sub: `Control: ${pr.standardNc} → ${pr.enhancedNc}`,      color: "amber" },
        ].map(({ label, val, sub, color }) => (
          <div key={label} className={`rounded-xl border p-3.5 ${color === "emerald" ? "border-emerald-500/20 bg-emerald-500/5" : color === "blue" ? "border-blue-500/20 bg-blue-500/5" : "border-amber-500/20 bg-amber-500/5"}`}>
            <div className="text-[10px] text-slate-500 mb-1">{label}</div>
            <div className={`text-[15px] font-bold ${color === "emerald" ? "text-emerald-300" : color === "blue" ? "text-blue-300" : "text-amber-300"}`}>{val}</div>
            <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 bg-white/5 p-1 rounded-lg">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 py-1.5 rounded-md text-[10px] font-medium transition-all ${
              activeTab === id ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "comparison" && <ProcovaComparison pr={pr} />}
      {activeTab === "power"      && <ProcovaDualPower pr={pr} powerTarget={powerTarget} />}
      {activeTab === "enrollment" && <ProcovaEnrollment pr={pr} />}
      {activeTab === "cost"       && <ProcovaCostBreakdown pr={pr} />}
      {activeTab === "sensitivity"&& <ProcovaSensitivity pr={pr} pctTarget={pctTarget} powerTarget={powerTarget} />}
      {activeTab === "regulatory" && <ProcovaRegulatory />}
    </div>
  );
}

function ProcovaComparison({ pr }: { pr: ProcovaResults }) {
  const rows = [
    { param: "Total Sample Size",       std: String(pr.standardN),                              enh: String(pr.enhancedN),                              delta: `${pr.enhancedN - pr.standardN} (${((pr.enhancedN - pr.standardN) / pr.standardN * 100).toFixed(0)}%)` },
    { param: "Treatment Arm",           std: String(pr.standardNt),                             enh: String(pr.enhancedNt),                             delta: `${pr.enhancedNt - pr.standardNt}` },
    { param: "Control Arm",             std: String(pr.standardNc),                             enh: String(pr.enhancedNc),                             delta: `${pr.enhancedNc - pr.standardNc} (${((pr.enhancedNc - pr.standardNc) / pr.standardNc * 100).toFixed(0)}%)` },
    { param: "Randomization Ratio",     std: "1:1",                                             enh: pr.ratioLabel,                                     delta: "—" },
    { param: "Statistical Power",       std: `${(pr.standardPower * 100).toFixed(0)}%`,         enh: `${(pr.enhancedPower * 100).toFixed(0)}%`,         delta: "Equivalent" },
    { param: "Variance Reduction",      std: "—",                                               enh: `${(pr.varianceReductionApplied * 100).toFixed(0)}%`, delta: "—" },
    { param: "Enrollment Timeline",     std: `${pr.standardDuration} months`,                   enh: `${pr.enhancedDuration} months`,                   delta: `−${pr.durationSavingsMonths} months` },
    { param: "Estimated Cost",          std: `$${pr.standardCost.toFixed(1)}M`,                 enh: `$${pr.enhancedCost.toFixed(1)}M`,                 delta: `−$${pr.costSavings.toFixed(1)}M (−${pr.costSavingsPct.toFixed(0)}%)` },
    { param: "Patients on Placebo",     std: String(pr.standardNc),                             enh: String(pr.enhancedNc),                             delta: `−${pr.placeboReduction} (ethical benefit)` },
  ];

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">Design Comparison Summary</h3>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left py-2 pr-4 text-slate-500 font-medium w-[35%]">Parameter</th>
            <th className="text-center py-2 px-3 text-slate-500 font-medium">Standard Design</th>
            <th className="text-center py-2 px-3 text-emerald-400 font-medium">Enhanced Design</th>
            <th className="text-center py-2 px-3 text-slate-500 font-medium">Delta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.param} className="border-b border-white/5">
              <td className="py-2 pr-4 text-slate-400 font-medium">{r.param}</td>
              <td className="py-2 px-3 text-center text-slate-300">{r.std}</td>
              <td className="py-2 px-3 text-center text-emerald-300 font-semibold">{r.enh}</td>
              <td className="py-2 px-3 text-center text-slate-500">{r.delta}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/15 text-[10px] text-blue-300 leading-relaxed">
        Treatment arm remains unchanged — regulatory agencies require the same exposure data for safety assessment regardless of control arm design. Enrollment savings come entirely from the reduced control arm.
      </div>
    </div>
  );
}

function ProcovaDualPower({ pr, powerTarget }: { pr: ProcovaResults; powerTarget: number }) {
  const data = pr.dualPowerCurve;
  const maxN = Math.max(...data.map(d => d.n));
  const xS = (n: number) => 50 + (n / maxN) * 440;
  const yS = (v: number) => 185 - v * 165;
  const pctTarget = (powerTarget * 100).toFixed(0);

  const stdIdx = data.reduce((bi, d, i) => Math.abs(d.standardPower - powerTarget) < Math.abs(data[bi].standardPower - powerTarget) ? i : bi, 0);
  const enhIdx = data.reduce((bi, d, i) => Math.abs(d.enhancedPower - powerTarget) < Math.abs(data[bi].enhancedPower - powerTarget) ? i : bi, 0);

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-2">Dual Power Curve — Standard vs PROCOVA-Enhanced</h3>
      <svg width="100%" height="230" viewBox="0 0 540 230">
        {[0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((v, i) => (
          <g key={i}>
            <line x1="50" y1={yS(v)} x2="500" y2={yS(v)} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
            <text x="46" y={yS(v) + 4} fill="#4b5563" fontSize="8" textAnchor="end">{(v * 100).toFixed(0)}%</text>
          </g>
        ))}
        {data.filter((_, i) => i % 2 === 0 || i === data.length - 1).map(d => (
          <text key={d.n} x={xS(d.n)} y="210" fill="#4b5563" fontSize="8" textAnchor="middle">{d.n}</text>
        ))}

        <line x1="50" y1={yS(powerTarget)} x2="500" y2={yS(powerTarget)} stroke="#eab308" strokeWidth="1" strokeDasharray="5,3" opacity="0.5" />
        <text x="504" y={yS(powerTarget) + 4} fill="#eab308" fontSize="8">{pctTarget}%</text>

        <polyline
          points={data.map(d => `${xS(d.n)},${yS(d.standardPower)}`).join(" ")}
          fill="none" stroke="#22c55e" strokeWidth="2"
        />
        <polyline
          points={data.map(d => `${xS(d.n)},${yS(d.enhancedPower)}`).join(" ")}
          fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="6,3"
        />

        <circle cx={xS(data[stdIdx].n)} cy={yS(data[stdIdx].standardPower)} r="4" fill="#22c55e" />
        <text x={xS(data[stdIdx].n)} y={yS(data[stdIdx].standardPower) - 8} fill="#22c55e" fontSize="8" textAnchor="middle" fontWeight="bold">n={data[stdIdx].n}</text>

        <circle cx={xS(data[enhIdx].n)} cy={yS(data[enhIdx].enhancedPower)} r="4" fill="#3b82f6" />
        <text x={xS(data[enhIdx].n)} y={yS(data[enhIdx].enhancedPower) - 8} fill="#3b82f6" fontSize="8" textAnchor="middle" fontWeight="bold">n={data[enhIdx].n}</text>

        {data[stdIdx].n !== data[enhIdx].n && (
          <>
            <line x1={xS(data[enhIdx].n)} y1={yS(powerTarget) + 5} x2={xS(data[stdIdx].n)} y2={yS(powerTarget) + 5} stroke="#f59e0b" strokeWidth="1.5" markerEnd="url(#arrowProc)" />
            <text x={(xS(data[enhIdx].n) + xS(data[stdIdx].n)) / 2} y={yS(powerTarget) + 18} fill="#f59e0b" fontSize="8" textAnchor="middle" fontWeight="bold">Δ {data[stdIdx].n - data[enhIdx].n} patients</text>
          </>
        )}

        <defs><marker id="arrowProc" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#f59e0b" /></marker></defs>

        <text x="24" y="120" fill="#6b7280" fontSize="8" transform="rotate(-90 24 120)">Power (1-β)</text>
        <text x="280" y="225" fill="#6b7280" fontSize="8" textAnchor="middle">Total Sample Size</text>
      </svg>
      <div className="flex gap-4 text-[10px] text-slate-500 mt-1">
        <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-emerald-500" />Standard (1:1)</div>
        <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-blue-500" style={{ borderTop: "1px dashed #3b82f6" }} />PROCOVA-Enhanced ({pr.ratioLabel})</div>
        <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-yellow-500 opacity-50" style={{ borderTop: "1px dashed #eab308" }} />{pctTarget}% Power Threshold</div>
      </div>
    </div>
  );
}

function ProcovaEnrollment({ pr }: { pr: ProcovaResults }) {
  const data = pr.dualEnrollment;
  const maxM = data[data.length - 1].month;
  const maxN = Math.max(pr.standardN, pr.enhancedN);
  const xS = (m: number) => 50 + (m / maxM) * 440;
  const yS = (v: number) => 180 - (v / maxN) * 160;

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-2">Enrollment Impact — Time to Target</h3>
      <svg width="100%" height="215" viewBox="0 0 540 215">
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const v = Math.round(f * maxN);
          return (
            <g key={i}>
              <line x1="50" y1={yS(v)} x2="500" y2={yS(v)} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
              <text x="46" y={yS(v) + 4} fill="#4b5563" fontSize="8" textAnchor="end">{v}</text>
            </g>
          );
        })}
        {[0, 6, 12, 18, 24, 30, 36].filter(m => m <= maxM).map(m => (
          <text key={m} x={xS(m)} y="200" fill="#4b5563" fontSize="8" textAnchor="middle">M{m}</text>
        ))}

        <line x1="50" y1={yS(pr.standardN)} x2="500" y2={yS(pr.standardN)} stroke="#22c55e" strokeWidth="1" strokeDasharray="6,3" opacity="0.3" />
        <text x="504" y={yS(pr.standardN) + 4} fill="#22c55e" fontSize="7" opacity="0.5">Std Target</text>
        <line x1="50" y1={yS(pr.enhancedN)} x2="500" y2={yS(pr.enhancedN)} stroke="#3b82f6" strokeWidth="1" strokeDasharray="6,3" opacity="0.3" />
        <text x="504" y={yS(pr.enhancedN) + 4} fill="#3b82f6" fontSize="7" opacity="0.5">Enh Target</text>

        <polyline
          points={data.map(d => `${xS(d.month)},${yS(d.standardEnrolled)}`).join(" ")}
          fill="none" stroke="#22c55e" strokeWidth="2"
        />
        <polyline
          points={data.map(d => `${xS(d.month)},${yS(d.enhancedEnrolled)}`).join(" ")}
          fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="6,3"
        />
        <text x="280" y="212" fill="#6b7280" fontSize="8" textAnchor="middle">Months from First Patient In</text>
      </svg>
      <div className="flex gap-4 text-[10px] text-slate-500 mt-1">
        <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-emerald-500" />Standard (n={pr.standardN})</div>
        <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-blue-500" style={{ borderTop: "1px dashed #3b82f6" }} />Enhanced (n={pr.enhancedN})</div>
      </div>
      {pr.durationSavingsMonths > 0 && (
        <div className="mt-3 p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/15 text-[10px] text-emerald-300">
          PROCOVA-enhanced design reaches enrollment target approximately {pr.durationSavingsMonths} months earlier, reducing overall trial duration from {pr.standardDuration} to {pr.enhancedDuration} months.
        </div>
      )}
    </div>
  );
}

function ProcovaCostBreakdown({ pr }: { pr: ProcovaResults }) {
  const colors = ["#8b5cf6", "#3b82f6", "#06b6d4", "#22c55e"];
  const stdPerPt = pr.standardN > 0 ? Math.round((pr.standardCost * 1_000_000) / pr.standardN) : 0;
  const enhPerPt = pr.enhancedN > 0 ? Math.round((pr.enhancedCost * 1_000_000) / pr.enhancedN) : 0;

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">Cost Savings Breakdown</h3>

      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="rounded-xl border border-white/8 p-3 text-center">
          <div className="text-[10px] text-slate-600">Standard Cost</div>
          <div className="text-[20px] font-bold text-slate-300">${pr.standardCost.toFixed(1)}M</div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
          <div className="text-[10px] text-emerald-400">Enhanced Cost</div>
          <div className="text-[20px] font-bold text-emerald-300">${pr.enhancedCost.toFixed(1)}M</div>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-center">
          <div className="text-[10px] text-amber-400">Total Savings</div>
          <div className="text-[20px] font-bold text-amber-300">${pr.costSavings.toFixed(1)}M</div>
          <div className="text-[10px] text-amber-400/60">−{pr.costSavingsPct.toFixed(0)}%</div>
        </div>
      </div>

      <table className="w-full text-[11px] mb-4">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left py-2 text-slate-500 font-medium">Category</th>
            <th className="text-right py-2 text-slate-500 font-medium">Standard</th>
            <th className="text-right py-2 text-emerald-400 font-medium">Enhanced</th>
            <th className="text-right py-2 text-slate-500 font-medium">Savings</th>
          </tr>
        </thead>
        <tbody>
          {pr.costBreakdown.map((c, i) => (
            <tr key={c.category} className="border-b border-white/5">
              <td className="py-2 text-slate-400 flex items-center gap-2">
                <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: colors[i] }} />
                {c.category}
              </td>
              <td className="py-2 text-right text-slate-300">${c.standard}M</td>
              <td className="py-2 text-right text-emerald-300">${c.enhanced}M</td>
              <td className="py-2 text-right text-amber-300">${c.savings > 0 ? `-${c.savings}` : c.savings}M</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-3">
        <div className="border border-white/8 rounded-lg p-3">
          <div className="text-[10px] text-slate-600">Cost per Patient (Standard)</div>
          <div className="text-[14px] font-bold text-white">${stdPerPt.toLocaleString()}</div>
        </div>
        <div className="border border-emerald-500/15 bg-emerald-500/3 rounded-lg p-3">
          <div className="text-[10px] text-emerald-400/60">Cost per Patient (Enhanced)</div>
          <div className="text-[14px] font-bold text-emerald-300">${enhPerPt.toLocaleString()}</div>
        </div>
      </div>

      <div className="mt-3 text-[10px] text-slate-600">Sensitivity range: ±12% on all estimates.</div>
    </div>
  );
}

function ProcovaSensitivity({ pr, pctTarget, powerTarget }: { pr: ProcovaResults; pctTarget: string; powerTarget: number }) {
  const grid = pr.sensitivityGrid;
  const rValues = [...new Set(grid.map(g => g.varianceReduction))].sort((a, b) => a - b);
  const ratios = [...new Set(grid.map(g => g.ratio))];

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-2">Sensitivity Analysis — Sample Size & Power</h3>
      <p className="text-[10px] text-slate-500 mb-4">Each cell shows the total sample size required to achieve ≥{pctTarget}% power. Green = viable, red = power drops below threshold.</p>

      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-2 px-2 text-slate-500 font-medium">Var. Reduction</th>
              {ratios.map(r => (
                <th key={r} className="text-center py-2 px-2 text-slate-400 font-medium">{r}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rValues.map(rv => (
              <tr key={rv} className="border-b border-white/5">
                <td className="py-1.5 px-2 text-slate-400 font-medium">{(rv * 100).toFixed(0)}%</td>
                {ratios.map(rat => {
                  const cell = grid.find(g => g.varianceReduction === rv && g.ratio === rat);
                  if (!cell) return <td key={rat} className="py-1.5 px-2 text-center text-slate-600">—</td>;
                  const isCurrentConfig = Math.abs(rv - pr.varianceReductionApplied) < 0.01 && rat === pr.ratioLabel;
                  return (
                    <td key={rat} className={`py-1.5 px-2 text-center ${isCurrentConfig ? "ring-1 ring-emerald-500/50 rounded" : ""}`}>
                      <div className={`rounded px-1.5 py-1 ${cell.viable ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
                        <div className="font-bold">{cell.sampleSize}</div>
                        <div className="text-[8px] opacity-60">{(cell.power * 100).toFixed(0)}% · C={cell.controlArm}</div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-4 text-[10px] text-slate-500">
        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-emerald-500/10 border border-emerald-500/20" />≥{pctTarget}% power</div>
        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-red-500/10 border border-red-500/20" />&lt;{pctTarget}% power</div>
        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded ring-1 ring-emerald-500/50" />Current config</div>
      </div>
    </div>
  );
}

function ProcovaRegulatory() {
  const sections = [
    {
      title: "European Medicines Agency (EMA)",
      status: "Qualified",
      statusColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
      detail: "Qualified via formal Qualification Opinion (September 2022) for continuous endpoints in Phase 2/3 trials. Applicable to ADAS-Cog, EDSS, ALSFRS-R, and similar continuous outcome measures.",
    },
    {
      title: "U.S. FDA (CDER)",
      status: "Aligned",
      statusColor: "text-blue-400 bg-blue-500/10 border-blue-500/20",
      detail: "CDER concurrence that PROCOVA aligns with existing ANCOVA guidance (ICH E9). No separate qualification pathway required; standard pre-specified SAP inclusion is sufficient.",
    },
    {
      title: "ICH E9(R1) — Estimand Framework",
      status: "Compatible",
      statusColor: "text-violet-400 bg-violet-500/10 border-violet-500/20",
      detail: "PROCOVA does not alter the estimand; it improves precision of the same treatment effect estimate. Fully compatible with the addendum on estimands and sensitivity analysis.",
    },
    {
      title: "Limitations",
      status: "Note",
      statusColor: "text-amber-400 bg-amber-500/10 border-amber-500/20",
      detail: "EMA qualification currently covers continuous endpoints only. Time-to-event (PFS, OS) and binary endpoints (response rate) require PROCOVA extensions (PROCOVA-MMRM, logistic PROCOVA) that are under active development but not yet formally qualified.",
    },
  ];

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5 space-y-4">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-2">Regulatory Guidance — Prognostic Covariate Adjustment</h3>

      {sections.map(s => (
        <div key={s.title} className="border border-white/5 rounded-lg p-3.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-white">{s.title}</span>
            <Badge className={`text-[9px] border ${s.statusColor}`}>{s.status}</Badge>
          </div>
          <p className="text-[10px] text-slate-400 leading-relaxed">{s.detail}</p>
        </div>
      ))}

      <div className="p-3 rounded-lg bg-white/3 border border-white/5 text-[9px] text-slate-600 leading-relaxed space-y-1">
        <div className="font-semibold text-slate-500 mb-1">References</div>
        <div>EMA. Qualification Opinion on Prognostic Covariate Adjustment (PROCOVA). EMA/CHMP/QWP, Sep 2022.</div>
        <div>FDA CDER. Comments on PROCOVA methodology alignment with ICH E9 guidance. 2023.</div>
        <div>ICH E9(R1). Addendum on Estimands and Sensitivity Analysis in Clinical Trials. 2019.</div>
        <div>Walsh, J.R. et al. PROCOVA-MMRM for Digital Twins. arXiv:2404.17576, 2024.</div>
      </div>
    </div>
  );
}

// ── Layer 3 Results ───────────────────────────────────────────────────
function Layer3Results({ trialResults: tr, cohortResults: cr, indication, simResults: sr, aiReport: l3Rep, aiLoading: l3Load, aiError: l3Err, aiStream: l3Strm, onRunAi: runL3, safetyFlags: sf3, flagsAcknowledged: fa3, onAcknowledgeFlags: oaf3 }: {
  trialResults: TrialResults | null;
  cohortResults: CohortResults | null;
  indication: string;
  simResults: SimResults | null;
  aiReport: Record<string, unknown> | null;
  aiLoading: boolean;
  aiError: string | null;
  aiStream: string;
  onRunAi: () => void;
  safetyFlags?: SafetyFlag[];
  flagsAcknowledged?: boolean;
  onAcknowledgeFlags?: () => void;
}) {
  const [activeTab, setActiveTab] = useState("success");

  const stats = [
    {
      label: "Trial Success Probability",
      val:   tr ? `${(tr.successProbability * 100).toFixed(1)}%` : "72.4%",
      sub:   tr ? `${tr.goNogo} · p=${tr.pValue.toFixed(3)}` : "95% CI: 64.1–80.7%",
      color: "emerald",
    },
    {
      label: "Optimal Sample Size",
      val:   tr ? String(tr.sampleSize) : "248",
      sub:   tr ? `for ${(tr.power * 100).toFixed(0)}% power at α=0.05` : "for 80% power at α=0.05",
      color: "emerald",
    },
    {
      label: "Projected Duration",
      val:   tr ? `${tr.estimatedDuration} months` : "34 months",
      sub:   "enrollment + follow-up",
      color: "blue",
    },
    {
      label: "Estimated Cost",
      val:   tr ? `$${tr.estimatedCost.toFixed(1)}M` : "$24.7M",
      sub:   tr ? `±$${(tr.estimatedCost * 0.12).toFixed(1)}M sensitivity range` : "±$3.0M sensitivity range",
      color: "amber",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Success Banner */}
      <div className="grid grid-cols-4 gap-3">
        {stats.map(({ label, val, sub, color }) => (
          <div key={label} className={`rounded-xl border p-4 ${color === "emerald" ? "border-emerald-500/20 bg-emerald-500/5" : color === "blue" ? "border-blue-500/20 bg-blue-500/5" : "border-amber-500/20 bg-amber-500/5"}`}>
            <div className="text-[10px] text-slate-500 mb-1">{label}</div>
            <div className={`text-[16px] font-bold ${color === "emerald" ? "text-emerald-300" : color === "blue" ? "text-blue-300" : "text-amber-300"}`}>{val}</div>
            <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 bg-white/5 p-1 rounded-lg">
        {[
          { id: "success",     label: "Success Prob.", icon: Target    },
          { id: "enrollment",  label: "Enrollment",    icon: TrendingUp },
          { id: "power",       label: "Power Curve",   icon: BarChart3  },
          { id: "balance",     label: "Balance Report",icon: Activity   },
          { id: "sites",       label: "Site Ranking",  icon: Map        },
          { id: "cost",        label: "Cost",          icon: Database   },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[10px] font-medium transition-all ${
              activeTab === id ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "success"     && <SuccessProbGauge    tr={tr} />}
      {activeTab === "enrollment"  && <EnrollmentChart     tr={tr} />}
      {activeTab === "power"       && <PowerCurve          tr={tr} />}
      {activeTab === "balance"     && <BalanceReport       cr={cr} />}
      {activeTab === "sites"       && <SiteRanking         tr={tr} />}
      {activeTab === "cost"        && <CostSummary         tr={tr} />}

      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" className="border-white/10 text-slate-400 hover:text-white text-[11px] gap-1.5">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </Button>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] gap-1.5">
          <FileText className="w-3.5 h-3.5" /> Generate Full Report
        </Button>
      </div>

      <RegulatoryInsightCard layer={3} indication={indication} trialResults={tr} similarDrugs={sr?.similarDrugs} />
      <SimulationDataSources layer={3} simResults={sr} />
      <LayerAiPanel
        layer={3}
        report={l3Rep}
        loading={l3Load}
        error={l3Err}
        stream={l3Strm}
        onRun={runL3}
        simResults={sr}
        cohortResults={cr}
        trialResults={tr}
        safetyFlags={sf3}
        flagsAcknowledged={fa3}
        onAcknowledgeFlags={oaf3}
      />
    </div>
  );
}


function SuccessProbGauge({ tr }: { tr: TrialResults | null }) {
  const prob = tr ? parseFloat((tr.successProbability * 100).toFixed(1)) : 72.4;

  // stroke-dasharray gauge — far more reliable than SVG arc path maths
  const cx = 110, cy = 105, r = 76;
  const circ = 2 * Math.PI * r;         // full circle circumference
  const trackLen = circ * 0.75;          // 270° track
  const segLen = trackLen / 3;           // each coloured zone = 90°
  const fillLen = (prob / 100) * trackLen;
  const color = prob < 50 ? "#ef4444" : prob < 70 ? "#eab308" : "#22c55e";

  // rotate-origin so the track starts at 8-o'clock (225° from 12 = 135° from 3 o'clock)
  const rot = `rotate(135 ${cx} ${cy})`;

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">Trial Success Probability</h3>
      <div className="flex gap-8 items-center">
        <div className="relative">
          <svg width="220" height="155">
            {/* background track: red / yellow / green zones */}
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#ef444430" strokeWidth="13" strokeLinecap="butt"
              strokeDasharray={`${segLen} ${circ - segLen}`} transform={rot} />
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eab30830" strokeWidth="13" strokeLinecap="butt"
              strokeDasharray={`${segLen} ${circ - segLen}`}
              strokeDashoffset={-segLen} transform={rot} />
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#22c55e30" strokeWidth="13" strokeLinecap="butt"
              strokeDasharray={`${segLen} ${circ - segLen}`}
              strokeDashoffset={-segLen * 2} transform={rot} />

            {/* coloured fill arc — dasharray shrinks/grows with prob */}
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="13" strokeLinecap="round"
              strokeDasharray={`${fillLen} ${circ - fillLen}`} transform={rot}
              style={{ transition: "stroke-dasharray 0.4s ease, stroke 0.4s ease" }} />

            {/* centre text */}
            <text x={cx} y={cy - 8} fill="white" fontSize="30" textAnchor="middle" fontWeight="800">{prob}%</text>
            <text x={cx} y={cy + 14} fill={color} fontSize="10" textAnchor="middle" fontWeight="700" letterSpacing="0.05em">
              {prob >= 70 ? "HIGH CONFIDENCE" : prob >= 50 ? "MODERATE" : "LOW"}
            </text>

            {/* zone labels */}
            <text x="14"  y="150" fill="#ef4444" fontSize="9">&lt;50%</text>
            <text x="80"  y="153" fill="#eab308" fontSize="9">50–70%</text>
            <text x="162" y="150" fill="#22c55e" fontSize="9">&gt;70%</text>
          </svg>
        </div>

        <div className="flex-1 space-y-3">
          <div className="text-[11px] text-slate-500 mb-2">Key Risk Factors</div>
          {[
            { factor: "Statistical Power",     val: tr ? `${(tr.power * 100).toFixed(1)}%` : "80.2%", status: (tr?.power ?? 0.8) >= 0.8 ? "pass" : "warn" },
            { factor: "Enrollment Feasibility",val: "High",     status: "pass" },
            { factor: "Dropout Risk",          val: "Medium",   status: "warn" },
            { factor: "Site Quality",          val: tr ? (tr.siteRecommendations[0]?.quality ?? 9.2).toFixed(1) + "/10" : "9.2/10", status: "pass" },
            { factor: "Regulatory Pathway",    val: "Standard", status: "pass" },
          ].map(({ factor, val, status }) => (
            <div key={factor} className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">{factor}</span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-300">{val}</span>
                {status === "pass" ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EnrollmentChart({ tr }: { tr: TrialResults | null }) {
  const months = Array.from({ length: 25 }, (_, i) => i);
  const target = tr?.sampleSize ?? 248;
  const expected    = months.map(m => Math.min(target, Math.round(target * (1 - Math.exp(-0.15 * m)))));
  const optimistic  = months.map(m => Math.min(target, Math.round(target * (1 - Math.exp(-0.20 * m)))));
  const pessimistic = months.map(m => Math.min(target, Math.round(target * (1 - Math.exp(-0.10 * m)))));

  const xS = (m: number) => 40 + (m / 24) * 460;
  const yS = (v: number) => 180 - (v / target) * 160;

  const ciArea = `${optimistic.map((v, i) => `${i === 0 ? "M" : "L"}${xS(i)},${yS(v)}`).join(" ")} ${pessimistic.slice().reverse().map((v, i) => `L${xS(24 - i)},${yS(v)}`).join(" ")} Z`;

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-2">Enrollment Trajectory</h3>
      <svg width="100%" height="210" viewBox="0 0 520 210">
        {[0, 62, 124, 186, 248].map((v, i) => (
          <g key={i}>
            <line x1="40" y1={yS(v)} x2="500" y2={yS(v)} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
            <text x="36" y={yS(v) + 4} fill="#4b5563" fontSize="9" textAnchor="end">{v}</text>
          </g>
        ))}
        {[0, 6, 12, 18, 24].map(m => (
          <text key={m} x={xS(m)} y="200" fill="#4b5563" fontSize="9" textAnchor="middle">M{m}</text>
        ))}

        <line x1="40" y1={yS(target)} x2="500" y2={yS(target)} stroke="#22c55e" strokeWidth="1" strokeDasharray="6,3" opacity="0.4" />
        <text x="504" y={yS(target) + 4} fill="#22c55e" fontSize="8">Target</text>

        <path d={ciArea} fill="rgba(59,130,246,0.08)" />
        <polyline points={optimistic.map((v, i) => `${xS(i)},${yS(v)}`).join(" ")} fill="none" stroke="#3b82f6" strokeWidth="1" strokeDasharray="4,3" opacity="0.5" />
        <polyline points={pessimistic.map((v, i) => `${xS(i)},${yS(v)}`).join(" ")} fill="none" stroke="#3b82f6" strokeWidth="1" strokeDasharray="4,3" opacity="0.5" />
        <polyline points={expected.map((v, i) => `${xS(i)},${yS(v)}`).join(" ")} fill="none" stroke="#3b82f6" strokeWidth="2.5" />
      </svg>
      <div className="flex gap-4 text-[10px] text-slate-500 mt-1">
        <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-blue-500" />Expected</div>
        <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-blue-500 opacity-40" style={{borderTop:"1px dashed #3b82f6"}} />95% CI</div>
        <div className="flex items-center gap-1.5"><div className="w-5 h-0.5 bg-emerald-500 opacity-50" style={{borderTop:"1px dashed #22c55e"}} />Target</div>
      </div>
    </div>
  );
}

function PowerCurve({ tr }: { tr: TrialResults | null }) {
  const pcData  = tr?.powerCurve ?? [];
  const samples = pcData.length ? pcData.map(p => p.n)     : [50, 100, 150, 200, 248, 300, 400, 500];
  const powers  = pcData.length ? pcData.map(p => p.power) : samples.map(n => 1 - Math.exp(-0.0032 * n));
  const optN    = tr?.sampleSize ?? 248;
  const optIdx  = samples.reduce((bi, n, i) => Math.abs(n - optN) < Math.abs(samples[bi] - optN) ? i : bi, 0);

  const xS = (i: number) => 40 + i * (480 / (samples.length - 1));
  const yS = (v: number) => 180 - v * 160;

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-2">Power Curve</h3>
      <svg width="100%" height="210" viewBox="0 0 540 210">
        {[0.6, 0.7, 0.8, 0.9, 1.0].map((v, i) => (
          <g key={i}>
            <line x1="40" y1={yS(v)} x2="520" y2={yS(v)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            <text x="36" y={yS(v) + 4} fill="#4b5563" fontSize="9" textAnchor="end">{(v * 100).toFixed(0)}%</text>
          </g>
        ))}
        {samples.map((s, i) => (
          <text key={s} x={xS(i)} y="200" fill="#4b5563" fontSize="9" textAnchor="middle">{s}</text>
        ))}
        <line x1="40" y1={yS(0.80)} x2="520" y2={yS(0.80)} stroke="#eab308" strokeWidth="1" strokeDasharray="5,3" opacity="0.5" />
        <text x="524" y={yS(0.80) + 4} fill="#eab308" fontSize="8">80%</text>
        <polyline points={powers.map((v, i) => `${xS(i)},${yS(v)}`).join(" ")} fill="none" stroke="#22c55e" strokeWidth="2.5" />
        <line x1={xS(optIdx)} y1="0" x2={xS(optIdx)} y2={yS(powers[optIdx])} stroke="#22c55e" strokeWidth="1" strokeDasharray="4,3" opacity="0.6" />
        <circle cx={xS(optIdx)} cy={yS(powers[optIdx])} r="5" fill="#22c55e" />
        <text x={xS(optIdx)} y={yS(powers[optIdx]) - 10} fill="#22c55e" fontSize="9" textAnchor="middle">n={optN}</text>
        <text x="18" y="120" fill="#6b7280" fontSize="9" transform="rotate(-90 18 120)">Power (1-β)</text>
        <text x="280" y="212" fill="#6b7280" fontSize="9" textAnchor="middle">Sample Size</text>
      </svg>
    </div>
  );
}

function BalanceReport({ cr }: { cr: CohortResults | null }) {
  const covariates = [
    { var: "Age (years)", treat: 58.4, ctrl: 57.9, smd: 0.04, pass: true },
    { var: "Sex (% male)", treat: 52.3, ctrl: 51.8, smd: 0.02, pass: true },
    { var: "Disease Stage", treat: 2.8, ctrl: 2.9, smd: 0.08, pass: true },
    { var: "ECOG Score", treat: 1.2, ctrl: 1.3, smd: 0.07, pass: true },
    { var: "BMI", treat: 26.4, ctrl: 26.8, smd: 0.05, pass: true },
    { var: "eGFR", treat: 84.2, ctrl: 80.1, smd: 0.13, pass: false },
    { var: "Prior Lines Tx", treat: 1.8, ctrl: 1.6, smd: 0.11, pass: true },
  ];

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">Synthetic Arm Balance Report <span className="text-[10px] text-slate-600 font-normal">(SMD threshold: 0.10)</span></h3>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-white/8">
            {["Variable","Treatment","Control","SMD","Status"].map(h => (
              <th key={h} className="text-left py-2 pr-4 text-slate-500 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {covariates.map(c => (
            <tr key={c.var} className={`border-b border-white/5 ${!c.pass ? "bg-red-500/3" : ""}`}>
              <td className="py-2 pr-4 text-slate-300">{c.var}</td>
              <td className="py-2 pr-4 text-slate-400">{c.treat}</td>
              <td className="py-2 pr-4 text-slate-400">{c.ctrl}</td>
              <td className="py-2 pr-4">
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${c.smd > 0.10 ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(c.smd / 0.25, 1) * 100}%` }} />
                  </div>
                  <span className={c.smd > 0.10 ? "text-red-400" : "text-emerald-400"}>{c.smd.toFixed(2)}</span>
                </div>
              </td>
              <td className="py-2 pr-4">
                {c.pass
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  : <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="mt-3 text-[11px] text-violet-400 hover:text-violet-300 flex items-center gap-1.5 border border-violet-500/25 rounded-md px-3 py-1.5 hover:border-violet-500/40">
        <RefreshCw className="w-3 h-3" /> Re-run Matching with Adjusted Parameters
      </button>
    </div>
  );
}

function SiteRanking({ tr }: { tr: TrialResults | null }) {
  const sites = tr
    ? tr.siteRecommendations.slice(0, 5).map((s, i) => ({
        rank: i + 1, site: s.site, region: s.region,
        enrollment: parseFloat(s.enrollPerMonth.toFixed(1)),
        quality: parseFloat(s.quality.toFixed(1)),
        composite: Math.round(s.composite * 100),
      }))
    : [
        { rank: 1, site: "Johns Hopkins, Baltimore", region: "North America", enrollment: 4.2, quality: 9.2, composite: 91 },
        { rank: 2, site: "Royal Marsden, London",    region: "Europe",        enrollment: 3.8, quality: 9.4, composite: 88 },
        { rank: 3, site: "MD Anderson, Houston",     region: "North America", enrollment: 3.9, quality: 8.9, composite: 86 },
        { rank: 4, site: "Memorial Sloan Kettering", region: "North America", enrollment: 3.5, quality: 9.1, composite: 84 },
        { rank: 5, site: "Tokyo Medical Univ.",      region: "Asia-Pacific",  enrollment: 3.3, quality: 8.7, composite: 79 },
      ];

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">Site Ranking Table</h3>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-white/8">
            {["#","Site","Region","Enrollment/mo","Quality Score","Composite"].map(h => (
              <th key={h} className="text-left py-2 pr-4 text-slate-500 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sites.map(s => (
            <tr key={s.rank} className="border-b border-white/5 hover:bg-white/3 cursor-pointer">
              <td className="py-2 pr-4 font-bold text-slate-500">{s.rank}</td>
              <td className="py-2 pr-4 text-slate-300">{s.site}</td>
              <td className="py-2 pr-4"><Badge className="text-[9px] bg-white/5 text-slate-500">{s.region}</Badge></td>
              <td className="py-2 pr-4 text-blue-400 font-medium">{s.enrollment}</td>
              <td className="py-2 pr-4 text-emerald-400 font-medium">{s.quality}/10</td>
              <td className="py-2 pr-4">
                <div className="flex items-center gap-2">
                  <div className="w-12 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${s.composite}%` }} />
                  </div>
                  <span className="text-emerald-300 font-semibold">{s.composite}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CostSummary({ tr }: { tr: TrialResults | null }) {
  const totalM   = tr ? tr.estimatedCost : 24.7;
  const n        = tr ? tr.sampleSize    : 240;
  const sites    = tr ? tr.numSites      : 20;
  const loM      = parseFloat((totalM * 0.88).toFixed(1));
  const hiM      = parseFloat((totalM * 1.12).toFixed(1));
  const categories = [
    { label: "Site Operations",     pct: 42, color: "#8b5cf6" },
    { label: "Drug Supply",         pct: 28, color: "#3b82f6" },
    { label: "Clinical Monitoring", pct: 20, color: "#06b6d4" },
    { label: "Lab & Biomarker",     pct: 10, color: "#22c55e" },
  ].map(c => ({ ...c, amount: parseFloat((totalM * c.pct / 100).toFixed(1)) }));
  const perPatient = n > 0 ? Math.round((totalM * 1_000_000) / n) : 0;
  const perSite    = sites > 0 ? parseFloat((totalM / sites).toFixed(2)) : 0;

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">Cost Estimate Summary</h3>
      <div className="flex gap-6 items-start">
        <div className="flex-1">
          <div className="text-[28px] font-bold text-white mb-0.5">${totalM.toFixed(1)}M</div>
          <div className="text-[11px] text-slate-500">Total estimated cost · USD</div>
          <div className="text-[11px] text-slate-600 mt-1">Sensitivity range: ${loM}M–${hiM}M</div>

          <div className="mt-4 space-y-2.5">
            {categories.map(c => (
              <div key={c.label}>
                <div className="flex justify-between text-[11px] mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: c.color }} />
                    <span className="text-slate-400">{c.label}</span>
                  </div>
                  <span className="text-slate-300 font-medium">${c.amount}M</span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${c.pct}%`, backgroundColor: c.color, opacity: 0.7 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-right space-y-2">
          <div className="border border-white/8 rounded-lg p-3 text-right">
            <div className="text-[10px] text-slate-600">Cost per Patient</div>
            <div className="text-[16px] font-bold text-white mt-0.5">${perPatient.toLocaleString()}</div>
          </div>
          <div className="border border-white/8 rounded-lg p-3 text-right">
            <div className="text-[10px] text-slate-600">Cost per Site</div>
            <div className="text-[16px] font-bold text-white mt-0.5">${perSite.toFixed(2)}M</div>
          </div>
          <div className="flex gap-1 mt-3 justify-end">
            {["USD","EUR","JPY"].map(c => (
              <button key={c} className={`text-[10px] px-2 py-1 rounded border ${c === "USD" ? "border-violet-500/40 bg-violet-500/10 text-violet-300" : "border-white/10 text-slate-500"}`}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 4 — First In Human Handover Panel (NEW · May 2026 restructure)
// Read-only synthesis of L3 Animal Cohort outputs into Phase-1 design seeds.
// MABEL starting dose follows ICH-S9/EMA guidance: 1/10 HED with safety factor.
// All numbers are derived from the animalResults already in the page state —
// no fabricated data, no commercial IND service calls.
// ─────────────────────────────────────────────────────────────────────────────
function FirstInHumanPanel({
  hasL3,
  animalResults,
  simResults,
  molName,
  onSendBack,
}: {
  hasL3: boolean;
  animalResults: any;
  simResults: any;
  molName: string;
  onSendBack: () => void;
}) {
  if (!hasL3 || !animalResults) {
    return (
      <div className="flex-1 flex items-center justify-center p-12">
        <div className="max-w-md text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto">
            <Activity className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-[16px] font-semibold text-white">Layer 4 — First In Human</h2>
          <p className="text-[12px] text-slate-500 leading-relaxed">
            FIH handover requires a completed L3 Animal Cohort package. Run
            the L3 simulation first to derive MABEL, NOAEL, and HED inputs
            for Phase-1 design seeds.
          </p>
          <button
            onClick={onSendBack}
            className="px-4 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-200 text-[12px] font-medium hover:bg-emerald-600/30"
          >
            Go to L3 Animal Cohort
          </button>
        </div>
      </div>
    );
  }

  // Derived FIH numbers from animalResults (real data).
  const noael = Number(animalResults?.noael ?? 0);
  const fihMgKg = Number(animalResults?.fihDoseMgKg ?? 0);
  const humanAuc = Number(animalResults?.humanAuc ?? 0);
  const overallRisk = String(animalResults?.overallRisk ?? "moderate");
  const startingDoseMg = (fihMgKg * 70).toFixed(2); // 70 kg adult assumption
  const mabelMg = (fihMgKg * 70 * 0.1).toFixed(3); // 1/10 safety factor
  const escalationSteps = ["1× MABEL", "2×", "5×", "10×", "20×", "MTD probe"];

  const indReadiness: { label: string; ready: boolean; note: string }[] = [
    { label: "Pivotal tox (rodent + non-rodent)", ready: !!animalResults, note: "L3 ICH M3(R2) battery output" },
    { label: "PK / PBPK package", ready: humanAuc > 0, note: "Human AUC projected via allometric scaling" },
    { label: "Safety pharmacology", ready: overallRisk !== "high", note: overallRisk === "high" ? "High-risk gate — investigator review" : "Within acceptable range" },
    { label: "CMC / Phase-1 supply", ready: false, note: "Out of scope for HakaseAI — manual upload required" },
    { label: "Investigator brochure draft", ready: false, note: "Generated downstream from this handover" },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-[#07080c]">
      {/* Header */}
      <div className="border-b border-white/8 bg-emerald-950/15 px-6 py-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
          <Activity className="w-4 h-4 text-emerald-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-emerald-300 uppercase tracking-widest">Layer 4</span>
            <h2 className="text-[15px] font-semibold text-white">First In Human Handover</h2>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {molName} · MABEL-derived starting dose · IND-gate readiness · handoff to Hakase Clinical (Phase 1 planner)
          </p>
        </div>
        <button
          onClick={onSendBack}
          className="text-[11px] px-3 py-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/5"
        >
          ← Send back to L3
        </button>
      </div>

      <div className="p-6 grid grid-cols-12 gap-4 max-w-[1400px]">
        {/* Phase-1 dose seeds */}
        <div className="col-span-12 lg:col-span-7 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Syringe className="w-4 h-4 text-emerald-300" />
            <h3 className="text-[13px] font-semibold text-white">Phase-1 dose seeds (MABEL)</h3>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-white/8 bg-black/30 p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider">FIH (mg/kg)</div>
              <div className="text-[18px] font-bold text-white mt-1">{fihMgKg.toFixed(3)}</div>
              <div className="text-[10px] text-slate-500 mt-1">1/10 HED, conservative</div>
            </div>
            <div className="rounded-lg border border-white/8 bg-black/30 p-3">
              <div className="text-[9px] text-slate-500 uppercase tracking-wider">Starting (70 kg)</div>
              <div className="text-[18px] font-bold text-white mt-1">{startingDoseMg} mg</div>
              <div className="text-[10px] text-slate-500 mt-1">Adult reference body weight</div>
            </div>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <div className="text-[9px] text-emerald-300 uppercase tracking-wider">MABEL</div>
              <div className="text-[18px] font-bold text-emerald-200 mt-1">{mabelMg} mg</div>
              <div className="text-[10px] text-emerald-300/70 mt-1">1/10 safety factor on FIH</div>
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Proposed escalation scheme</div>
            <div className="flex items-center gap-1 flex-wrap">
              {escalationSteps.map((step, i) => (
                <div key={step} className="flex items-center gap-1">
                  <div className={`px-2.5 py-1 rounded-md text-[10px] font-medium border ${
                    i === 0
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-200"
                      : "bg-white/5 border-white/10 text-slate-400"
                  }`}>
                    {step}
                  </div>
                  {i < escalationSteps.length - 1 && <ChevronRight className="w-3 h-3 text-slate-600" />}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
              Modified Fibonacci escalation; SRC review between cohorts; halt on DLT &gt; 33% within cohort.
            </p>
          </div>
        </div>

        {/* L3 → L4 cascade */}
        <div className="col-span-12 lg:col-span-5 rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
          <div className="flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-emerald-300" />
            <h3 className="text-[13px] font-semibold text-white">L3 → L4 cascade</h3>
          </div>
          <div className="space-y-2 text-[11px]">
            <CascadeRow label="NOAEL (animal)" value={`${noael.toFixed(2)} mg/kg/day`} />
            <CascadeRow label="HED (allometric)" value={`${(noael / 6.2).toFixed(3)} mg/kg`} />
            <CascadeRow label="Projected human AUC" value={humanAuc > 0 ? `${humanAuc.toFixed(1)} ng·h/mL` : "—"} />
            <CascadeRow label="L3 overall risk" value={overallRisk} valueClass={
              overallRisk === "high" ? "text-rose-300" : overallRisk === "low" ? "text-emerald-300" : "text-amber-300"
            } />
            <CascadeRow label="Compound" value={molName} />
          </div>
        </div>

        {/* IND readiness */}
        <div className="col-span-12 rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Stamp className="w-4 h-4 text-emerald-300" />
            <h3 className="text-[13px] font-semibold text-white">IND-gate readiness</h3>
            <span className="ml-auto text-[10px] text-slate-500">
              {indReadiness.filter(r => r.ready).length} / {indReadiness.length} ready
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {indReadiness.map(item => (
              <div key={item.label} className="flex items-start gap-3 p-3 rounded-lg border border-white/8 bg-black/20">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  item.ready ? "bg-emerald-500/15 border border-emerald-500/40" : "bg-amber-500/10 border border-amber-500/30"
                }`}>
                  {item.ready
                    ? <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                    : <Clock className="w-3 h-3 text-amber-300" />}
                </div>
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-white">{item.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{item.note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Handover */}
        <div className="col-span-12 rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/8 to-cyan-500/5 p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <DoorOpen className="w-5 h-5 text-emerald-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[13px] font-semibold text-white">Handoff to Hakase Clinical (Phase 1 planner)</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              The FIH package above (MABEL, escalation, IND readiness, L3 cascade) is the contract input to the Phase 1–4
              planner. Cross-product API wiring is staged separately.
            </p>
          </div>
          <button
            disabled
            className="px-4 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-200/60 text-[12px] font-medium cursor-not-allowed flex items-center gap-2"
            title="API wiring to Hakase Clinical is staged as a follow-up"
          >
            <Wrench className="w-3.5 h-3.5" /> Send to Phase 1 planner
          </button>
        </div>
      </div>
    </div>
  );
}

function CascadeRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-white/5 last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono ${valueClass ?? "text-white"}`}>{value}</span>
    </div>
  );
}
