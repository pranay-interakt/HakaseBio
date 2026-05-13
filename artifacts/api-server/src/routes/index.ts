import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bioAnalysisRouter from "./bio-analysis/index";
import bioChatRouter from "./bio-chat/index";
import reportNarrativeRouter from "./report-narrative/index";
import bindingdbRouter from "./bindingdb";
import chemblRouter from "./chembl";
import ccteRouter from "./ccte";
import aiServiceRouter from "./ai-service";

const router: IRouter = Router();

router.use(healthRouter);
router.use(bioAnalysisRouter);
router.use(bioChatRouter);
router.use(reportNarrativeRouter);
router.use(bindingdbRouter);
router.use(chemblRouter);
router.use(ccteRouter);
router.use(aiServiceRouter);

export default router;
