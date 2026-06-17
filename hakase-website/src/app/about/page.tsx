import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Section, SectionHeader } from "@/components/Section";
import Reveal from "@/components/Reveal";

const VALUES = [
  { k: "01", t: "Falsifiable by default", d: "If a prediction can't be tested, it doesn't ship. Every claim carries its falsifier and confirmation slot." },
  { k: "02", t: "Customer data is sacred", d: "The engine never trains on tenant data. Confirmations are used as ground truth — not as training fuel." },
  { k: "03", t: "Compose, don't fork",     d: "One engine, many modules. A prediction in discovery has to be the same object regulators read in the dossier." },
  { k: "04", t: "Bench-aware AI",          d: "We design with the wet-lab loop in mind — IVIVE, PBPK, V&V40 — so models talk to instruments and not just dashboards." },
  { k: "05", t: "Agency-mapped",           d: "GCC, FDA, EMA, PMDA. Submission-ready evidence packs without translation tax." },
  { k: "06", t: "Outcomes over seats",     d: "DAaaS pricing aligned to deliverables and confirmations — not platform real estate." }
];

const TIMELINE = [
  { tag: "Origin",   t: "A bench-side problem", d: "Hakase started as a tool to keep wet-lab cycles from drowning out hypothesis quality." },
  { tag: "Engine",   t: "HakaseAI takes shape", d: "The HAIOps control plane formalizes gates, falsifiers and signed audit." },
  { tag: "Modules",  t: "Bio + Clinical ship",  d: "The pre-clinical BioDigital Twin and end-to-end clinical trial operations go to first customers." },
  { tag: "Today",    t: "Five modules, one foundation", d: "Commz, Care and Regdoks complete the molecule-to-market loop." },
  { tag: "Next",     t: "DAaaS at scale",       d: "Drug-Acceleration-as-a-Service, mapped to four agencies and a growing set of indications." }
];

export const metadata = {
  title: "About · Hakase",
  description: "Hakase is building the self-improving engine for life sciences."
};

export default function AboutPage() {
  return (
    <>
      {/* HERO */}
      <section className="pt-32 md:pt-44">
        <div className="container-x grid gap-10 md:grid-cols-12">
          <div className="md:col-span-9">
            <div className="accent rise rise-1">About Hakase</div>
            <h1 className="h1 mt-5 rise rise-2">
              We&apos;re building the self-improving engine for life sciences.
            </h1>
            <p className="lede mt-6 max-w-2xl rise rise-3">
              Hakase is the operating system underneath modern drug development —
              from in-silico cascades to launched therapies to evidence-backed care. We
              replace tool sprawl with one engine that learns, audits and ships.
            </p>
          </div>
        </div>
      </section>

      {/* MISSION + VISION */}
      <Section>
        <div className="grid gap-px overflow-hidden rounded-2xl border border-ink-100 bg-ink-100 md:grid-cols-2">
          <div className="bg-white p-10">
            <div className="mono-label">Mission</div>
            <h2 className="h3 mt-4">
              Make every prediction in life sciences falsifiable, auditable, and useful.
            </h2>
            <p className="mt-5 text-ink-600">
              The default mode of AI in pharma is &quot;score and serve&quot; — a model ranks options, a
              team picks one, and the model is rarely told whether the chosen option worked. We
              invert that. Every Hakase output is paired with the experiment that would prove it
              wrong. When the result lands, the engine updates.
            </p>
          </div>
          <div className="bg-white p-10">
            <div className="mono-label">Vision</div>
            <h2 className="h3 mt-4">
              Drugs that reach patients faster, safer, and cheaper — because the science was confirmed at every step.
            </h2>
            <p className="mt-5 text-ink-600">
              We picture a single engine where a discovery hypothesis travels cleanly to a Phase 2
              protocol, to a payer dossier, to a bedside care pathway — without losing its
              provenance. Patients get the right therapies sooner; programs spend less time
              defending decisions that the evidence already justifies.
            </p>
          </div>
        </div>
      </Section>

      {/* VALUES */}
      <Section>
        <SectionHeader
          label="What we hold true"
          title={<>Six principles. Zero exceptions.</>}
        />
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-ink-100 bg-ink-100 md:grid-cols-2 lg:grid-cols-3">
          {VALUES.map((v) => (
            <div key={v.k} className="bg-white p-7">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11px] uppercase tracking-mono text-ink-400">{v.k}</span>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-500" />
              </div>
              <div className="mt-5 text-lg font-medium text-ink-900">{v.t}</div>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{v.d}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* TIMELINE */}
      <Section>
        <SectionHeader
          label="The arc"
          title={<>From a bench-side irritation to a platform direction.</>}
        />
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-ink-100 bg-ink-100">
          {TIMELINE.map((s, i) => (
            <Reveal key={s.tag} delay={i * 60}>
              <div className="grid items-baseline gap-6 bg-white p-7 md:grid-cols-12 md:p-9">
                <div className="md:col-span-2">
                  <div className="mono-label">{s.tag}</div>
                </div>
                <div className="md:col-span-4">
                  <div className="font-display text-xl text-ink-900">{s.t}</div>
                </div>
                <div className="md:col-span-6 text-ink-600">{s.d}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* CTA */}
      <Section>
        <div className="rounded-2xl border border-ink-100 bg-white p-10 md:p-14">
          <div className="grid items-end gap-6 md:grid-cols-2">
            <h3 className="h3">Want to build with us?</h3>
            <div className="flex md:justify-end">
              <Link href="/contact" className="btn-primary">
                Reach out <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
