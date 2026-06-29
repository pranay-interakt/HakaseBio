import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Section } from "@/components/Section";
import { getAllPosts } from "@/lib/posts";

export const metadata = {
  title: "Blog · Hakase",
  description: "Engineering posts, founder essays, and field notes from teams running real programs on Hakase."
};

export default function BlogIndex() {
  const posts = getAllPosts();
  const [feature, ...rest] = posts;

  return (
    <>
      <section className="pt-32 md:pt-44">
        <div className="container-x grid gap-10 md:grid-cols-12">
          <div className="md:col-span-9">
            <div className="accent rise rise-1">Field notes</div>
            <h1 className="h1 mt-5 rise rise-2">The Hakase blog.</h1>
            <p className="lede mt-6 max-w-2xl rise rise-3">
              Engineering posts, founder essays, and field notes from teams running real
              programs on the platform. No content marketing.
            </p>
          </div>
        </div>
      </section>

      {feature && (
        <Section className="!pt-12">
          <Link href={`/blog/${feature.slug}`} className="group block">
            <article className="grid gap-px overflow-hidden rounded-2xl border border-ink-100 bg-ink-100 md:grid-cols-12">
              <div className="bg-white p-8 md:col-span-7 md:p-12">
                <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-mono text-ink-500">
                  <span className="text-cyan-700">Featured</span>
                  <span className="h-1 w-1 rounded-full bg-ink-300" />
                  <span>{feature.tag}</span>
                  <span className="h-1 w-1 rounded-full bg-ink-300" />
                  <time>{fmt(feature.date)}</time>
                </div>
                <h2 className="h2 mt-5">{feature.title}</h2>
                <p className="lede mt-5">{feature.description}</p>
                <div className="mt-8 inline-flex items-center gap-1 text-sm font-medium text-ink-900 transition group-hover:gap-2">
                  Read post <ArrowRight className="h-4 w-4" />
                </div>
              </div>
              <div className="hidden bg-white p-12 md:col-span-5 md:block">
                <div className="grid h-full place-items-center rounded-xl border border-ink-100 bg-ink-50 p-10">
                  <div className="text-center">
                    <div className="font-mono text-[11px] uppercase tracking-mono text-ink-500">{feature.readTime}</div>
                    <div className="mt-2 font-display text-2xl text-ink-900">— {feature.author}</div>
                  </div>
                </div>
              </div>
            </article>
          </Link>
        </Section>
      )}

      <Section className="!pt-0">
        <div className="grid gap-px overflow-hidden rounded-2xl border border-ink-100 bg-ink-100 md:grid-cols-2 lg:grid-cols-3">
          {rest.map((p) => (
            <Link key={p.slug} href={`/blog/${p.slug}`} className="group bg-white p-7 transition hover:bg-ink-50">
              <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-mono text-ink-500">
                <span className="text-cyan-700">{p.tag}</span>
                <span className="h-1 w-1 rounded-full bg-ink-300" />
                <time>{fmt(p.date)}</time>
              </div>
              <div className="mt-5 font-display text-xl leading-snug text-ink-900">{p.title}</div>
              <p className="mt-3 text-sm leading-relaxed text-ink-600">{p.description}</p>
              <div className="mt-6 flex items-center justify-between text-xs text-ink-500">
                <span>{p.readTime}</span>
                <ArrowUpRight className="h-4 w-4 text-ink-700 opacity-0 transition group-hover:opacity-100" />
              </div>
            </Link>
          ))}
        </div>
      </Section>

      <Section>
        <div className="rounded-2xl border border-ink-100 bg-white p-8 md:p-12">
          <div className="grid items-end gap-6 md:grid-cols-2">
            <div>
              <div className="mono-label">Pitch us a topic</div>
              <h3 className="h3 mt-3">Have something you&apos;d like covered?</h3>
              <p className="mt-2 text-ink-600">We publish what teams ask us about.</p>
            </div>
            <div className="md:text-right">
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

function fmt(d: string) {
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
