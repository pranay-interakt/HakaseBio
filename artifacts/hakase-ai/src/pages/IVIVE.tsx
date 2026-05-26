import { NavBar } from "@/components/NavBar";
import { useLocation } from "wouter";

const SPECIES = ["Human", "Mouse", "Rat", "Dog (Beagle)", "Monkey (Cyno)"] as const;

const MEASUREMENTS: Array<{
  key: string;
  label: string;
  unit: string;
  typical: string;
  why: string;
}> = [
  {
    key: "fu_p",
    label: "fu_p — fraction unbound in plasma",
    unit: "fraction (0–1)",
    typical: "0.001 – 0.5",
    why: "Sets the free-drug concentration that actually drives both efficacy and clearance. Equilibrium dialysis or ultrafiltration at therapeutic concentration.",
  },
  {
    key: "fu_mic",
    label: "fu_mic — microsomal binding fraction unbound",
    unit: "fraction (0–1)",
    typical: "0.1 – 1.0",
    why: "Obach 1999: the #1 reason published IVIVE under-predicts clearance. Without it, raw microsomal CL_int double-counts protein-bound drug. The well-stirred liver model uses CL_int / fu_mic.",
  },
  {
    key: "bp",
    label: "B/P — blood-to-plasma ratio",
    unit: "ratio",
    typical: "0.5 – 2.5",
    why: "Required by the well-stirred model to convert plasma clearance to blood clearance. Skipping it silently biases hepatic extraction by 1.5–2×.",
  },
];

const TIERS: Array<{
  name: string;
  color: "rose" | "amber" | "cyan" | "emerald";
  rule: string;
  meaning: string;
}> = [
  {
    name: "Insufficient",
    color: "rose",
    rule: "Less than fu_p (human)",
    meaning: "IVIVE math cannot start. The bridge to animal-cohort design hard-blocks until at least the human plasma binding is on the bench.",
  },
  {
    name: "Minimum",
    color: "amber",
    rule: "fu_p (human)",
    meaning: "IVIVE math runs, but cross-species extrapolation is not defended. Animal-cohort study design is allowed only with explicit sign-off acknowledging the gap.",
  },
  {
    name: "Standard",
    color: "cyan",
    rule: "fu_p (human + mouse + rat) and B/P (human + ≥1 preclinical)",
    meaning: "Tier ladder is satisfied for fu_p and B/P. Whether the cross-species defensibility flag flips green is evaluated separately on LITERATURE or IN-HOUSE cells at sign-off — Standard can be reached with class-median substrate.",
  },
  {
    name: "Premium",
    color: "emerald",
    rule: "Standard + fu_mic (human + ≥1 preclinical)",
    meaning: "Full substrate for the Obach correction is present, end-to-end. This is the highest tier the ladder reports; defensibility still depends on the LITERATURE / IN-HOUSE check that runs alongside it. This is the confidence band the first-in-human readiness step pulls through to MABEL.",
  },
];

const PIPELINE_STEPS = [
  ["1", "Receive sealed in-silico confirmation block (v2.0.0)", "sealed", "text-amber-300"],
  ["2", "Capture substrate matrix · 3 measurements × 5 species", "substrate", "text-cyan-300"],
  ["3", "Tier assessment · Insufficient / Minimum / Standard / Premium", "derived", "text-cyan-300"],
  ["4", "Apply Obach 1999 fu_mic correction to microsomal CL_int", "physics", "text-cyan-300"],
  ["5", "Well-stirred liver model · CL_h per species", "physics", "text-cyan-300"],
  ["6", "Plasma → blood clearance via B/P", "physics", "text-cyan-300"],
  ["7", "Cross-species rule check (LITERATURE or IN-HOUSE)", "gate", "text-amber-300"],
  ["8", "Hard-block / soft-warn assembly", "gate", "text-amber-300"],
  ["9", "Sign-off · name + role + ack'd alerts + substrate mode", "sealed", "text-amber-300"],
  ["10", "Release to animal cohort study design", "handoff", "text-amber-300"],
];

const tierBadge: Record<"rose" | "amber" | "cyan" | "emerald", string> = {
  rose:    "border-rose-500/30 bg-rose-500/8 text-rose-300",
  amber:   "border-amber-500/30 bg-amber-500/8 text-amber-300",
  cyan:    "border-cyan-500/30 bg-cyan-500/8 text-cyan-300",
  emerald: "border-emerald-500/30 bg-emerald-500/8 text-emerald-300",
};

export function IVIVE() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-[#07080c] text-white font-['Inter',sans-serif]">
      <NavBar />

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="relative border-b border-white/5">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/3 w-[600px] h-[260px] bg-cyan-600/8 rounded-full blur-[110px]" />
          <div className="absolute top-0 right-1/4 w-[400px] h-[200px] bg-amber-600/6 rounded-full blur-[100px]" />
        </div>
        <div className="relative z-10 max-w-6xl mx-auto px-6 md:px-8 pt-16 pb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-cyan-500/25 bg-cyan-500/8 mb-6">
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            <span className="text-[11px] font-semibold tracking-wider uppercase text-cyan-300">In-Silico · Ex-Vivo → Animal Cohort · IVIVE Gate</span>
          </div>
          <h1 className="text-[44px] md:text-[58px] font-black tracking-tight leading-[1.05] mb-5 max-w-3xl">
            IVIVE — the gate that decides<br/>
            <span className="bg-gradient-to-r from-cyan-300 via-cyan-200 to-amber-300 bg-clip-text text-transparent">whether animal studies are warranted.</span>
          </h1>
          <p className="text-[16px] text-slate-400 leading-relaxed max-w-3xl">
            In-vitro to in-vivo extrapolation is the single decision that transitions a compound from
            <span className="text-cyan-300"> in-silico and ex-vivo confirmation</span> into a defensible
            <span className="text-amber-300"> animal cohort</span> study design. HakaseAI runs IVIVE as a
            standalone gate — literature + in-house substrate in, tiered confidence assessment out, sealed sign-off required to proceed.
            This is HakaseAI's first target area: the place where most pre-clinical programmes either harden or quietly fabricate.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-8">
            {[
              { tag: "Inputs",  label: "3 measurements × 5 species", sub: "fu_p · fu_mic · B/P · human + mouse + rat + dog + monkey" },
              { tag: "Math",    label: "Well-stirred liver model",   sub: "Obach 1999 correction · plasma → blood clearance" },
              { tag: "Output",  label: "Sealed handoff to L3",       sub: "Tier · cross-species check · sign-off · substrate mode" },
            ].map(({ tag, label, sub }) => (
              <div key={tag} className="border border-white/8 rounded-xl p-4 bg-white/[0.015]">
                <div className="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold mb-1.5">{tag}</div>
                <div className="text-[14px] font-bold text-white mb-1">{label}</div>
                <div className="text-[11px] text-slate-500 leading-relaxed">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why IVIVE matters ──────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 md:px-8 py-16 border-b border-white/5">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-start">
          <div className="lg:col-span-2 space-y-4">
            <div className="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold">Why a dedicated gate</div>
            <h2 className="text-[28px] font-black tracking-tight text-white">In-silico evidence is not the same as a defensible animal study.</h2>
            <p className="text-[14px] text-slate-400 leading-relaxed">
              The in-silico confirmation track produces docking poses, FEP refinements, ML cross-checks, and a first-pass
              PBPK projection. None of that is enough to design an animal cohort. Translating in-vitro signal into a dose,
              a species, and a meaningful margin requires three measurements that the in-vitro and in-silico stages do not produce.
            </p>
            <p className="text-[14px] text-slate-400 leading-relaxed">
              Most pipelines paper over this gap with synthetic defaults — a literature midpoint here, a "typical drug"
              assumption there. HakaseAI's IVIVE gate refuses that path. Empty cells render
              <span className="text-cyan-300 font-mono"> &nbsp;—&nbsp; </span>
              never zero, never inferred. Class-median substrate (Lombardo 2018 / Smith 2010 drug-class anchors) is allowed only as an explicitly tagged path with
              <span className="text-amber-300"> CLASS-MEDIAN</span> pills on every fallback cell and substrate mode captured in the audit trail.
            </p>
          </div>
          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/4 p-6">
              <div className="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold mb-4">The three measurements</div>
              <div className="space-y-3">
                {MEASUREMENTS.map(({ label, unit, typical, why }) => (
                  <div key={label} className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <div className="text-[13px] font-bold text-cyan-200">{label}</div>
                      <div className="text-[10px] font-mono text-slate-500 shrink-0">{unit}</div>
                    </div>
                    <div className="text-[11px] text-slate-500 mb-1.5">Typical range: <span className="text-slate-400 font-mono">{typical}</span></div>
                    <div className="text-[12px] text-slate-400 leading-relaxed">{why}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-[11px] text-slate-500 leading-relaxed">
                Captured per species across <span className="text-cyan-300">{SPECIES.join(" · ")}</span> — a 15-cell matrix.
                fu_mic at the 1 mg/mL HLM convention; equilibrium dialysis recommended.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Tier ladder ────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 md:px-8 py-16 border-b border-white/5">
        <div className="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold mb-2">The four-tier ladder</div>
        <h2 className="text-[28px] font-black tracking-tight text-white mb-3">What you have on the bench decides what L3 is allowed to assume.</h2>
        <p className="text-[14px] text-slate-400 leading-relaxed max-w-3xl mb-8">
          The tier assessment is deterministic from the substrate matrix. There is no "good enough" judgement call —
          the gate reads the cells and reports the tier. Tier level and cross-species defensibility are
          tracked independently: Standard and Premium can be reached with class-median cells, but the defensibility
          flag is evaluated separately at sign-off and only counts <span className="text-white">LITERATURE</span> or <span className="text-white">IN-HOUSE</span> values.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {TIERS.map(({ name, color, rule, meaning }) => (
            <div key={name} className={`rounded-2xl border ${tierBadge[color]} p-5`}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[16px] font-black tracking-tight">{name}</div>
                <div className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${tierBadge[color]}`}>
                  {color === "rose" ? "BLOCK" : color === "amber" ? "MIN" : color === "cyan" ? "STD" : "PREM"}
                </div>
              </div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Rule</div>
              <div className="text-[13px] font-mono text-white mb-3">{rule}</div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">What it means</div>
              <div className="text-[12px] text-slate-400 leading-relaxed">{meaning}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/8 p-4 flex items-start gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-[7px] shrink-0" />
          <div className="text-[12px] text-slate-400 leading-relaxed">
            <span className="text-amber-300 font-semibold">Transition note · current release.</span>{" "}
            The in-app IVIVE cell badge still reads <span className="font-mono text-white">MEASURED</span> for both LITERATURE and IN-HOUSE inputs.
            The per-cell schema split that surfaces the distinction in the dashboard is a planned follow-up; the cross-species rule and sealed substrate-mode tag already use the new ladder.
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 flex items-start gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-[7px] shrink-0" />
          <div className="text-[12px] text-slate-400 leading-relaxed">
            <span className="text-emerald-300 font-semibold">Data residency & federated benchmarking · planned, opt-in.</span>{" "}
            IN-HOUSE bench rows you enter (Cl_int, Papp, fu, Ki, IC50…) stay in your tenant's substrate matrix. They never train the global engine, never enter another tenant's substrate, and never enter the platform's class-median anchor refit. Engine recalibration on your IN-HOUSE rows produces a tenant-scoped overlay only; your predict-vs-observed track record is private and bound to your tenant ID.
            {" "}A planned <span className="text-white">opt-in federated benchmark</span> will let you compare your engine's fold-error to the platform's overall IN-HOUSE corpus — <span className="text-white">aggregate-only, k-anonymous (≥ 5 contributing tenants per cell), residuals only</span> (predicted/observed fold-error scalars, never raw inputs, structures, targets, or indications), with a one-click withdrawal that purges your residuals from future aggregates within 24 h. Default is off until that gate ships; the current build is strictly tenant-isolated.
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-[7px] shrink-0" />
          <div className="text-[12px] text-slate-400 leading-relaxed">
            <span className="text-amber-300 font-semibold">Cross-species defensibility rule.</span>{" "}
            For both fu_p and B/P, the gate requires human + ≥1 preclinical species — and only
            <span className="text-white"> LITERATURE</span> (DOI / PMID for this compound or a Tanimoto ≥ 0.4 congener) or
            <span className="text-white"> IN-HOUSE</span> (bench / CRO measurement with assay method + lab + date) cells count. Class-median anchors
            from Lombardo 2018 / Smith 2010 populate the math so downstream panels can run,
            but they do not satisfy the rule. Proceeding on class-median substrate requires explicit acknowledgment captured in the sign-off.
          </div>
        </div>
      </section>

      {/* ── Math anchors ───────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 md:px-8 py-16 border-b border-white/5">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-start">
          <div className="lg:col-span-2 space-y-4">
            <div className="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold">The math</div>
            <h2 className="text-[28px] font-black tracking-tight text-white">Well-stirred liver model, anchored to the literature.</h2>
            <p className="text-[14px] text-slate-400 leading-relaxed">
              IVIVE projections use the well-stirred hepatic clearance model with the Obach 1999 microsomal binding
              correction. Plasma clearance is converted to blood clearance via the species-specific B/P ratio.
              Every transformation is sourced and inspectable — no opaque "model output" surfaces in L3 design.
            </p>
            <div className="space-y-2 mt-4">
              {[
                { ref: "Obach 1999",     desc: "fu_mic correction · CL_int_corrected = CL_int_measured / fu_mic · also a 29-compound IVIVE benchmark for engine recalibration" },
                { ref: "Hosea 2009 / Wang 2010", desc: "Extended IVIVE benchmark sets · validates beyond Obach's original 29" },
                { ref: "Lombardo 2018",  desc: "fu_p drug-class medians · CLASS-MEDIAN substrate anchor" },
                { ref: "Smith 2010",     desc: "Plasma protein binding review · CLASS-MEDIAN substrate anchor" },
                { ref: "ICH M3(R2)",     desc: "Allometric scaling and species selection conventions" },
              ].map(({ ref, desc }) => (
                <div key={ref} className="border border-white/8 rounded-lg px-3 py-2 grid grid-cols-[140px_1fr] gap-3 items-start">
                  <div className="text-[11px] font-bold text-cyan-300">{ref}</div>
                  <div className="text-[11px] text-slate-500">{desc}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/4 p-6">
              <div className="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold mb-4">IVIVE pipeline · 10 stages</div>
              <div className="space-y-1.5 font-mono text-[11px]">
                {PIPELINE_STEPS.map(([stage, name, tag, color]) => (
                  <div key={stage} className="flex items-center gap-3 rounded-md border border-white/8 bg-white/[0.02] px-3 py-2">
                    <div className="w-5 text-[10px] text-slate-500">{stage}</div>
                    <div className={`flex-1 ${color}`}>{name}</div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-500">{tag}</div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-600 text-center mt-4">
                IVIVE Gate · L2 ConfirmationBlock in · L3 Animal Cohort enabled out · sealed at every step
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Handoff & sign-off ─────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 md:px-8 py-16 border-b border-white/5">
        <div className="text-[10px] uppercase tracking-widest text-amber-400 font-semibold mb-2">The handoff</div>
        <h2 className="text-[28px] font-black tracking-tight text-white mb-3">Hard blocks. Soft warns. Explicit sign-off.</h2>
        <p className="text-[14px] text-slate-400 leading-relaxed max-w-3xl mb-8">
          The transition from in-silico / ex-vivo confirmation into animal-cohort design is not a button click. The IVIVE
          Output Handoff page surfaces every alert the gate assembles, separates blocks from warnings, and captures the
          sign-off as a tamper-evident record consumed by animal-cohort study design and first-in-human readiness.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-rose-500/25 bg-rose-500/5 p-5">
            <div className="text-[12px] font-bold text-rose-300 mb-2">Hard blocks · cannot be acknowledged away</div>
            <ul className="text-[12px] text-slate-400 space-y-1.5">
              <li>• In-vitro twin has not been run</li>
              <li>• In-vitro verdict is NO-GO</li>
              <li>• Insufficient tier (no human fu_p)</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5">
            <div className="text-[12px] font-bold text-amber-300 mb-2">Soft warns · require per-alert acknowledgment</div>
            <ul className="text-[12px] text-slate-400 space-y-1.5">
              <li>• In-silico confirmation block not yet sealed</li>
              <li>• Cross-species rule met only with estimates</li>
              <li>• Substrate mode is class-median or mixed</li>
              <li>• fu_mic missing (Obach correction skipped)</li>
              <li>• HAIOps safety flag with reviewRequired</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-5">
            <div className="text-[12px] font-bold text-emerald-300 mb-2">Sign-off payload · captured per release</div>
            <ul className="text-[12px] text-slate-400 space-y-1.5">
              <li>• Name + role + ISO timestamp</li>
              <li>• Justification text</li>
              <li>• Acknowledged alert IDs</li>
              <li>• Substrate mode (literature / in-house / class-median / mixed)</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-white/8 bg-white/[0.02] p-4">
          <div className="text-[11px] text-slate-500 leading-relaxed">
            The substrate mode at sign-off propagates downstream. Animal-cohort study design tags its outputs with the
            confidence band that was sealed here, and first-in-human readiness reads it again before MABEL projection.
            A run sealed on class-median substrate is not silently identical to a run sealed on literature or in-house substrate — it is auditable
            as such all the way through to the IND-enabling package.
          </div>
        </div>
      </section>

      {/* ── Zero-Lab recalibration substrate ───────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 md:px-8 py-16 border-b border-white/5">
        <div className="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold mb-2">Zero-Lab recalibration substrate</div>
        <h2 className="text-[28px] font-black tracking-tight text-white mb-3">Calibration targets are named public corpora — not chip-vendor data.</h2>
        <p className="text-[14px] text-slate-400 leading-relaxed max-w-3xl mb-3">
          Because HakaseAI is a 100% Zero-Lab cascade, calibration is anchored to public datasets the regulator already recognises.
          The intent is for the IVIVE engine version stamp to record the calibration set + per-corpus fold-error band alongside the version itself.
        </p>
        <div className="mb-8 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 flex items-start gap-2 max-w-3xl">
          <div className="w-1 h-1 rounded-full bg-amber-400 mt-[7px] shrink-0" />
          <div className="text-[11px] text-slate-400 leading-relaxed">
            <span className="text-amber-300 font-semibold">Status.</span> The corpora below are the named calibration targets of record.
            Automated ingestion + per-version fold-error reporting is a scheduled follow-up; the version-stamp format below is the target shape, not the current runtime output.
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { name: "FDA Drug Approval Packages (DAPs)",       role: "LITERATURE substrate + recalibration corpus", note: "Clin-pharm reviews with measured human PK · ~1,000+ approved compounds · regulator-grade ground truth" },
            { name: "Obach 1999 IVIVE benchmark",              role: "Recalibration corpus",                        note: "29 compounds with CL_int + fu + observed CL · the canonical IVIVE evaluation set" },
            { name: "Hosea 2009 / Wang 2010 IVIVE extensions", role: "Recalibration corpus",                        note: "Extended IVIVE benchmark sets · validates beyond Obach's 29" },
            { name: "DrugBank PK panel",                       role: "LITERATURE substrate",                        note: "Human PK across marketed drugs · broad coverage, lower per-record curation" },
            { name: "PK-DB (UKonstanz)",                       role: "LITERATURE substrate",                        note: "Curated human PK with study metadata · academically structured" },
            { name: "Open TG-GATEs",                           role: "Cross-species recalibration",                 note: "Human + rat hepatocyte toxicogenomics · CL_int proxies for cross-species translation" },
            { name: "eTRANSAFE",                               role: "Cross-species recalibration",                 note: "EMA-led translational safety database · regulator-recognised provenance" },
            { name: "Lombardo 2018 / Smith 2010",              role: "CLASS-MEDIAN anchors",                        note: "Drug-class fu_p / PPB medians · runnable fallback only · does not satisfy the cross-species rule" },
          ].map(({ name, role, note }) => (
            <div key={name} className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
              <div className="flex items-baseline justify-between gap-3 mb-1.5">
                <div className="text-[13px] font-bold text-cyan-200">{name}</div>
                <div className="text-[9px] uppercase tracking-wider text-amber-300/80 font-mono shrink-0">{role}</div>
              </div>
              <div className="text-[11px] text-slate-500 leading-relaxed">{note}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-600 mt-6 leading-relaxed max-w-3xl">
          Target version-stamp shape (post-ingestion):
          <span className="font-mono text-slate-500"> v2.4.1 / Obach29 + Hosea50 / fold-error 1.8× geomean</span>. The intent is to seal this into the sign-off so the IND-enabling package can defend the choice of calibration substrate downstream.
        </p>
      </section>

      {/* ── First target area ──────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 md:px-8 py-16 border-b border-white/5">
        <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 via-transparent to-amber-500/5 p-8">
          <div className="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold mb-2">First target area</div>
          <h2 className="text-[26px] font-black tracking-tight text-white mb-3 max-w-3xl">
            IVIVE is the place HakaseAI is hardening first.
          </h2>
          <p className="text-[14px] text-slate-400 leading-relaxed max-w-3xl">
            The bridge from in-silico / ex-vivo confirmation into animal-cohort design is where most pre-clinical
            programmes either get the cross-species story right or quietly accept class-median substrate as if it were
            literature- or in-house-anchored. We treat it as the keystone gate of the platform: if IVIVE is not defensible, nothing downstream
            can be. Animal study design, NOAEL conversion, allometric HED, MABEL — all of it inherits whatever the IVIVE
            handoff sealed. Getting this layer right is the precondition for everything else HakaseAI promises.
          </p>
        </div>
      </section>

      {/* ── Cross-references ───────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 md:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => { navigate("/platform"); setTimeout(() => document.querySelector("#layer2")?.scrollIntoView({ behavior: "smooth" }), 150); }}
            className="text-left border border-white/8 hover:border-cyan-500/30 rounded-xl p-4 bg-white/[0.015] transition-colors group"
          >
            <div className="text-[10px] uppercase tracking-widest text-cyan-400 font-semibold mb-1">Upstream</div>
            <div className="text-[14px] font-bold text-white group-hover:text-cyan-200 transition-colors">In-Silico &amp; Ex-Vivo Confirmation</div>
            <div className="text-[11px] text-slate-500 mt-1">10-stage in-silico pipeline + virtual tissue-scale projection · sealed confirmation block</div>
          </button>
          <button
            onClick={() => { navigate("/platform"); setTimeout(() => document.querySelector("#layer3")?.scrollIntoView({ behavior: "smooth" }), 150); }}
            className="text-left border border-white/8 hover:border-amber-500/30 rounded-xl p-4 bg-white/[0.015] transition-colors group"
          >
            <div className="text-[10px] uppercase tracking-widest text-amber-400 font-semibold mb-1">Downstream</div>
            <div className="text-[14px] font-bold text-white group-hover:text-amber-200 transition-colors">Animal Cohort Studies</div>
            <div className="text-[11px] text-slate-500 mt-1">Multi-species PBPK · BCS-aware formulation · NOAEL · allometric HED</div>
          </button>
          <button
            onClick={() => navigate("/regulatory")}
            className="text-left border border-white/8 hover:border-blue-500/30 rounded-xl p-4 bg-white/[0.015] transition-colors group"
          >
            <div className="text-[10px] uppercase tracking-widest text-blue-400 font-semibold mb-1">Governance</div>
            <div className="text-[14px] font-bold text-white group-hover:text-blue-200 transition-colors">Regulatory Intelligence</div>
            <div className="text-[11px] text-slate-500 mt-1">How sealed sign-off + substrate mode flow into the IND-enabling package</div>
          </button>
        </div>
      </section>
    </div>
  );
}
