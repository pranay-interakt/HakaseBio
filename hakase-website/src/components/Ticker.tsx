const ITEMS = [
  "HAIOps", "DAaaS — Drug Acceleration as a Service", "Predict-then-Confirm",
  "Falsifier Registry", "V&V40 · MID3", "Tenant-isolated", "Zero-Lab Cascade",
  "BioDigital Twin", "Evidence Ladder", "Signed Audit Trail"
];

export default function Ticker() {
  return (
    <div className="overflow-hidden border-y border-ink-100 bg-white">
      <div className="ticker flex w-max gap-12 py-4">
        {[...ITEMS, ...ITEMS, ...ITEMS].map((t, i) => (
          <span key={i} className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-mono text-ink-500">
            <span className="inline-block h-1 w-1 rounded-full bg-cyan-500" />
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
