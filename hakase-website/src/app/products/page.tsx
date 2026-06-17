import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Section, SectionHeader } from "@/components/Section";
import PlatformDiagram from "@/components/PlatformDiagram";
import Reveal from "@/components/Reveal";
import { PRODUCTS } from "@/lib/products";

export const metadata = {
  title: "Platform · Hakase",
  description: "One engine. Five modules. Composed for every stage of the drug development pipeline."
};

export default function ProductsIndex() {
  return (
    <>
      <section className="pt-32 md:pt-44">
        <div className="container-x grid gap-10 md:grid-cols-12">
          <div className="md:col-span-9">
            <div className="accent rise rise-1">Platform</div>
            <h1 className="h1 mt-5 rise rise-2">
              One engine. Five modules. <br className="hidden md:inline" />
              Composed for every stage of the program.
            </h1>
            <p className="lede mt-6 max-w-2xl rise rise-3">
              Each Hakase module ships with the same digital workforce, the same
              falsifier registry, and the same DAaaS delivery layer — so what you
              build in discovery still holds up at submission.
            </p>
          </div>
        </div>
      </section>

      <Section className="!pt-12">
        <PlatformDiagram />
      </Section>

      <Section>
        <SectionHeader label="The modules" title={<>Pick a module, or compose the platform.</>} />
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-ink-100 bg-ink-100 md:grid-cols-2">
          {PRODUCTS.map((p, i) => (
            <Reveal key={p.slug} delay={i * 60}>
              <Link
                href={`/products/${p.slug}`}
                className="group flex h-full flex-col justify-between bg-white p-8 transition hover:bg-ink-50 md:p-10"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] uppercase tracking-mono text-ink-400">0{i + 1} / 05</span>
                    <span className="font-mono text-[11px] uppercase tracking-mono text-cyan-700">{p.short}</span>
                  </div>
                  <div className="mt-8 font-display text-3xl text-ink-900">{p.name}</div>
                  <p className="mt-3 max-w-md text-ink-600">{p.description}</p>
                  <div className="mt-5 font-mono text-[11px] uppercase tracking-mono text-ink-500">
                    {p.market}
                  </div>
                </div>
                <div className="mt-8 inline-flex items-center gap-1 text-sm font-medium text-ink-900 transition group-hover:gap-2">
                  Open module <ArrowUpRight className="h-4 w-4" />
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </Section>
    </>
  );
}
