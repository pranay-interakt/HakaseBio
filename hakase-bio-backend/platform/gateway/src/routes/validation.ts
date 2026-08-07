/**
 * Continuous-validation feedback log (Phase 5).
 * ─────────────────────────────────────────────────────────────────────────
 * The FDA's 2025 AI credibility-assessment framework expects sponsors to keep
 * a living record of model performance for the model's context of use. This
 * endpoint is that record: when a reviewer corrects a verdict (e.g. "this safe
 * antioxidant was wrongly flagged"), the case is appended to an append-only
 * JSONL log on disk. Over time this becomes a real regression set the scoring
 * thresholds and the calibration layer can be re-checked against — evidence of
 * credibility, and an early-warning signal if the engine drifts.
 *
 * Nothing here is fabricated: it persists exactly what a human reviewer reports.
 *
 * Routes:
 *   POST /validation/feedback   — append a correction record
 *   GET  /validation/feedback   — recent records + an agreement summary
 *
 * Storage: HAKASE_VALIDATION_DIR (env) or <cwd>/data ; file validation-log.jsonl
 */
import { Router } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";

const router = Router();

const DATA_DIR = process.env.HAKASE_VALIDATION_DIR || path.join(process.cwd(), "data");
const LOG_FILE = path.join(DATA_DIR, "validation-log.jsonl");

type Verdict = "GO" | "WATCH" | "NO-GO" | "KNOWN-LIABILITY-NO-GO" | "REVIEW";

interface FeedbackRecord {
  smiles: string;
  predictedVerdict: Verdict | string;
  /** "standard" | "review-escalate" from the scorecard. */
  predictedClass?: string;
  /** What the reviewer believes the verdict should be (their ground truth). */
  correctedVerdict: Verdict | string;
  /** Which endpoint/liability drove the disagreement (e.g. "DILI", "hERG"). */
  endpoint?: string;
  /** Free-text reviewer note. */
  note?: string;
  /** Reviewer identity (email/initials) — optional, for the audit trail. */
  reviewer?: string;
  ts: string;
}

function sanitize(s: unknown, max = 4000): string {
  return typeof s === "string" ? s.slice(0, max) : "";
}

/** Append a reviewer correction. */
router.post("/validation/feedback", async (req, res) => {
  const b = (req.body ?? {}) as Partial<FeedbackRecord>;
  const smiles = sanitize(b.smiles, 1000).trim();
  const correctedVerdict = sanitize(b.correctedVerdict, 60).trim();
  if (!smiles || !correctedVerdict) {
    res.status(400).json({ error: "smiles and correctedVerdict are required" });
    return;
  }
  const rec: FeedbackRecord = {
    smiles,
    predictedVerdict: sanitize(b.predictedVerdict, 60),
    predictedClass: sanitize(b.predictedClass, 40) || undefined,
    correctedVerdict,
    endpoint: sanitize(b.endpoint, 80) || undefined,
    note: sanitize(b.note, 2000) || undefined,
    reviewer: sanitize(b.reviewer, 120) || undefined,
    ts: new Date().toISOString(),
  };
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.appendFile(LOG_FILE, JSON.stringify(rec) + "\n", "utf8");
    res.json({ stored: true, record: rec });
  } catch (e: any) {
    res.status(500).json({ error: `Could not persist feedback: ${e?.message ?? String(e)}` });
  }
});

/** Read recent records + an agreement summary over the whole log. */
router.get("/validation/feedback", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "100"), 10) || 100, 1), 1000);
  try {
    let raw = "";
    try { raw = await fs.readFile(LOG_FILE, "utf8"); }
    catch { res.json({ count: 0, agreementRate: null, recent: [], note: "No feedback logged yet." }); return; }

    const records: FeedbackRecord[] = raw.split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) as FeedbackRecord; } catch { return null; }
    }).filter((r): r is FeedbackRecord => r != null);

    const total = records.length;
    const agreements = records.filter((r) => r.predictedVerdict === r.correctedVerdict).length;
    // Per-endpoint disagreement tally — surfaces which liability the engine most
    // often gets wrong, so calibration/thresholds can be re-examined there.
    const byEndpoint: Record<string, { total: number; disagreements: number }> = {};
    for (const r of records) {
      const k = r.endpoint || "unspecified";
      byEndpoint[k] ??= { total: 0, disagreements: 0 };
      byEndpoint[k].total++;
      if (r.predictedVerdict !== r.correctedVerdict) byEndpoint[k].disagreements++;
    }
    res.json({
      count: total,
      agreementRate: total > 0 ? +(agreements / total).toFixed(3) : null,
      byEndpoint,
      recent: records.slice(-limit).reverse(),
    });
  } catch (e: any) {
    res.status(500).json({ error: `Could not read feedback log: ${e?.message ?? String(e)}` });
  }
});

export default router;
