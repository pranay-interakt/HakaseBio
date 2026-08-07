/**
 * LLM narrative generation.
 *
 * The plumbing here is modality-agnostic — Claude client wiring, streaming and
 * error mapping. The per-modality system prompts and output schemas that these
 * routes select between are modality-owned; see each modality's `narrative/`
 * directory. Adding a modality should not require editing this package.
 */
import { Router, type IRouter } from "express";

import bioAnalysisRouter from "./bio-analysis";
import bioChatRouter from "./bio-chat";
import reportNarrativeRouter from "./report-narrative";

const router: IRouter = Router();

router.use(bioAnalysisRouter);
router.use(bioChatRouter);
router.use(reportNarrativeRouter);

export default router;
export { bioAnalysisRouter, bioChatRouter, reportNarrativeRouter };
