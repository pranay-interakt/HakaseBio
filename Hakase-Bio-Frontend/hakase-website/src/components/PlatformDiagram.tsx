import Link from "next/link";
import { PRODUCTS } from "@/lib/products";

const MARKETS = [
  "Biotech & Pharma R&D",
  "Clinical Trial Sponsors",
  "Commercial Teams",
  "Care Providers",
  "Regulators & Affairs"
];

const ENGINE = [
  { title: "Digital Workforce", body: "35 specialist agents · 4 swarms · 4 BioDigital Twin curators." },
  { title: "Gate Service",      body: "Falsifier registry. Evidence ladder. Predict-then-confirm enforcement." },
  { title: "DAaaS Delivery",    body: "Per-deliverable, per-stage, per-trial. Tenant-isolated, privacy-first." }
];

const FOUNDATION = [
  { title: "Pre-trained foundation models", body: "Proteina-Complexa structures · cellular & tissue-expression priors · PBPK + IVIVE translation engines." },
  { title: "Knowledge & public data",       body: "Literature · GTEx · Tabula Sapiens · DrugBank · MIMIC · CDC · HCUP · NHS Digital." },
  { title: "Customer confirmation data",    body: "Wet-lab / CRO / animal readouts used as ground truth — never as training data." }
];

export default function PlatformDiagram() {
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
      {/* Markets */}
      <Strip label="Markets served">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {MARKETS.map((m) => (
            <div key={m} className="rounded-md border border-ink-100 px-3 py-2.5 text-xs text-ink-700">
              {m}
            </div>
          ))}
        </div>
      </Strip>

      {/* Modules */}
      <Strip label="Product modules">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {PRODUCTS.map((p, i) => (
            <Link
              key={p.slug}
              href={`/products/${p.slug}`}
              className="group rounded-md border border-ink-100 p-3 transition hover:border-cyan-200 hover:bg-cyan-50/40"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-mono text-ink-400">0{i + 1}</span>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-500" />
              </div>
              <div className="mt-2 text-sm font-medium text-ink-900">{p.name}</div>
              <div className="mt-0.5 text-[11px] text-ink-500">{p.short}</div>
              <div className="mt-3 text-[11px] font-medium text-ink-700 opacity-0 transition group-hover:opacity-100">
                Open module →
              </div>
            </Link>
          ))}
        </div>
      </Strip>

      {/* Engine */}
      <div className="border-t border-ink-100 bg-ink-900 px-5 py-6 text-white md:px-8 md:py-8">
        <div className="font-mono text-[11px] uppercase tracking-mono text-cyan-200">Core engine</div>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
          <div className="font-display text-2xl md:text-3xl">HakaseAI</div>
          <div className="font-mono text-[11px] uppercase tracking-mono text-cyan-200/80">
            HAIOps · orchestration · gates · governance · audit
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {ENGINE.map((b) => (
            <div key={b.title} className="rounded-md border border-white/10 bg-white/[0.04] p-4">
              <div className="text-sm font-medium">{b.title}</div>
              <div className="mt-1.5 text-xs text-white/70">{b.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Foundation */}
      <Strip label="Foundation — pre-trained models & data">
        <div className="grid gap-3 md:grid-cols-3">
          {FOUNDATION.map((f) => (
            <div key={f.title} className="rounded-md border border-ink-100 p-4">
              <div className="text-sm font-medium text-ink-900">{f.title}</div>
              <div className="mt-1.5 text-xs text-ink-500">{f.body}</div>
            </div>
          ))}
        </div>
      </Strip>

      <div className="border-t border-ink-100 px-5 py-4 text-center text-[11px] text-ink-500 md:px-8">
        The engine never trains on customer data. Every prediction is gated, falsifiable, and confirmation-tracked.
      </div>
    </div>
  );
}

function Strip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-ink-100 px-5 py-6 first:border-t-0 md:px-8 md:py-8">
      <div className="mono-label">{label}</div>
      <div className="mt-4">{children}</div>
    </div>
  );
}
