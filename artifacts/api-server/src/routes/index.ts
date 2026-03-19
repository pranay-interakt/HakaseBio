import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bioAnalysisRouter from "./bio-analysis/index";
import bioChatRouter from "./bio-chat/index";
import bindingdbRouter from "./bindingdb";

const router: IRouter = Router();

router.use(healthRouter);
router.use(bioAnalysisRouter);
router.use(bioChatRouter);
router.use(bindingdbRouter);

export default router;
