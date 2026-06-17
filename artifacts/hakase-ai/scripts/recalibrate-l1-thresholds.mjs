#!/usr/bin/env node
/**
 * Recalibrate L1 hard-veto thresholds against an FDA-approved hold-out set.
 *
 * Why this exists
 * ───────────────
 * The literature-default hard-veto thresholds (hERG 0.80, DILI 0.80, Ames 0.75,
 * ClinTox 0.80, Carcinogen 0.80) come from each model's primary paper, which
 * tunes the threshold on the model's TRAINING distribution. When 5 such gates
 * are stacked as independent hard vetoes, the union false-positive rate on a
 * realistic FDA-approved-drug set is ~55 % — exactly what was making every
 * known drug come back NO-GO.
 *
 * What this script does
 * ─────────────────────
 * 1. Reads two cohorts of SMILES:
 *      - approved.csv     — 152 currently-marketed drugs (DrugCentral 2024,
 *                           status=Approved, withdrawn excluded)
 *      - withdrawn.csv    — 18 drugs withdrawn for the relevant endpoint
 *                           (terfenadine, cisapride for hERG; cerivastatin,
 *                           troglitazone for DILI; rofecoxib for ClinTox; etc.)
 * 2. Runs the live ai-service (/predict/admet-ml and /predict/cardiotox) for
 *    every SMILES, collects the raw probabilities.
 * 3. For each endpoint, sweeps thresholds from 0.50 to 0.99 in 0.01 steps,
 *    picks the threshold that maximises Youden's J (sensitivity + specificity
 *    − 1) on the per-endpoint subset.
 * 4. Reports the joint metrics under the stacked-OR veto rule and writes the
 *    new thresholds into src/lib/l1Thresholds.json.
 *
 * Run:
 *   pnpm exec node scripts/recalibrate-l1-thresholds.mjs \
 *     --service-url http://localhost:8000 \
 *     --approved data/calib/approved.csv \
 *     --withdrawn data/calib/withdrawn.csv
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { serviceUrl: "http://localhost:8000" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--service-url") out.serviceUrl = argv[++i];
    else if (a === "--approved") out.approvedPath = argv[++i];
    else if (a === "--withdrawn") out.withdrawnPath = argv[++i];
    else if (a === "--out") out.outPath = argv[++i];
  }
  out.outPath ??= resolve(__dirname, "..", "src", "lib", "l1Thresholds.json");
  return out;
}

async function readCsv(path) {
  const txt = await readFile(path, "utf8");
  return txt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [name, smiles, withdrawalEndpoint] = l.split(",");
      return { name, smiles, withdrawalEndpoint };
    });
}

async function predict(serviceUrl, smiles) {
  // Returns { herg, dili, ames, clintox, carcinogen } probabilities.
  const r = await fetch(`${serviceUrl}/predict/admet-ml`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ smiles }),
  }).then((r) => r.json());
  const c = await fetch(`${serviceUrl}/predict/cardiotox`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ smiles }),
  }).then((r) => r.json());
  const ep = r.endpoints ?? {};
  return {
    herg: c.blocker_probability ?? ep.hERG ?? null,
    dili: ep.DILI ?? null,
    ames: ep.AMES ?? null,
    clintox: ep.ClinTox ?? null,
    carcinogen: ep.Carcinogens_Lagunin ?? null,
  };
}

function sweepThreshold(scoresPos, scoresNeg) {
  // Youden's J = TPR - FPR, maximised over [0.50, 0.99].
  let bestT = 0.5;
  let bestJ = -Infinity;
  for (let t = 0.5; t <= 0.99; t += 0.01) {
    const tpr = scoresPos.filter((s) => s != null && s >= t).length / Math.max(1, scoresPos.length);
    const fpr = scoresNeg.filter((s) => s != null && s >= t).length / Math.max(1, scoresNeg.length);
    const j = tpr - fpr;
    if (j > bestJ) {
      bestJ = j;
      bestT = +t.toFixed(2);
    }
  }
  return { threshold: bestT, youdenJ: +bestJ.toFixed(3) };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.approvedPath || !args.withdrawnPath) {
    console.error("usage: --service-url URL --approved approved.csv --withdrawn withdrawn.csv");
    process.exit(2);
  }
  const [approved, withdrawn] = await Promise.all([
    readCsv(args.approvedPath),
    readCsv(args.withdrawnPath),
  ]);
  console.log(`Calibrating on ${approved.length} approved + ${withdrawn.length} withdrawn.`);

  // Collect probabilities (sequential to be gentle on the service).
  const approvedPreds = [];
  for (const row of approved) {
    try {
      approvedPreds.push({ ...row, p: await predict(args.serviceUrl, row.smiles) });
      process.stdout.write(".");
    } catch (e) {
      console.warn(`\nskip approved ${row.name}: ${e.message}`);
    }
  }
  const withdrawnPreds = [];
  for (const row of withdrawn) {
    try {
      withdrawnPreds.push({ ...row, p: await predict(args.serviceUrl, row.smiles) });
      process.stdout.write("!");
    } catch (e) {
      console.warn(`\nskip withdrawn ${row.name}: ${e.message}`);
    }
  }
  console.log();

  // Per-endpoint sweep.
  const endpoints = ["herg", "dili", "ames", "clintox", "carcinogen"];
  const calibrated = {};
  for (const ep of endpoints) {
    const positives = withdrawnPreds
      .filter((r) => r.withdrawalEndpoint?.toLowerCase() === ep)
      .map((r) => r.p[ep]);
    const negatives = approvedPreds.map((r) => r.p[ep]);
    calibrated[ep] = sweepThreshold(positives, negatives);
  }

  // Joint stacked-OR veto FPR on the approved set.
  let stackedFp = 0;
  for (const r of approvedPreds) {
    const tripped = endpoints.some((ep) => r.p[ep] != null && r.p[ep] >= calibrated[ep].threshold);
    if (tripped) stackedFp++;
  }
  const stackedFpr = stackedFp / Math.max(1, approvedPreds.length);

  console.log("\nCalibrated thresholds (Youden J max):");
  for (const ep of endpoints) {
    console.log(`  ${ep.padEnd(10)} → ${calibrated[ep].threshold}  (J=${calibrated[ep].youdenJ})`);
  }
  console.log(`Joint stacked-OR FPR on approved set: ${(stackedFpr * 100).toFixed(1)}%`);

  // Persist into l1Thresholds.json.
  const cur = JSON.parse(await readFile(args.outPath, "utf8"));
  cur.hard_thresholds = {
    ...cur.hard_thresholds,
    ...Object.fromEntries(endpoints.map((ep) => [ep, calibrated[ep].threshold])),
  };
  cur._meta.last_calibrated = new Date().toISOString().slice(0, 10);
  cur._meta.achieved_metrics = {
    fpr_on_approved: +stackedFpr.toFixed(3),
    recall_on_withdrawn: +(
      withdrawnPreds.filter((r) =>
        endpoints.some((ep) => r.p[ep] != null && r.p[ep] >= calibrated[ep].threshold),
      ).length / Math.max(1, withdrawnPreds.length)
    ).toFixed(3),
    youden_j: +(
      endpoints.reduce((s, ep) => s + calibrated[ep].youdenJ, 0) / endpoints.length
    ).toFixed(3),
  };
  await writeFile(args.outPath, JSON.stringify(cur, null, 2));
  console.log(`Wrote ${args.outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
