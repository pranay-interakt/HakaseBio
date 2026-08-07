/**
 * Public open-data enrichment routers.
 *
 * These proxy third-party scientific databases. They are modality-agnostic:
 * a datasource knows nothing about small molecules vs peptides, it just
 * exposes what the upstream service returns.
 */
import { Router, type IRouter } from "express";

import alphafoldDbRouter from "./alphafold-db"; // structural template lookup
import bindingdbRouter from "./bindingdb"; // binding affinity measurements
import ccteRouter from "./ccte"; // EPA CompTox
import chemblRouter from "./chembl"; // bioactivity + target lookup
import fdaPsgRouter from "./fda-psg"; // FDA PSG / BE intelligence
import opentargetsRouter from "./opentargets"; // target-disease evidence
import pubchemRouter from "./pubchem"; // compound data + bioassays
import rcsbPdbRouter from "./rcsb-pdb"; // crystal structure templates
import uniprotRouter from "./uniprot"; // full protein annotation

const router: IRouter = Router();

router.use(alphafoldDbRouter); // /alphafold/*
router.use(bindingdbRouter); // /bindingdb/*
router.use(ccteRouter); // /ccte/*
router.use(chemblRouter); // /chembl/*
router.use(fdaPsgRouter); // /fda-psg/*
router.use(opentargetsRouter); // /opentargets/*
router.use(pubchemRouter); // /pubchem/*
router.use(rcsbPdbRouter); // /rcsb/*
router.use(uniprotRouter); // /uniprot/*

export default router;
export {
  alphafoldDbRouter,
  bindingdbRouter,
  ccteRouter,
  chemblRouter,
  fdaPsgRouter,
  opentargetsRouter,
  pubchemRouter,
  rcsbPdbRouter,
  uniprotRouter,
};
