"use client";
import { useState } from "react";
import { Mail, MapPin, ArrowRight, Check } from "lucide-react";

type Topic = "demo" | "partner" | "research" | "press";

const TOPICS: { id: Topic; label: string; sub: string }[] = [
  { id: "demo",     label: "Request a demo",         sub: "Walk through Hakase on a real workflow from your team." },
  { id: "partner",  label: "Partner with Hakase",    sub: "Pharma, biotech, CROs, payers, academic centers." },
  { id: "research", label: "Research collaboration", sub: "Joint benchmarks, V&V40 evidence, publication." },
  { id: "press",    label: "Press & analysts",       sub: "Briefings, interviews, conference participation." }
];

export default function ContactPage() {
  const [topic, setTopic] = useState<Topic>("demo");
  const [sent, setSent] = useState(false);

  return (
    <>
      <section className="pt-32 md:pt-44">
        <div className="container-x grid gap-10 md:grid-cols-12">
          <div className="md:col-span-9">
            <div className="accent rise rise-1">Let&apos;s build together</div>
            <h1 className="h1 mt-5 rise rise-2">
              Reach out, partner with us, or just say hi.
            </h1>
            <p className="lede mt-6 max-w-2xl rise rise-3">
              Tell us what you&apos;re working on. We&apos;ll set up a working session — not a sales
              call — and walk through a real falsifier on your data.
            </p>
          </div>
        </div>
      </section>

      <section className="pb-28 pt-12">
        <div className="container-x grid gap-8 md:grid-cols-12">
          {/* TOPIC PICKER */}
          <div className="md:col-span-5">
            <div className="mono-label">What brings you here?</div>
            <div className="mt-4 grid gap-px overflow-hidden rounded-2xl border border-ink-100 bg-ink-100">
              {TOPICS.map((t) => {
                const active = topic === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTopic(t.id)}
                    className={`flex items-start justify-between gap-3 p-5 text-left transition ${
                      active ? "bg-ink-900 text-white" : "bg-white text-ink-900 hover:bg-ink-50"
                    }`}
                  >
                    <div>
                      <div className="font-display text-lg">{t.label}</div>
                      <div className={`mt-1 text-sm ${active ? "text-white/70" : "text-ink-500"}`}>{t.sub}</div>
                    </div>
                    {active && <Check className="mt-1 h-5 w-5 text-cyan-300" />}
                  </button>
                );
              })}
            </div>

            <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-6">
              <div className="mono-label">Direct</div>
              <div className="mt-3 flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-cyan-600" /> hello@hakase.ai
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-cyan-600" /> Distributed · GCC + US
              </div>
            </div>
          </div>

          {/* FORM */}
          <div className="md:col-span-7">
            <div className="rounded-2xl border border-ink-100 bg-white p-7 md:p-9">
              {sent ? (
                <div className="py-14 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-cyan-50">
                    <Check className="h-5 w-5 text-cyan-700" />
                  </div>
                  <div className="mt-5 font-display text-2xl">Got it — we&apos;ll be in touch.</div>
                  <p className="mt-2 text-ink-500">Most teams hear back within one business day.</p>
                </div>
              ) : (
                <form
                  onSubmit={(e) => { e.preventDefault(); setSent(true); }}
                  className="space-y-5"
                >
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field label="Name">
                      <input required className="input" placeholder="Your name" />
                    </Field>
                    <Field label="Work email">
                      <input required type="email" className="input" placeholder="you@company.com" />
                    </Field>
                    <Field label="Company">
                      <input required className="input" placeholder="Company or institution" />
                    </Field>
                    <Field label="Role">
                      <input className="input" placeholder="Title or function" />
                    </Field>
                  </div>
                  <Field label="What are you exploring?">
                    <textarea required rows={5} className="input resize-none" placeholder="Briefly, the problem you'd like Hakase to help with…" />
                  </Field>
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <div className="text-xs text-ink-500">
                      By submitting you agree to our privacy policy. We don&apos;t share, sell, or spam.
                    </div>
                    <button type="submit" className="btn-primary">
                      Send message <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          border-radius: 10px;
          border: 1px solid #DCE2EE;
          background: #ffffff;
          padding: 11px 13px;
          font-size: 14px;
          color: #0B1220;
          transition: border-color .15s, box-shadow .15s;
        }
        :global(.input:focus) {
          outline: none;
          border-color: #06B6D4;
          box-shadow: 0 0 0 4px rgba(34,211,238,0.12);
        }
        :global(.input::placeholder) { color: #8190AE; }
      `}</style>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mono-label mb-1.5">{label}</div>
      {children}
    </label>
  );
}
