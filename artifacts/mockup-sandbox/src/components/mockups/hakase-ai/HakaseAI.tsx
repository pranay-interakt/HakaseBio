import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { MolViewer3D_Cinematic } from "./MolViewer3D_Cinematic";
import { MolViewer3D_Scientific } from "./MolViewer3D_Scientific";
import { MolViewer3D_Explorer } from "./MolViewer3D_Explorer";
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
  Microscope, Dna, HeartPulse, Brain, Layers, LayoutDashboard, Bell,
  Search, Menu, X, Filter, RefreshCw, Eye, Lock, Maximize2, Box, Globe
} from "lucide-react";

type Layer = 1 | 2 | 3;
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
  const [activeLayer, setActiveLayer] = useState<Layer>(1);
  const [simStatus, setSimStatus] = useState<Record<Layer, SimulationStatus>>({
    1: "idle",
    2: "idle",
    3: "idle",
  });
  const [simProgress, setSimProgress] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [viewer3DOpen, setViewer3DOpen] = useState(false);
  const [viewer3DMode, setViewer3DMode] = useState<"cinematic" | "scientific" | "explorer">("cinematic");
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
  const [apiSource, setApiSource] = useState("chembl");
  const [apiCompoundId, setApiCompoundId] = useState("");
  const [apiLoading, setApiLoading] = useState(false);
  const [apiResult, setApiResult] = useState<{ name: string; smiles: string; mw: string } | null>(null);
  const [projImportOpen, setProjImportOpen] = useState(false);
  const [projImportSource, setProjImportSource] = useState("clinicaltrials");
  const [projImportId, setProjImportId] = useState("");
  const [projImportLoading, setProjImportLoading] = useState(false);
  const [projImportResult, setProjImportResult] = useState<{ name: string; indication: string; phase: string; sponsor: string } | null>(null);
  const [savedProjects, setSavedProjects] = useState([
    { name: "CDK4/6 Inhibitor Screen", indication: "Breast Cancer", layers: 3 },
    { name: "EGFR-T790M Mutant", indication: "NSCLC", layers: 2 },
    { name: "KRAS G12C Series", indication: "Colorectal", layers: 1 },
  ]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [pgxOpen, setPgxOpen] = useState(false);
  const [adaptiveOpen, setAdaptiveOpen] = useState(false);
  const [syntheticOpen, setSyntheticOpen] = useState(false);
  const [dropoutOpen, setDropoutOpen] = useState(false);

  // Layer 1 state
  const [smiles, setSmiles] = useState("CC(C)Cc1ccc(cc1)C(C)C(=O)O");
  const [molName, setMolName] = useState("Ibuprofen-Analog-001");
  const [uniprotId, setUniprotId] = useState("P00533");
  const [therapeuticArea, setTherapeuticArea] = useState("Oncology");
  const [admetOn] = useState(true);
  const [bindingOn, setBindingOn] = useState(true);
  const [toxOn, setToxOn] = useState(true);
  const [fingerprintOn, setFingerprintOn] = useState(false);
  const [tissueTypes, setTissueTypes] = useState<string[]>(["Liver", "Kidney", "Cardiac"]);
  const [confidenceThreshold, setConfidenceThreshold] = useState([0.70]);
  const [rankingCriteria, setRankingCriteria] = useState("Composite");
  const [topN, setTopN] = useState("10");
  const [compositeWeights, setCompositeWeights] = useState([0.3, 0.3, 0.3, 0.1]);

  // Layer 2 state
  const [indication, setIndication] = useState("C34.1 – Non-small-cell lung carcinoma");
  const [severity, setSeverity] = useState("Moderate");
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

  const layerComplete = useCallback((layer: Layer) => {
    return simStatus[layer] === "complete";
  }, [simStatus]);

  const runSimulation = useCallback(() => {
    setSimStatus(prev => ({ ...prev, [activeLayer]: "running" }));
    setSimProgress(0);
    const interval = setInterval(() => {
      setSimProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          setSimStatus(prev => ({ ...prev, [activeLayer]: "complete" }));
          return 100;
        }
        return p + Math.random() * 8 + 2;
      });
    }, 200);
  }, [activeLayer]);

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

  const handleProjFetch = useCallback(() => {
    if (!projImportId.trim()) return;
    setProjImportLoading(true);
    setProjImportResult(null);
    const mockDb: Record<string, Record<string, { name: string; indication: string; phase: string; sponsor: string }>> = {
      clinicaltrials: {
        "nct04292899": { name: "Osimertinib NSCLC Study",    indication: "Non-small-cell lung carcinoma", phase: "Phase III", sponsor: "AstraZeneca" },
        "nct03410134": { name: "KRAS G12C Inhibitor AMG510", indication: "Colorectal / NSCLC",          phase: "Phase II", sponsor: "Amgen" },
        "nct02395913": { name: "CDK4/6 + Letrozole HR+ BC",  indication: "Breast Cancer (HR+/HER2-)",   phase: "Phase III", sponsor: "Novartis" },
        "nct01772004": { name: "Pembrolizumab NSCLC",        indication: "Non-small-cell lung carcinoma", phase: "Phase II", sponsor: "Merck" },
        "nct03505866": { name: "BTK Inhibitor CLL Trial",    indication: "Chronic lymphocytic leukemia", phase: "Phase III", sponsor: "AbbVie" },
      },
      ehr: {
        "pat-001": { name: "EGFR-T790M Cohort Study",   indication: "NSCLC",         phase: "Real-World",    sponsor: "Internal EHR" },
        "pat-002": { name: "HER2+ Breast Cohort",        indication: "Breast Cancer", phase: "Real-World",    sponsor: "Internal EHR" },
        "study-007": { name: "GI Toxicity Assessment",  indication: "Colorectal",    phase: "Observational", sponsor: "Site LIMS" },
      },
      lims: {
        "lims-2024-001": { name: "Compound Library Screen A", indication: "Oncology", phase: "Pre-clinical", sponsor: "Internal R&D" },
        "lims-2024-012": { name: "ADMET Panel Q1-2024",       indication: "Multiple",  phase: "Pre-clinical", sponsor: "DMPK Dept." },
      },
      pubmed: {
        "36150754": { name: "Erlotinib Resistance Mechanisms", indication: "NSCLC",        phase: "Literature", sponsor: "Dana-Farber" },
        "34555354": { name: "KRAS G12C Covalent Inhibitors",   indication: "Solid Tumors", phase: "Literature", sponsor: "UCSF / Nature" },
        "33004079": { name: "Osimertinib vs Gefitinib",        indication: "EGFR+ NSCLC",  phase: "Literature", sponsor: "NEJM" },
      },
    };
    setTimeout(() => {
      const sourceDb = mockDb[projImportSource] ?? {};
      const hit = sourceDb[projImportId.toLowerCase().trim()];
      if (hit) {
        setProjImportResult(hit);
      } else {
        setProjImportResult({ name: `Project-${projImportId.toUpperCase()}`, indication: "Oncology", phase: "Phase II", sponsor: "Imported" });
      }
      setProjImportLoading(false);
    }, 800);
  }, [projImportSource, projImportId]);

  const handleApiFetch = useCallback(() => {
    if (!apiCompoundId.trim()) return;
    setApiLoading(true);
    setApiResult(null);
    const mockDb: Record<string, Record<string, { name: string; smiles: string; mw: string }>> = {
      chembl: {
        "chembl25":      { name: "Aspirin",    smiles: "CC(=O)Oc1ccccc1C(=O)O",                          mw: "180.2 Da" },
        "chembl521":     { name: "Ibuprofen",  smiles: "CC(C)Cc1ccc(cc1)C(C)C(=O)O",                     mw: "206.3 Da" },
        "chembl255863":  { name: "Gefitinib",  smiles: "COc1cc2ncnc(Nc3cccc(F)c3)c2cc1OCCCN1CCOCC1",      mw: "446.9 Da" },
        "chembl1201328": { name: "Erlotinib",  smiles: "C#Cc1cccc(Nc2ncnc3cc(OCCO)c(OCCO)cc23)c1",        mw: "393.4 Da" },
        "chembl941":     { name: "Osimertinib",smiles: "CN(C)CCNc1nc(Nc2cccc(c2)C(F)(F)F)c3cc(OC)c(NC(=O)/C=C/CN(C)C)cc3n1", mw: "499.6 Da" },
      },
      pubchem: {
        "2244":   { name: "Aspirin",    smiles: "CC(=O)Oc1ccccc1C(=O)O",                        mw: "180.2 Da" },
        "3672":   { name: "Ibuprofen",  smiles: "CC(C)Cc1ccc(cc1)C(C)C(=O)O",                   mw: "206.3 Da" },
        "176870": { name: "Erlotinib",  smiles: "C#Cc1cccc(Nc2ncnc3cc(OCCO)c(OCCO)cc23)c1",      mw: "393.4 Da" },
        "123631": { name: "Gefitinib",  smiles: "COc1cc2ncnc(Nc3cccc(F)c3)c2cc1OCCCN1CCOCC1",    mw: "446.9 Da" },
        "5291":   { name: "Metformin",  smiles: "CN(C)C(=N)NC(N)=N",                             mw: "129.2 Da" },
      },
      drugbank: {
        "db00945": { name: "Aspirin",    smiles: "CC(=O)Oc1ccccc1C(=O)O",                        mw: "180.2 Da" },
        "db01050": { name: "Ibuprofen",  smiles: "CC(C)Cc1ccc(cc1)C(C)C(=O)O",                   mw: "206.3 Da" },
        "db00530": { name: "Erlotinib",  smiles: "C#Cc1cccc(Nc2ncnc3cc(OCCO)c(OCCO)cc23)c1",      mw: "393.4 Da" },
        "db00619": { name: "Imatinib",   smiles: "Cc1ccc(NC(=O)c2ccc(CN3CCN(CC3)C)cc2)cc1Nc1nccc(n1)-c1cccnc1", mw: "493.6 Da" },
        "db00317": { name: "Gefitinib",  smiles: "COc1cc2ncnc(Nc3cccc(F)c3)c2cc1OCCCN1CCOCC1",   mw: "446.9 Da" },
      },
      unichem: {
        "uci1": { name: "Aspirin",    smiles: "CC(=O)Oc1ccccc1C(=O)O",                           mw: "180.2 Da" },
        "uci2": { name: "Ibuprofen",  smiles: "CC(C)Cc1ccc(cc1)C(C)C(=O)O",                      mw: "206.3 Da" },
        "uci3": { name: "Erlotinib",  smiles: "C#Cc1cccc(Nc2ncnc3cc(OCCO)c(OCCO)cc23)c1",         mw: "393.4 Da" },
      },
      zinc: {
        "zinc000003594435": { name: "Ibuprofen",  smiles: "CC(C)Cc1ccc(cc1)C(C)C(=O)O",          mw: "206.3 Da" },
        "zinc000001530689": { name: "Aspirin",    smiles: "CC(=O)Oc1ccccc1C(=O)O",               mw: "180.2 Da" },
        "zinc000019632618": { name: "Erlotinib",  smiles: "C#Cc1cccc(Nc2ncnc3cc(OCCO)c(OCCO)cc23)c1", mw: "393.4 Da" },
      },
    };
    setTimeout(() => {
      const sourceDb = mockDb[apiSource] ?? {};
      const hit = sourceDb[apiCompoundId.toLowerCase().trim()];
      if (hit) {
        setApiResult(hit);
      } else {
        setApiResult({ name: `Compound-${apiCompoundId.toUpperCase()}`, smiles: "CC(C)Cc1ccc(cc1)C(C)C(=O)O", mw: "206.3 Da" });
      }
      setApiLoading(false);
    }, 900);
  }, [apiSource, apiCompoundId]);

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

  const layerIcons = [FlaskConical, Users, Beaker] as const;
  const layerLabels: string[] = ["Molecular", "Cohort", "Trial"];
  const layerColors = ["violet", "blue", "green"] as const;

  return (
    <div className="h-screen bg-[#07080c] text-white flex flex-col overflow-hidden font-['Inter']" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-white/8 bg-[#0d0f17]/90 backdrop-blur-md flex items-center px-4 gap-4 shrink-0 z-50">
        {/* Logo */}
        <div className="flex items-center gap-2.5 min-w-[160px]">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center">
            <Dna className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-[15px] tracking-tight">
            Hakase<span className="text-violet-400">AI</span>
          </span>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-violet-500/40 text-violet-400 ml-0.5">
            v1.0
          </Badge>
        </div>

        {/* Layer Stepper */}
        <div className="flex items-center gap-1 mx-auto">
          {([1, 2, 3] as Layer[]).map((layer, i) => {
            const Icon = layerIcons[i];
            const status = getLayerStatus(layer);
            const isActive = activeLayer === layer;
            return (
              <div key={layer} className="flex items-center">
                <button
                  onClick={() => setActiveLayer(layer)}
                  disabled={status === "disabled"}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-[13px] font-medium transition-all duration-200 ${
                    isActive
                      ? "bg-violet-600/20 border border-violet-500/50 text-violet-300"
                      : status === "complete"
                      ? "text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
                      : status === "available"
                      ? "text-slate-400 hover:bg-white/5 cursor-pointer"
                      : "text-slate-600 cursor-not-allowed"
                  }`}
                >
                  {status === "complete" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold border ${
                      isActive ? "border-violet-400 text-violet-400 bg-violet-400/10" : "border-slate-600 text-slate-500"
                    }`}>
                      {layer}
                    </div>
                  )}
                  <Icon className="w-3.5 h-3.5" />
                  {layerLabels[i]}
                </button>
                {i < 2 && (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-600 mx-0.5" />
                )}
              </div>
            );
          })}
        </div>

        {/* Right nav actions */}
        <div className="flex items-center gap-2 min-w-[160px] justify-end">
          <button className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors">
            <Bell className="w-4 h-4" />
          </button>
          <button className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors">
            <Settings2 className="w-4 h-4" />
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
            Layer {activeLayer} Simulation Running — {layerLabels[activeLayer - 1]} Digital Twin
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
        <div className="h-10 bg-emerald-900/20 border-b border-emerald-500/20 flex items-center px-6 gap-3 shrink-0">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-[12px] text-emerald-300 font-medium">
            Layer {activeLayer} simulation complete
          </span>
          {activeLayer < 3 && (
            <button
              onClick={() => setActiveLayer((activeLayer + 1) as Layer)}
              className="ml-auto flex items-center gap-1.5 text-[12px] bg-violet-600 hover:bg-violet-500 px-3 py-1 rounded-md font-medium transition-colors"
            >
              Continue to {layerLabels[activeLayer]} Simulation
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
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

              {/* Saved Projects */}
              <div className="p-3 flex-1 overflow-y-auto">
                <div className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest mb-2">Saved Projects</div>
                {savedProjects.map((proj) => (
                  <div key={proj.name} className="p-2.5 rounded-lg hover:bg-white/5 cursor-pointer mb-1 group">
                    <div className="text-[11px] font-medium text-slate-300 truncate group-hover:text-white">{proj.name}</div>
                    <div className="text-[10px] text-slate-600">{proj.indication}</div>
                    <div className="flex gap-0.5 mt-1.5">
                      {[1, 2, 3].map(l => (
                        <div key={l} className={`h-0.5 flex-1 rounded-full ${l <= proj.layers ? "bg-violet-500" : "bg-white/10"}`} />
                      ))}
                    </div>
                  </div>
                ))}

                <button className="w-full mt-3 py-2 text-[11px] text-violet-400 hover:text-violet-300 border border-dashed border-violet-500/30 hover:border-violet-500/50 rounded-lg transition-colors flex items-center justify-center gap-1.5">
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

                      {projImportResult && (
                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2">
                          <div className="text-[11px] font-semibold text-emerald-300 leading-tight">{projImportResult.name}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{projImportResult.indication}</div>
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="text-[9px] text-slate-600">{projImportResult.phase} · {projImportResult.sponsor}</span>
                            <button
                              onClick={() => {
                                setSavedProjects(prev => [{ name: projImportResult.name, indication: projImportResult.indication, layers: 0 }, ...prev]);
                                setProjImportOpen(false);
                                setProjImportResult(null);
                                setProjImportId("");
                              }}
                              className="flex items-center gap-0.5 px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-[10px] font-medium transition-all"
                            >
                              <CheckCircle2 className="w-2.5 h-2.5" /> Add
                            </button>
                          </div>
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

          {/* Layer 1 — Molecular Digital Twin */}
          {activeLayer === 1 && (
            <div className="flex-1 flex overflow-hidden">
              {/* Input Panel */}
              <div className="w-[420px] border-r border-white/8 overflow-y-auto flex flex-col">
                <div className="p-5 border-b border-white/8">
                  <div className="flex items-center gap-2 mb-1">
                    <FlaskConical className="w-4 h-4 text-violet-400" />
                    <h2 className="text-[15px] font-semibold text-white">Layer 1 — Molecular Digital Twin</h2>
                  </div>
                  <p className="text-[11px] text-slate-500">Configure molecular structure and simulation parameters</p>
                </div>

                <div className="p-5 space-y-5">
                  {/* 2.1 Primary Molecular Input */}
                  <section>
                    <SectionHeader icon={Atom} label="Primary Molecular Input" />
                    <div className="space-y-3">
                      <FieldGroup label="SMILES String" required hint="RDKit validated · MW 100–1500 Da">
                        <div className="relative">
                          <Input
                            value={smiles}
                            onChange={e => setSmiles(e.target.value)}
                            placeholder="Enter SMILES notation..."
                            className="bg-white/5 border-white/10 text-white text-[12px] font-mono pr-10 focus:border-violet-500/60 focus:bg-white/8"
                          />
                          {smiles && (
                            <div className="absolute right-2 top-1/2 -translate-y-1/2">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            </div>
                          )}
                        </div>
                        {smiles && (
                          <div className="mt-2 bg-white/5 border border-white/10 rounded-lg p-3 flex items-center justify-between h-20 text-[10px] text-slate-500">
                            <div className="flex items-center gap-2">
                              <div className="w-12 h-12 rounded border border-emerald-500/30 bg-emerald-500/5 flex items-center justify-center">
                                <Atom className="w-5 h-5 text-emerald-400/60" />
                              </div>
                              <div>
                                <div className="text-emerald-400 text-[11px] font-medium">Valid structure</div>
                                <div className="text-slate-500 text-[10px]">MW ≈ 206.3 Da · {smiles.length} chars</div>
                              </div>
                            </div>
                            <button
                              onClick={() => setViewer3DOpen(true)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 transition-all text-[11px] font-medium"
                            >
                              <Box className="w-3.5 h-3.5" />
                              View 3D
                            </button>
                          </div>
                        )}
                      </FieldGroup>

                      <FieldGroup label="Molecule Name" hint="Auto-generated if blank">
                        <Input
                          value={molName}
                          onChange={e => setMolName(e.target.value)}
                          className="bg-white/5 border-white/10 text-white text-[12px] focus:border-violet-500/60"
                          placeholder="e.g. Compound-XYZ-001"
                        />
                      </FieldGroup>

                      <div className="grid grid-cols-2 gap-2">
                        <UploadButton label="SDF / MOL2 Upload" hint=".sdf, .mol2, .mol · 10MB" />
                        <UploadButton label="Batch CSV" hint="CSV with 'smiles' col · 500 rows" />
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
                            <Badge className="text-[9px] px-1.5 py-0 bg-violet-500/10 text-violet-400 border-violet-500/20">ChEMBL · PubChem · DrugBank · more</Badge>
                          </div>
                          {apiImportOpen ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
                        </button>

                        {apiImportOpen && (
                          <div className="px-3 pb-3 space-y-3 border-t border-white/6">
                            <div className="pt-3">
                              <div className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">Source Database</div>
                              <div className="flex flex-wrap gap-1.5">
                                {[
                                  { id: "chembl",   label: "ChEMBL" },
                                  { id: "pubchem",  label: "PubChem" },
                                  { id: "drugbank", label: "DrugBank" },
                                  { id: "unichem",  label: "UniChem" },
                                  { id: "zinc",     label: "ZINC" },
                                ].map(src => (
                                  <button
                                    key={src.id}
                                    onClick={() => { setApiSource(src.id); setApiResult(null); setApiCompoundId(""); }}
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

                            <div>
                              <div className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wider">
                                Compound ID / Name
                                <span className="ml-2 text-slate-600 normal-case">
                                  e.g. {apiSource === "chembl" ? "CHEMBL25" : apiSource === "pubchem" ? "3672" : apiSource === "drugbank" ? "DB01050" : apiSource === "unichem" ? "UCI2" : "ZINC000003594435"}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <div className="relative flex-1">
                                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
                                  <Input
                                    value={apiCompoundId}
                                    onChange={e => { setApiCompoundId(e.target.value); setApiResult(null); }}
                                    onKeyDown={e => e.key === "Enter" && handleApiFetch()}
                                    placeholder="Enter ID or name…"
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

                            {apiResult && (
                              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[11px] font-semibold text-emerald-300">{apiResult.name}</div>
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
                  <section>
                    <SectionHeader icon={Dna} label="Target Protein Configuration" />
                    <div className="space-y-3">
                      <FieldGroup label="Target UniProt ID" hint="Required for binding simulation">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                          <Input
                            value={uniprotId}
                            onChange={e => setUniprotId(e.target.value)}
                            className="bg-white/5 border-white/10 text-white text-[12px] pl-8 focus:border-violet-500/60"
                            placeholder="e.g. P12345"
                          />
                        </div>
                        {uniprotId && (
                          <div className="mt-1.5 text-[10px] text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> EGFR · Epidermal growth factor receptor
                          </div>
                        )}
                      </FieldGroup>

                      <FieldGroup label="PDB Structure ID" hint="Overrides auto-selected structure">
                        <Input
                          defaultValue="4HJO"
                          className="bg-white/5 border-white/10 text-white text-[12px] focus:border-violet-500/60"
                          placeholder="e.g. 4HJO"
                        />
                      </FieldGroup>

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

                  {/* 2.3 Simulation Options */}
                  <section>
                    <SectionHeader icon={Settings2} label="Simulation Options" />
                    <div className="space-y-2.5">
                      <ToggleRow
                        label="ADMET Prediction"
                        description="Always on — core prediction"
                        value={admetOn}
                        locked
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

                {/* Run Button */}
                <div className="p-5 border-t border-white/8 mt-auto">
                  <Button
                    onClick={runSimulation}
                    disabled={simStatus[1] === "running" || !smiles}
                    className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold h-10 gap-2 text-[13px] disabled:opacity-50"
                  >
                    {simStatus[1] === "running" ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Simulating…</>
                    ) : (
                      <><Play className="w-4 h-4" /> Run Molecular Simulation</>
                    )}
                  </Button>
                  <p className="text-[10px] text-slate-600 text-center mt-2">Est. runtime: 5–30 seconds</p>
                </div>
              </div>

              {/* Output Panel — Layer 1 */}
              <div className="flex-1 overflow-y-auto p-5">
                {simStatus[1] === "idle" && (
                  <div className="flex flex-col items-center justify-center h-full gap-6">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                        <FlaskConical className="w-7 h-7 text-violet-400/50" />
                      </div>
                      <div className="text-center">
                        <div className="text-[14px] font-medium text-slate-400">No simulation results yet</div>
                        <div className="text-[11px] text-slate-600 mt-1 max-w-xs">Configure your molecular inputs on the left and run the simulation to see ADMET predictions, binding analysis, and toxicity signals.</div>
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
                    <div className="text-[14px] font-medium text-white">Running Molecular Simulation</div>
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
                    <Layer1Results />
                  </>
                )}
              </div>
            </div>
          )}

          {/* Layer 2 — Patient Cohort Twin */}
          {activeLayer === 2 && (
            <div className="flex-1 flex overflow-hidden">
              <div className="w-[440px] border-r border-white/8 overflow-y-auto flex flex-col">
                <div className="p-5 border-b border-white/8">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="w-4 h-4 text-blue-400" />
                    <h2 className="text-[15px] font-semibold text-white">Layer 2 — Patient Cohort Twin</h2>
                  </div>
                  <p className="text-[11px] text-slate-500">Configure virtual patient population for PK/PD simulation</p>
                </div>

                <div className="p-5 space-y-5">
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
                        <div className="flex gap-1.5 flex-wrap">
                          {["Hypertension","T2DM","CKD Stage 3"].map(c => (
                            <Badge key={c} variant="secondary" className="text-[10px] gap-1 bg-white/8 text-slate-400 hover:bg-red-500/10 cursor-pointer">
                              {c} <X className="w-2.5 h-2.5" />
                            </Badge>
                          ))}
                          <button className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5">
                            <Plus className="w-3 h-3" /> Add
                          </button>
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
                        { label: "CYP2C9 Modeling", val: false, set: () => {}, hint: "Warfarin-type metabolism" },
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
                          {[
                            { label: "hERG", val: 0.12, color: "bg-emerald-500" },
                            { label: "Hepatotox", val: 0.08, color: "bg-yellow-500" },
                            { label: "Genotox", val: 0.04, color: "bg-emerald-500" },
                          ].map(({ label, val, color }) => (
                            <div key={label} className="flex items-center gap-3">
                              <span className="text-[10px] text-slate-400 w-16">{label}</span>
                              <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                                <div className={`h-full ${color} rounded-full`} style={{ width: `${val * 100}%` }} />
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

                <div className="p-5 border-t border-white/8 mt-auto">
                  <Button
                    onClick={runSimulation}
                    disabled={simStatus[2] === "running"}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold h-10 gap-2 text-[13px] disabled:opacity-50"
                  >
                    {simStatus[2] === "running" ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Simulating Cohort…</>
                    ) : (
                      <><Play className="w-4 h-4" /> Run Cohort Simulation</>
                    )}
                  </Button>
                  <p className="text-[10px] text-slate-600 text-center mt-2">Est. runtime: 2–7 minutes</p>
                </div>
              </div>

              {/* L2 Output */}
              <div className="flex-1 overflow-y-auto p-5">
                {simStatus[2] === "idle" && (
                  <EmptyState
                    icon={Users}
                    title="No cohort results yet"
                    description="Configure patient cohort parameters and run the simulation to see PK/PD curves, responder classification, and adverse event predictions."
                  />
                )}
                {simStatus[2] === "running" && (
                  <div className="flex flex-col items-center justify-center h-full gap-4">
                    <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                      <Users className="w-8 h-8 text-blue-400 animate-pulse" />
                    </div>
                    <div className="text-[14px] font-medium text-white">Simulating {cohortSize[0].toLocaleString()} virtual patients</div>
                    <Progress value={simProgress} className="w-64 h-2 bg-white/10" />
                    <p className="text-[11px] text-slate-500">PK/PD modeling · Responder analysis · AE prediction</p>
                  </div>
                )}
                {simStatus[2] === "complete" && <Layer2Results />}
              </div>
            </div>
          )}

          {/* Layer 3 — Trial Digital Twin */}
          {activeLayer === 3 && (
            <div className="flex-1 flex overflow-hidden">
              <div className="w-[460px] border-r border-white/8 overflow-y-auto flex flex-col">
                <div className="p-5 border-b border-white/8">
                  <div className="flex items-center gap-2 mb-1">
                    <Beaker className="w-4 h-4 text-emerald-400" />
                    <h2 className="text-[15px] font-semibold text-white">Layer 3 — Trial Digital Twin</h2>
                  </div>
                  <p className="text-[11px] text-slate-500">Configure clinical trial design, endpoints, and simulation parameters</p>
                </div>

                <div className="p-5 space-y-5">
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
                            <Select defaultValue="50%">
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
                              <Select defaultValue="O'Brien-Fleming">
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
                              <Select defaultValue="O'Brien-Fleming">
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
                          <ToggleRow label="Sample Size Re-estimation" value={false} onChange={() => {}} />
                          <ToggleRow label="Response-Adaptive Randomization" value={false} onChange={() => {}} />
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

                <div className="p-5 border-t border-white/8 mt-auto">
                  <Button
                    onClick={runSimulation}
                    disabled={simStatus[3] === "running"}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold h-10 gap-2 text-[13px] disabled:opacity-50"
                  >
                    {simStatus[3] === "running" ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Simulating Trial…</>
                    ) : (
                      <><Play className="w-4 h-4" /> Run Trial Simulation</>
                    )}
                  </Button>
                  <p className="text-[10px] text-slate-600 text-center mt-2">Est. runtime: 15–30 minutes</p>
                </div>
              </div>

              {/* L3 Output */}
              <div className="flex-1 overflow-y-auto p-5">
                {simStatus[3] === "idle" && (
                  <EmptyState
                    icon={Beaker}
                    title="No trial results yet"
                    description="Configure your trial design and simulation parameters, then run the trial simulation to see success probability, power curves, enrollment trajectories, and adaptive decision trees."
                  />
                )}
                {simStatus[3] === "running" && (
                  <div className="flex flex-col items-center justify-center h-full gap-4">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                      <BarChart3 className="w-8 h-8 text-emerald-400 animate-pulse" />
                    </div>
                    <div className="text-[14px] font-medium text-white">Running Trial Simulation</div>
                    <Progress value={simProgress} className="w-64 h-2 bg-white/10" />
                    <p className="text-[11px] text-slate-500">Monte Carlo · {monteCarloReps[0].toLocaleString()} replications · Power analysis</p>
                  </div>
                )}
                {simStatus[3] === "complete" && <Layer3Results />}
              </div>
            </div>
          )}
        </main>
      </div>

      {viewer3DOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col bg-[#04050a]">
          <div className="h-12 flex items-center px-4 gap-3 border-b border-white/8 bg-black/40 backdrop-blur-sm shrink-0">
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
              {([
                { id: "cinematic", label: "🎬 Cinematic", desc: "Immersive" },
                { id: "scientific", label: "🔬 Scientific", desc: "Split Panel" },
                { id: "explorer", label: "🧬 Explorer", desc: "Multi-Molecule" },
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
            {viewer3DMode === "cinematic" && <MolViewer3D_Cinematic />}
            {viewer3DMode === "scientific" && <MolViewer3D_Scientific />}
            {viewer3DMode === "explorer" && <MolViewer3D_Explorer />}
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

function UploadButton({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="border border-dashed border-white/10 hover:border-white/20 rounded-lg p-3 text-center cursor-pointer hover:bg-white/3 transition-all group">
      <div className="text-[11px] font-medium text-slate-400 group-hover:text-slate-300">{label}</div>
      <div className="text-[9px] text-slate-600 mt-0.5">{hint}</div>
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

// ── Layer 1 Results ───────────────────────────────────────────────────
function Layer1Results() {
  const [activeTab, setActiveTab] = useState("admet");

  return (
    <div className="space-y-4">
      {/* Go/No-Go Summary Card */}
      <div className="bg-gradient-to-r from-emerald-950/60 to-emerald-900/30 border border-emerald-500/25 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" />
              <span className="text-[20px] font-bold text-emerald-400">GO</span>
            </div>
            <p className="text-[13px] text-white font-medium">Recommendation: Advance to Cohort Simulation</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Confidence Score: <span className="text-emerald-400 font-semibold">87.3%</span></p>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-slate-500 mb-2">Similar approved drugs</div>
            <div className="flex gap-1.5 flex-wrap justify-end">
              {["Erlotinib","Gefitinib","Osimertinib"].map(d => (
                <Badge key={d} className="text-[9px] bg-white/5 text-slate-400">{d}</Badge>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-white/8 flex gap-4">
          {[
            { label: "QED Score", val: "0.72", good: true },
            { label: "Toxicity Risk", val: "Low", good: true },
            { label: "Binding Affinity", val: "12.4 nM", good: true },
            { label: "SA Score", val: "2.8", good: true },
          ].map(({ label, val, good }) => (
            <div key={label}>
              <div className="text-[9px] text-slate-600 uppercase tracking-wider">{label}</div>
              <div className={`text-[12px] font-semibold mt-0.5 ${good ? "text-emerald-400" : "text-red-400"}`}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 p-1 rounded-lg">
        {[
          { id: "admet", label: "ADMET Radar", icon: Activity },
          { id: "binding", label: "Binding", icon: Microscope },
          { id: "toxicity", label: "Toxicity", icon: Shield },
          { id: "batch", label: "Batch Table", icon: BarChart3 },
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

      {activeTab === "admet" && <ADMETRadarChart />}
      {activeTab === "binding" && <BindingHeatmap />}
      {activeTab === "toxicity" && <ToxicityPanel />}
      {activeTab === "batch" && <BatchTable />}

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
    </div>
  );
}

function ADMETRadarChart() {
  const axes = [
    { label: "Absorption", val: 0.82, angle: -90 },
    { label: "Distribution", val: 0.68, angle: -18 },
    { label: "Metabolism", val: 0.74, angle: 54 },
    { label: "Excretion", val: 0.71, angle: 126 },
    { label: "Toxicity", val: 0.88, angle: 198 },
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
                { rule: "MW ≤ 500", pass: true, val: "206 Da" },
                { rule: "logP ≤ 5", pass: true, val: "3.2" },
                { rule: "HBD ≤ 5", pass: true, val: "2" },
                { rule: "HBA ≤ 10", pass: true, val: "4" },
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

function BindingHeatmap() {
  const targets = ["EGFR (P00533)","HER2 (P04626)","HER3 (P21860)"];
  const metrics = ["Kd (nM)","Ki (nM)","IC50 (nM)","Selectivity"];
  const data = [
    [12.4, 8.9, 15.2, 4.2],
    [180.3, 210.4, 195.8, 0.07],
    [890.2, 1024.1, 940.5, 0.01],
  ];

  const getColor = (val: number, col: number) => {
    if (col === 3) {
      return val > 2 ? "#22c55e" : val > 0.5 ? "#eab308" : "#ef4444";
    }
    return val < 50 ? "#22c55e" : val < 500 ? "#eab308" : "#ef4444";
  };

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">Binding Affinity Heatmap</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr>
              <th className="text-left text-slate-500 pb-2 pr-4 font-medium">Target</th>
              {metrics.map(m => <th key={m} className="text-center text-slate-500 pb-2 px-3 font-medium">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {targets.map((t, ti) => (
              <tr key={t}>
                <td className="text-slate-300 py-2 pr-4 whitespace-nowrap">{t}</td>
                {data[ti].map((v, ci) => (
                  <td key={ci} className="text-center py-2 px-3">
                    <span
                      className="px-2 py-0.5 rounded font-semibold"
                      style={{ color: getColor(v, ci), backgroundColor: getColor(v, ci) + "15" }}
                    >
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
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-emerald-500" /> Strong binding</div>
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-yellow-500" /> Moderate</div>
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded bg-red-500" /> Weak</div>
      </div>
    </div>
  );
}

function ToxicityPanel() {
  const organs = [
    { name: "Liver", risk: 0.08, alerts: ["CYP3A4 substrate"], color: "emerald" },
    { name: "Heart (hERG)", risk: 0.12, alerts: ["Minor QT prolongation risk"], color: "emerald" },
    { name: "Kidney", risk: 0.05, alerts: [], color: "emerald" },
    { name: "CNS", risk: 0.22, alerts: ["BBB penetrant", "CNS active class"], color: "yellow" },
    { name: "GI Tract", risk: 0.09, alerts: [], color: "emerald" },
    { name: "Lung", risk: 0.04, alerts: [], color: "emerald" },
  ];

  const colorMap: Record<string, string> = {
    emerald: "border-emerald-500/20 bg-emerald-500/5",
    yellow: "border-yellow-500/25 bg-yellow-500/5",
    red: "border-red-500/25 bg-red-500/5",
  };

  const textColorMap: Record<string, string> = {
    emerald: "text-emerald-400",
    yellow: "text-yellow-400",
    red: "text-red-400",
  };

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">Toxicity Signal Panel</h3>
      <div className="grid grid-cols-3 gap-3">
        {organs.map(o => (
          <div key={o.name} className={`border rounded-lg p-3 ${colorMap[o.color]}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-300">{o.name}</span>
              <span className={`text-[12px] font-bold ${textColorMap[o.color]}`}>{(o.risk * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1 bg-white/10 rounded-full overflow-hidden mb-2">
              <div className={`h-full rounded-full ${o.color === "emerald" ? "bg-emerald-500" : o.color === "yellow" ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${o.risk * 100}%` }} />
            </div>
            <div className="text-[9px] text-slate-600">
              {o.alerts.length > 0 ? o.alerts.map(a => <div key={a} className="text-yellow-500/80">⚠ {a}</div>) : <div className="text-emerald-600">No structural alerts</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BatchTable() {
  const rows = [
    { rank: 1, name: "Ibuprofen-Analog-001", qed: 0.72, tox: "Low", binding: "12.4 nM", sa: 2.8, composite: 0.81, pareto: true },
    { rank: 2, name: "Ibuprofen-Analog-007", qed: 0.68, tox: "Low", binding: "18.2 nM", sa: 3.1, composite: 0.76, pareto: true },
    { rank: 3, name: "Ibuprofen-Analog-012", qed: 0.61, tox: "Medium", binding: "24.7 nM", sa: 2.4, composite: 0.67, pareto: false },
    { rank: 4, name: "Ibuprofen-Analog-003", qed: 0.55, tox: "Low", binding: "31.0 nM", sa: 3.8, composite: 0.63, pareto: false },
    { rank: 5, name: "Ibuprofen-Analog-019", qed: 0.59, tox: "High", binding: "9.8 nM", sa: 2.2, composite: 0.58, pareto: false },
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
function Layer2Results() {
  const [activeTab, setActiveTab] = useState("pkpd");

  return (
    <div className="space-y-4">
      {/* Summary Header */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Responder Rate", val: "58.4%", sub: "at 200mg QD", color: "blue" },
          { label: "Cmax Mean", val: "2,847 ng/mL", sub: "±412 ng/mL SD", color: "blue" },
          { label: "AUC₀₋₂₄", val: "28,100 ng·h/mL", sub: "at therapeutic dose", color: "blue" },
          { label: "Grade ≥3 AEs", val: "12.3%", sub: "projected incidence", color: "amber" },
        ].map(({ label, val, sub, color }) => (
          <div key={label} className={`rounded-xl border p-4 ${color === "blue" ? "border-blue-500/20 bg-blue-500/5" : "border-amber-500/20 bg-amber-500/5"}`}>
            <div className="text-[10px] text-slate-500 mb-1">{label}</div>
            <div className={`text-[16px] font-bold ${color === "blue" ? "text-blue-300" : "text-amber-300"}`}>{val}</div>
            <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>
          </div>
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

      {activeTab === "pkpd" && <PKPDCurves />}
      {activeTab === "responders" && <ResponderChart />}
      {activeTab === "ae" && <AETable />}
      {activeTab === "subgroup" && <SubgroupHeatmap />}
      {activeTab === "dose" && <DoseResponseCurve />}

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
    </div>
  );
}

function PKPDCurves() {
  const doses = [100, 200, 400, 800];
  const timePoints = [0, 1, 2, 4, 6, 8, 12, 24];
  const colors = ["#6366f1","#3b82f6","#06b6d4","#22c55e"];

  const pk = (dose: number, t: number) =>
    dose * 14.2 * (Math.exp(-0.058 * t) - Math.exp(-0.693 * t)) / (0.693 - 0.058);

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">PK/PD Concentration Curves</h3>
      <svg width="100%" height="220" viewBox="0 0 520 220" className="overflow-visible">
        {/* Grid */}
        {[0, 50, 100, 150, 200].map(y => (
          <line key={y} x1="40" y1={200 - y} x2="510" y2={200 - y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        ))}
        {timePoints.map((t, i) => (
          <text key={t} x={40 + i * 67} y="215" fill="#4b5563" fontSize="9" textAnchor="middle">{t}h</text>
        ))}

        {/* Therapeutic window */}
        <rect x="40" y="100" width="470" height="60" fill="rgba(34,197,94,0.05)" />
        <text x="44" y="108" fill="#22c55e" fontSize="8">Therapeutic Window</text>

        {doses.map((dose, di) => {
          const pts = timePoints.map((t, i) => {
            const val = pk(dose, t) / 60;
            return `${40 + i * 67},${Math.max(0, 200 - val)}`;
          });
          return (
            <polyline key={dose} points={pts.join(" ")} fill="none" stroke={colors[di]} strokeWidth="2" opacity="0.85" />
          );
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

function ResponderChart() {
  const segments = [
    { label: "Responder", pct: 58.4, color: "#22c55e" },
    { label: "Partial", pct: 24.1, color: "#eab308" },
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
          <text x={cx} y={cy - 6} fill="white" fontSize="14" textAnchor="middle" fontWeight="700">58.4%</text>
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

function AETable() {
  const aes = [
    { ae: "Nausea", incidence: 28.4, mild: 18.2, moderate: 8.6, severe: 1.6, onset: 3 },
    { ae: "Fatigue", incidence: 22.1, mild: 14.3, moderate: 7.1, severe: 0.7, onset: 7 },
    { ae: "Neutropenia (Gr ≥3)", incidence: 12.3, mild: 0, moderate: 4.2, severe: 8.1, onset: 21 },
    { ae: "ALT Elevation", incidence: 8.9, mild: 4.2, moderate: 3.9, severe: 0.8, onset: 14 },
    { ae: "QTc Prolongation", incidence: 4.2, mild: 2.8, moderate: 1.1, severe: 0.3, onset: 10 },
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

function SubgroupHeatmap() {
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

function DoseResponseCurve() {
  const doses = [50, 100, 200, 400, 800];
  const response = [0.18, 0.34, 0.58, 0.71, 0.74];
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

// ── Layer 3 Results ───────────────────────────────────────────────────
function Layer3Results() {
  const [activeTab, setActiveTab] = useState("success");

  return (
    <div className="space-y-4">
      {/* Success Banner */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Trial Success Probability", val: "72.4%", sub: "95% CI: 64.1–80.7%", color: "emerald" },
          { label: "Optimal Sample Size", val: "248", sub: "for 80% power at α=0.05", color: "emerald" },
          { label: "Projected Duration", val: "34 months", sub: "enrollment + follow-up", color: "blue" },
          { label: "Estimated Cost", val: "$24.7M", sub: "±$3.2M sensitivity range", color: "amber" },
        ].map(({ label, val, sub, color }) => (
          <div key={label} className={`rounded-xl border p-4 ${color === "emerald" ? "border-emerald-500/20 bg-emerald-500/5" : color === "blue" ? "border-blue-500/20 bg-blue-500/5" : "border-amber-500/20 bg-amber-500/5"}`}>
            <div className="text-[10px] text-slate-500 mb-1">{label}</div>
            <div className={`text-[16px] font-bold ${color === "emerald" ? "text-emerald-300" : color === "blue" ? "text-blue-300" : "text-amber-300"}`}>{val}</div>
            <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 bg-white/5 p-1 rounded-lg">
        {[
          { id: "success", label: "Success Prob.", icon: Target },
          { id: "enrollment", label: "Enrollment", icon: TrendingUp },
          { id: "power", label: "Power Curve", icon: BarChart3 },
          { id: "balance", label: "Balance Report", icon: Activity },
          { id: "sites", label: "Site Ranking", icon: Map },
          { id: "cost", label: "Cost", icon: Database },
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

      {activeTab === "success" && <SuccessProbGauge />}
      {activeTab === "enrollment" && <EnrollmentChart />}
      {activeTab === "power" && <PowerCurve />}
      {activeTab === "balance" && <BalanceReport />}
      {activeTab === "sites" && <SiteRanking />}
      {activeTab === "cost" && <CostSummary />}

      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" className="border-white/10 text-slate-400 hover:text-white text-[11px] gap-1.5">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </Button>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] gap-1.5">
          <FileText className="w-3.5 h-3.5" /> Generate Full Report
        </Button>
      </div>
    </div>
  );
}

function SuccessProbGauge() {
  const prob = 72.4;
  const angle = -135 + (prob / 100) * 270;
  const cx = 110, cy = 100, r = 80;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const arcStart = { x: cx + r * Math.cos(toRad(-135)), y: cy + r * Math.sin(toRad(-135)) };
  const arcEnd = { x: cx + r * Math.cos(toRad(135)), y: cy + r * Math.sin(toRad(135)) };
  const fillEnd = { x: cx + r * Math.cos(toRad(angle)), y: cy + r * Math.sin(toRad(angle)) };

  const gaugeArc = (startAngle: number, endAngle: number, color: string) => {
    const s = { x: cx + r * Math.cos(toRad(startAngle)), y: cy + r * Math.sin(toRad(startAngle)) };
    const e = { x: cx + r * Math.cos(toRad(endAngle)), y: cy + r * Math.sin(toRad(endAngle)) };
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return <path d={`M${s.x},${s.y} A${r},${r} 0 ${large} 1 ${e.x},${e.y}`} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" />;
  };

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">Trial Success Probability</h3>
      <div className="flex gap-8 items-center">
        <div className="relative">
          <svg width="220" height="150">
            {gaugeArc(-135, -45, "#ef444440")}
            {gaugeArc(-45, 45, "#eab30840")}
            {gaugeArc(45, 135, "#22c55e40")}

            {gaugeArc(-135, angle, prob < 50 ? "#ef4444" : prob < 70 ? "#eab308" : "#22c55e")}

            <circle cx={cx} cy={cy} r="6" fill={prob > 70 ? "#22c55e" : "#eab308"}
              style={{ transform: `translate(${cx + (r - 2) * Math.cos(toRad(angle)) - cx}px, ${cy + (r - 2) * Math.sin(toRad(angle)) - cy}px)` }}
            />

            <text x={cx} y={cy + 5} fill="white" fontSize="28" textAnchor="middle" fontWeight="800" dominantBaseline="central">{prob}%</text>
            <text x={cx} y={cy + 28} fill="#22c55e" fontSize="11" textAnchor="middle" fontWeight="600">HIGH CONFIDENCE</text>

            <text x="18" y="145" fill="#ef4444" fontSize="9">&lt;50%</text>
            <text x="82" y="148" fill="#eab308" fontSize="9">50–70%</text>
            <text x="165" y="145" fill="#22c55e" fontSize="9">&gt;70%</text>
          </svg>
        </div>

        <div className="flex-1 space-y-3">
          <div className="text-[11px] text-slate-500 mb-2">Key Risk Factors</div>
          {[
            { factor: "Statistical Power", val: "80.2%", status: "pass" },
            { factor: "Enrollment Feasibility", val: "High", status: "pass" },
            { factor: "Dropout Risk", val: "Medium", status: "warn" },
            { factor: "Site Quality", val: "High", status: "pass" },
            { factor: "Regulatory Pathway", val: "Standard", status: "pass" },
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

function EnrollmentChart() {
  const months = Array.from({ length: 25 }, (_, i) => i);
  const target = 248;
  const expected = months.map(m => Math.min(target, Math.round(target * (1 - Math.exp(-0.15 * m)))));
  const optimistic = months.map(m => Math.min(target, Math.round(target * (1 - Math.exp(-0.20 * m)))));
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

function PowerCurve() {
  const samples = [50, 100, 150, 200, 248, 300, 400, 500];
  const power = samples.map(n => 1 - Math.exp(-0.0032 * n));

  const xS = (i: number) => 40 + i * 64;
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

        {/* 80% target line */}
        <line x1="40" y1={yS(0.80)} x2="520" y2={yS(0.80)} stroke="#eab308" strokeWidth="1" strokeDasharray="5,3" opacity="0.5" />
        <text x="524" y={yS(0.80) + 4} fill="#eab308" fontSize="8">80%</text>

        <polyline points={power.map((v, i) => `${xS(i)},${yS(v)}`).join(" ")} fill="none" stroke="#22c55e" strokeWidth="2.5" />

        {/* Current design marker */}
        <line x1={xS(4)} y1="0" x2={xS(4)} y2={yS(power[4])} stroke="#22c55e" strokeWidth="1" strokeDasharray="4,3" opacity="0.6" />
        <circle cx={xS(4)} cy={yS(power[4])} r="5" fill="#22c55e" />
        <text x={xS(4)} y={yS(power[4]) - 10} fill="#22c55e" fontSize="9" textAnchor="middle">n=248</text>
        <text x="18" y="120" fill="#6b7280" fontSize="9" transform="rotate(-90 18 120)">Power (1-β)</text>
        <text x="280" y="212" fill="#6b7280" fontSize="9" textAnchor="middle">Sample Size</text>
      </svg>
    </div>
  );
}

function BalanceReport() {
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

function SiteRanking() {
  const sites = [
    { rank: 1, site: "Johns Hopkins, Baltimore", region: "North America", enrollment: 4.2, quality: 9.2, composite: 91 },
    { rank: 2, site: "Royal Marsden, London", region: "Europe", enrollment: 3.8, quality: 9.4, composite: 88 },
    { rank: 3, site: "MD Anderson, Houston", region: "North America", enrollment: 3.9, quality: 8.9, composite: 86 },
    { rank: 4, site: "Memorial Sloan Kettering", region: "North America", enrollment: 3.5, quality: 9.1, composite: 84 },
    { rank: 5, site: "Tokyo Medical Univ.", region: "Asia-Pacific", enrollment: 3.3, quality: 8.7, composite: 79 },
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

function CostSummary() {
  const categories = [
    { label: "Site Operations", amount: 11.2, pct: 45, color: "#8b5cf6" },
    { label: "Drug Supply", amount: 6.2, pct: 25, color: "#3b82f6" },
    { label: "Clinical Monitoring", amount: 4.9, pct: 20, color: "#06b6d4" },
    { label: "Lab & Biomarker", amount: 2.5, pct: 10, color: "#22c55e" },
  ];

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5">
      <h3 className="text-[12px] font-semibold text-slate-300 mb-4">Cost Estimate Summary</h3>
      <div className="flex gap-6 items-start">
        <div className="flex-1">
          <div className="text-[28px] font-bold text-white mb-0.5">$24.7M</div>
          <div className="text-[11px] text-slate-500">Total estimated cost · USD</div>
          <div className="text-[11px] text-slate-600 mt-1">Sensitivity range: $21.5M–$27.9M</div>

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
            <div className="text-[16px] font-bold text-white mt-0.5">$99,597</div>
          </div>
          <div className="border border-white/8 rounded-lg p-3 text-right">
            <div className="text-[10px] text-slate-600">Cost per Site</div>
            <div className="text-[16px] font-bold text-white mt-0.5">$1.24M</div>
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
