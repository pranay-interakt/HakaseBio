import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bioAnalysisRouter from "./bio-analysis/index";

const router: IRouter = Router();

router.use(healthRouter);
router.use(bioAnalysisRouter);

export default router;
