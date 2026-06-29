import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import HeroVisual from "@/components/HeroVisual";
import PlatformDiagram from "@/components/PlatformDiagram";
import Ticker from "@/components/Ticker";
import Counter from "@/components/Counter";
import Reveal from "@/components/Reveal";
import { Section, SectionHeader } from "@/components/Section";
import { PRODUCTS } from "@/lib/products";

export default function HomePage() {
  return (
    <>
      {/* ───────────────────────────── HERO ───────────────────────────── */}
      <section className="relative pt-28 md:pt-36">
        <div className="container-x">
          <div className="grid items-center gap-12 md:grid-cols-12">
            <div className="md:col-span-7">
              <div className="accent rise rise-1">Purpose-built intelligence · life sciences</div>
              <h1 className="h1 mt-5 rise rise-2">
                The operating system <br className="hidden md:inline" />
                for drug development.
              </h1>
              <p className="lede mt-6 max-w-xl rise rise-3">
                Hakase replaces the patchwork of point tools across discovery, trials,
                commercial, care and regulatory with a single self-improving engine —
                where every prediction ships with its falsifier.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3 rise rise-4">
                <Link href="/contact" className="btn-primary">
                  Request a demo <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/products" className="btn-ghost">
                  Tour the platform <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="mt-8 rise rise-5">
                <Trusted />
              </div>
            </div>
            <div className="md:col-span-5">
              <div className="relative aspect-square w-full rise rise-3">
                <HeroVisual className="absolute inset-0" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────────────── METRICS ───────────────────────────── */}
      <Section className="!pt-12 !pb-12">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-ink-100 bg-ink-100 md:grid-cols-4">
          <Metric value={<><Counter to={40} suffix="%" /></>} label="Faster trial cycles" sub="median across sponsors" />
          <Metric value={<><span>$</span><Counter to={2.1} decimals={1} suffix="M" /></>} label="Annual cost savings" sub="per Phase 2/3 program" />
          <Metric value={<><Counter to={85} suffix="%" /></>} label="Patient retention" sub="across care deployments" />
          <Metric value={<><Counter to={92} suffix="%" /></>} label="Cross-assay accuracy" sub="vs. held-out CROs" />
        </div>
      </Section>

      <Ticker />

      {/* ───────────────────────────── POSITIONING ───────────────────────────── */}
      <Section>
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <Reveal><div className="accent">The problem</div></Reveal>
            <Reveal delay={80}>
              <h2 className="h2 mt-4">
                Drug development still runs on stitched-together tools that don&apos;t talk to each other.
              </h2>
            </Reveal>
          </div>
          <div className="md:col-span-7">
            <Reveal delay={120}>
              <p className="lede">
                Every group along the pipeline — discovery, clinical, commercial, care, regulatory — has
                its own stack, its own definitions, its own definition of &quot;done.&quot; Evidence loses
                provenance at every hand-off. The result is slower trials, weaker submissions, and
                models that drift quietly out of reality.
              </p>
              <p className="lede mt-5">
                Hakase is built around a different default: <strong className="text-ink-900">one engine,
                one evidence ladder, one set of gates.</strong> A discovery prediction can travel cleanly
                into a Phase 2 protocol and a regulatory dossier without losing its falsifier.
              </p>
            </Reveal>
          </div>
        </div>

        <div className="mt-16 grid gap-4 md:grid-cols-3">
          {[
            { k: "01", t: "Predict-then-confirm", d: "Every output ships with its falsifier and a confirmation slot. Wet-lab and clinical results close the loop automatically." },
            { k: "02", t: "Self-improving HAIOps", d: "Orchestration, gates, governance and signed audit — promoted to a shared control plane so every module inherits the same discipline." },
            { k: "03", t: "DAaaS, not seat licenses", d: "Drug-Acceleration-as-a-Service: pay per deliverable, per stage, per trial. Tenant-isolated by default. The engine never trains on your data." }
          ].map((f, i) => (
            <Reveal key={f.k} delay={i * 80}>
              <div className="card-flat h-full">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-mono text-ink-400">{f.k}</span>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-500" />
                </div>
                <div className="mt-5 text-lg font-medium text-ink-900">{f.t}</div>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{f.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ───────────────────────────── PLATFORM DIAGRAM ───────────────────────────── */}
      <Section>
        <SectionHeader
          label="Platform direction"
          title={<>One engine. Five modules.<br/>Composed for every stage of the program.</>}
          lede="Build the engine once. Let each module compose its agents, gates and evidence packs from the same foundation."
        />
        <Reveal delay={120}>
          <div className="mt-12">
            <PlatformDiagram />
          </div>
        </Reveal>
      </Section>

      {/* ───────────────────────────── MODULES GRID ───────────────────────────── */}
      <Section>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeader label="Modules" title={<>Built for every stage of the pipeline.</>} />
          <Link href="/products" className="btn-ghost">
            See all modules <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-ink-100 bg-ink-100 md:grid-cols-2 lg:grid-cols-3">
          {PRODUCTS.map((p, i) => (
            <Link
              key={p.slug}
              href={`/products/${p.slug}`}
              className="group flex h-full flex-col justify-between bg-white p-7 transition hover:bg-ink-50"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-mono text-ink-400">0{i + 1} / 05</span>
                  <span className="font-mono text-[11px] uppercase tracking-mono text-cyan-700">{p.short.split(" · ")[0]}</span>
                </div>
                <div className="mt-6 text-xl font-medium text-ink-900">{p.name}</div>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{p.oneLiner}</p>
              </div>
              <div className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-ink-900 transition group-hover:gap-2">
                Open module <ArrowUpRight className="h-4 w-4" />
              </div>
            </Link>
          ))}
        </div>
      </Section>

      {/* ───────────────────────────── HAIOPS / DAAAS ───────────────────────────── */}
      <Section>
        <div className="grid gap-6 md:grid-cols-2">
          <Reveal>
            <article className="card-flat h-full">
              <div className="accent">HAIOps</div>
              <h3 className="h3 mt-4">The control plane that keeps the platform honest.</h3>
              <p className="mt-4 text-ink-600">
                HAIOps runs the digital workforce, enforces the falsifier registry, and stitches every
                prediction to its eventual confirmation. Audit trails are signed, versioned, and
                exportable — ready for V&amp;V40 and MID3 review.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-ink-700">
                <Bullet>35 specialist agents · 4 swarms · 4 BioDigital Twin curators</Bullet>
                <Bullet>Evidence ladder with required confirmation slots</Bullet>
                <Bullet>Predict-then-confirm enforcement at every layer</Bullet>
              </ul>
            </article>
          </Reveal>
          <Reveal delay={100}>
            <article className="card-flat h-full">
              <div className="accent">DAaaS</div>
              <h3 className="h3 mt-4">Drug acceleration on a per-deliverable contract.</h3>
              <p className="mt-4 text-ink-600">
                Drug-Acceleration-as-a-Service prices Hakase the way teams consume it — per
                deliverable, per stage, per trial. No seats, no shelfware. The engine never trains
                on customer data; confirmations are ground truth, not training fuel.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-ink-700">
                <Bullet>Tenant-isolated by default · HIPAA · GDPR · GxP</Bullet>
                <Bullet>Wet-lab / CRO / animal readouts used as ground truth</Bullet>
                <Bullet>Mapped to GCC, FDA, EMA and PMDA expectations</Bullet>
              </ul>
            </article>
          </Reveal>
        </div>
      </Section>

      {/* ───────────────────────────── CTA ───────────────────────────── */}
      <Section>
        <Reveal>
          <div className="overflow-hidden rounded-2xl bg-ink-900 px-8 py-14 text-white md:px-14 md:py-20">
            <div className="grid items-end gap-10 md:grid-cols-2">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-mono text-cyan-300">Working session, not a sales call</div>
                <h3 className="h2 mt-4 text-white">
                  Bring Hakase to your next program.
                </h3>
              </div>
              <div className="md:text-right">
                <p className="text-white/70">
                  Tell us what you&apos;re working on. We&apos;ll set up a working session and walk
                  through a real falsifier on your data.
                </p>
                <div className="mt-6 flex flex-wrap gap-3 md:justify-end">
                  <Link href="/contact?topic=demo" className="btn bg-white text-ink-900 hover:bg-ink-100">
                    Request a demo <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/contact?topic=partner" className="btn border border-white/20 bg-white/5 text-white hover:bg-white/10">
                    Partner with us
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </Section>
    </>
  );
}

function Metric({ value, label, sub }: { value: React.ReactNode; label: string; sub?: string }) {
  return (
    <div className="bg-white p-7">
      <div className="font-display text-4xl tracking-tight text-ink-900 md:text-5xl">{value}</div>
      <div className="mt-3 text-sm font-medium text-ink-900">{label}</div>
      {sub && <div className="mt-1 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-2 inline-block h-1 w-1 flex-none rounded-full bg-cyan-500" />
      <span>{children}</span>
    </li>
  );
}

function Trusted() {
  const names = ["Discovery", "Clinical Ops", "Pharmacovigilance", "Market Access", "Regulatory"];
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <span className="mono-label">Built for</span>
      {names.map((n) => (
        <span key={n} className="text-sm text-ink-600">{n}</span>
      ))}
    </div>
  );
}
