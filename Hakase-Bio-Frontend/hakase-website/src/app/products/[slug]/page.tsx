import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { PRODUCTS, getProduct } from "@/lib/products";
import { Section } from "@/components/Section";
import Reveal from "@/components/Reveal";
import HeroVisual from "@/components/HeroVisual";

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const p = getProduct(params.slug);
  if (!p) return {};
  return {
    title: `${p.name} · Hakase`,
    description: p.description
  };
}

export default function ProductPage({ params }: { params: { slug: string } }) {
  const p = getProduct(params.slug);
  if (!p) return notFound();

  const others = PRODUCTS.filter((x) => x.slug !== p.slug).slice(0, 3);

  return (
    <>
      {/* HERO */}
      <section className="pt-28 md:pt-36">
        <div className="container-x">
          <div className="flex items-center gap-2 text-xs text-ink-500">
            <Link href="/products" className="hover:text-cyan-700">Platform</Link>
            <span>/</span>
            <span className="text-ink-700">{p.name}</span>
          </div>

          <div className="mt-10 grid items-center gap-12 md:grid-cols-12">
            <div className="md:col-span-7">
              <div className="accent rise rise-1">{p.short}</div>
              <h1 className="h1 mt-5 rise rise-2">{p.name}.</h1>
              <p className="lede mt-6 max-w-2xl rise rise-3">{p.description}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3 rise rise-4">
                <Link href="/contact?topic=demo" className="btn-primary">
                  Request a demo <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/contact?topic=partner" className="btn-ghost">
                  Talk to an engineer <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="mt-8 rise rise-5">
                <div className="mono-label">Market</div>
                <div className="mt-1 text-sm text-ink-700">{p.market}</div>
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

      {/* METRICS */}
      <Section className="!pt-12 !pb-8">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-ink-100 bg-ink-100 md:grid-cols-3">
          {p.metrics.map((m) => (
            <div key={m.label} className="bg-white p-7">
              <div className="font-display text-4xl text-ink-900 md:text-5xl">{m.value}</div>
              <div className="mt-3 text-sm font-medium text-ink-900">{m.label}</div>
              {m.sub && <div className="mt-1 text-xs text-ink-500">{m.sub}</div>}
            </div>
          ))}
        </div>
      </Section>

      {/* CAPABILITIES */}
      <Section>
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-4">
            <div className="accent">Capabilities</div>
            <h2 className="h2 mt-4">What ships in {p.name}.</h2>
            <p className="lede mt-4">
              Composable with the rest of the Hakase platform — same engine, same falsifier registry,
              same DAaaS delivery layer.
            </p>
          </div>
          <div className="md:col-span-8">
            <div className="grid gap-px overflow-hidden rounded-2xl border border-ink-100 bg-ink-100 sm:grid-cols-2">
              {p.capabilities.map((c, i) => (
                <Reveal key={c.title} delay={i * 50}>
                  <div className="bg-white p-7 h-full">
                    <div className="font-mono text-[11px] uppercase tracking-mono text-ink-400">0{i + 1}</div>
                    <div className="mt-3 text-lg font-medium text-ink-900">{c.title}</div>
                    <p className="mt-2 text-sm leading-relaxed text-ink-600">{c.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* OPTIONAL LAYERS */}
      {p.layers && (
        <Section className="!pt-0">
          <div className="grid gap-px overflow-hidden rounded-2xl border border-ink-100 bg-ink-100 md:grid-cols-3">
            {p.layers.map((l) => (
              <div key={l.code} className="bg-white p-8">
                <div className="font-mono text-[11px] uppercase tracking-mono text-cyan-700">{l.code} — {l.name}</div>
                <p className="mt-4 text-ink-600">{l.body}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* OTHER MODULES */}
      <Section>
        <div className="flex items-end justify-between gap-6">
          <h3 className="h3">Composes with the rest of Hakase.</h3>
          <Link href="/products" className="btn-ghost">
            All modules <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-ink-100 bg-ink-100 md:grid-cols-3">
          {others.map((o) => (
            <Link key={o.slug} href={`/products/${o.slug}`} className="group bg-white p-7 transition hover:bg-ink-50">
              <div className="font-mono text-[11px] uppercase tracking-mono text-cyan-700">{o.short}</div>
              <div className="mt-3 text-lg font-medium text-ink-900">{o.name}</div>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{o.oneLiner}</p>
              <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-ink-900 transition group-hover:gap-2">
                Explore <ArrowUpRight className="h-4 w-4" />
              </div>
            </Link>
          ))}
        </div>
      </Section>

      {/* CTA */}
      <Section>
        <div className="overflow-hidden rounded-2xl bg-ink-900 px-8 py-14 text-white md:px-14 md:py-20">
          <div className="grid items-end gap-8 md:grid-cols-2">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-mono text-cyan-300">Learn or partner</div>
              <h3 className="h2 mt-4 text-white">Bring {p.name} to your program.</h3>
            </div>
            <div className="md:text-right">
              <p className="text-white/70">
                We&apos;ll scope a DAaaS engagement against your next milestone, run a falsifier on
                your data, and ship the evidence pack with it.
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
      </Section>
    </>
  );
}
