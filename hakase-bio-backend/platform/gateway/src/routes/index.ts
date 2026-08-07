import { Router, type IRouter } from "express";

import datasourcesRouter from "@platform/datasources";
import narrativeRouter from "@platform/narrative";

import aiServiceRouter from "./ai-service";
import healthRouter from "./health";
import preclinicalRouter from "./preclinical"; // NCATS Pharos + DailyMed (FDA SPL)
import validationRouter from "./validation"; // continuous-validation feedback log

const router: IRouter = Router();

// ── Gateway-owned routes ─────────────────────────────────────────────────────
router.use(healthRouter);
router.use(preclinicalRouter);
router.use(validationRouter);

// ── Platform packages ────────────────────────────────────────────────────────
router.use(datasourcesRouter); // third-party scientific databases
router.use(narrativeRouter); // LLM report + chat generation

// ── AI service proxy (mounts each modality by prefix) ────────────────────────
router.use(aiServiceRouter);

export default router;
