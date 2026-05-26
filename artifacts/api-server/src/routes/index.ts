import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bioAnalysisRouter from "./bio-analysis/index";
import bioChatRouter from "./bio-chat/index";
import reportNarrativeRouter from "./report-narrative/index";
import bindingdbRouter from "./bindingdb";
import chemblRouter from "./chembl";
import ccteRouter from "./ccte";
import aiServiceRouter from "./ai-service";
// ── Open-data enrichment routers (Layer 1 expansion) ─────────────────────────
import uniprotRouter      from "./uniprot";       // full protein annotation
import alphafoldDbRouter  from "./alphafold-db";  // structural template lookup
import pubchemRouter      from "./pubchem";        // compound data + bioassays
import opentargetsRouter  from "./opentargets";   // target-disease evidence
import rcsbPdbRouter      from "./rcsb-pdb";       // crystal structure templates

const router: IRouter = Router();

router.use(healthRouter);
router.use(bioAnalysisRouter);
router.use(bioChatRouter);
router.use(reportNarrativeRouter);
router.use(bindingdbRouter);
router.use(chemblRouter);
router.use(ccteRouter);
router.use(aiServiceRouter);
// ── Open-data layer ───────────────────────────────────────────────────────────
router.use(uniprotRouter);       // /uniprot/*
router.use(alphafoldDbRouter);   // /alphafold/*
router.use(pubchemRouter);       // /pubchem/*
router.use(opentargetsRouter);   // /opentargets/*
router.use(rcsbPdbRouter);       // /rcsb/*

export default router;
