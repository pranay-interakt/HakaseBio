// MOVED. The real, CI-gated L1 verdict regression suite now lives at
//   scripts/l1_verdict_suite.ts   (run: pnpm -C artifacts/hakase-ai test:l1)
// It builds REAL SimResults/InVitroResults via the engines and asserts the
// verdict for 12 archetype cases (known approved/withdrawn, deterministic
// NO-GO, clean→GO, no-ML→INSUFFICIENT-EVIDENCE, in/out-of-domain hERG,
// IVIVE PK WATCH-only, determinism). This file is kept only because the
// sandbox mount is write-but-not-delete; it is inert and not imported.
export {};
