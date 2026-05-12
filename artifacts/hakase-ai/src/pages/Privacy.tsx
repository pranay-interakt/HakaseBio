import { NavBar } from "@/components/NavBar";
import { useLocation } from "wouter";

const LAST_UPDATED = "March 17, 2026";

interface Section {
  id: string;
  title: string;
  content: React.ReactNode;
}

function SectionBlock({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <div id={id} className="border border-white/8 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 bg-white/[0.025] border-b border-white/5">
        <div className="w-1 h-5 rounded-full bg-violet-500" />
        <h2 className="text-[16px] font-bold text-white">{title}</h2>
      </div>
      <div className="px-6 py-5 text-[13px] text-slate-400 leading-[1.8] space-y-4">
        {children}
      </div>
    </div>
  );
}

function Highlight({ children }: { children: React.ReactNode }) {
  return <span className="text-white font-medium">{children}</span>;
}

function Badge({ label, color }: { label: string; color: "emerald" | "blue" | "violet" | "amber" | "rose" }) {
  const cls = {
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
    blue:    "bg-blue-500/10 text-blue-400 border-blue-500/25",
    violet:  "bg-violet-500/10 text-violet-400 border-violet-500/25",
    amber:   "bg-amber-500/10 text-amber-400 border-amber-500/25",
    rose:    "bg-rose-500/10 text-rose-400 border-rose-500/25",
  }[color];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls} mr-2`}>{label}</span>;
}

export function Privacy() {
  const [, navigate] = useLocation();

  const toc = [
    { id: "overview", label: "Overview & Commitment" },
    { id: "data-collected", label: "What Data We Collect" },
    { id: "client-side", label: "Client-Side Processing" },
    { id: "third-party", label: "Third-Party APIs" },
    { id: "no-egress", label: "Zero Simulation Data Egress" },
    { id: "storage", label: "Local Storage & Sessions" },
    { id: "your-rights", label: "Your Rights" },
    { id: "security", label: "Security Measures" },
    { id: "changes", label: "Policy Changes" },
    { id: "contact", label: "Contact" },
  ];

  return (
    <div className="min-h-screen bg-[#07080c] text-white font-['Inter',sans-serif]">
      <NavBar />

      {/* Hero */}
      <div className="relative border-b border-white/5">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[250px] bg-violet-600/5 rounded-full blur-[100px]" />
        </div>
        <div className="relative z-10 max-w-4xl mx-auto px-6 md:px-8 pt-20 pb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-[12px] text-emerald-400 font-medium">Privacy-first by design</span>
          </div>
          <h1 className="text-[42px] md:text-[52px] font-black tracking-tight leading-tight mb-4">Privacy Policy</h1>
          <p className="text-[15px] text-slate-500">Last updated: {LAST_UPDATED}</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 md:px-8 py-12 grid md:grid-cols-[220px_1fr] gap-10">

        {/* Table of Contents */}
        <aside className="hidden md:block">
          <div className="sticky top-8 space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-3">Contents</div>
            {toc.map(({ id, label }) => (
              <a
                key={id}
                href={`#${id}`}
                className="block text-[12px] text-slate-500 hover:text-violet-400 transition-colors py-1 pl-2 border-l-2 border-transparent hover:border-violet-500"
              >
                {label}
              </a>
            ))}
          </div>
        </aside>

        {/* Content */}
        <div className="space-y-6">

          <SectionBlock id="overview" title="Overview & Commitment">
            <p>
              HakaseAI is a <Highlight>privacy-first biomedical simulation platform</Highlight>. Our core commitment is that
              your proprietary compound data, target information, and simulation inputs remain under your control at all times.
            </p>
            <p>
              We designed HakaseAI around a fundamental principle: <Highlight>your drug discovery data is yours</Highlight>.
              The platform is architected so that sensitive scientific inputs — molecular structures, target identities,
              simulation parameters — are processed locally in your browser and never transmitted to or stored on HakaseAI servers.
            </p>
            <div className="grid grid-cols-3 gap-3 mt-4">
              {[
                { icon: "🔒", label: "Client-side computation", sub: "Simulations run in your browser" },
                { icon: "🚫", label: "Zero data egress", sub: "Inputs never leave your device" },
                { icon: "🌐", label: "Public APIs only", sub: "Standard open data sources" },
              ].map(({ icon, label, sub }) => (
                <div key={label} className="border border-white/8 rounded-xl p-3 text-center bg-white/[0.01]">
                  <div className="text-2xl mb-2">{icon}</div>
                  <div className="text-[11px] font-semibold text-white mb-0.5">{label}</div>
                  <div className="text-[10px] text-slate-600">{sub}</div>
                </div>
              ))}
            </div>
          </SectionBlock>

          <SectionBlock id="data-collected" title="What Data We Collect">
            <p>HakaseAI collects the minimum information necessary to operate the platform:</p>
            <div className="space-y-3 mt-2">
              {[
                {
                  label: "Account information",
                  color: "violet" as const,
                  items: ["Email address (for login and account management)", "Display name (optional)", "Password (stored as a salted cryptographic hash — never plaintext)"],
                },
                {
                  label: "Usage analytics",
                  color: "blue" as const,
                  items: ["Anonymised session duration and page navigation events", "Feature usage frequency (aggregated, not per-user)", "Error reports (stack traces without user data)", "Browser type and operating system (anonymised)"],
                },
                {
                  label: "We do NOT collect",
                  color: "rose" as const,
                  items: ["Compound structures, SMILES strings, or chemical identities you enter", "Simulation results, trial parameters, or cohort configurations", "Target protein names or indication data", "Any biomedical data you input into the simulation platform"],
                },
              ].map(({ label, color, items }) => (
                <div key={label} className="border border-white/6 rounded-xl overflow-hidden">
                  <div className="px-4 py-2 bg-white/[0.02] border-b border-white/5 flex items-center gap-2">
                    <Badge label={label} color={color} />
                  </div>
                  <ul className="px-4 py-3 space-y-1.5">
                    {items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="mt-1.5 w-1 h-1 rounded-full bg-slate-600 flex-shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </SectionBlock>

          <SectionBlock id="client-side" title="Client-Side Processing">
            <p>
              The L1 In Vitro Twin runs <Highlight>entirely inside your browser</Highlight> on RDKit.js (WASM).
              L2 / L3 / L4 run server-side, but they only ever see <Highlight>Morgan fingerprint hashes and structured evidence</Highlight> —
              never your SMILES or molecular structures.
            </p>
            <div className="space-y-2 mt-3">
              {[
                { name: "L1 ADMET (Browser)", detail: "RDKit.js descriptors, Lipinski / Veber / QED / SAS, ML-augmented toxicity with confidence intervals — SMILES never transmitted" },
                { name: "L1 Cascade Gate (Browser)", detail: "HAIOps GO / WATCH / NO-GO + sealed EvidencePointer for L2 ingestion — runs locally before any server call" },
                { name: "L2 Confirmation (Server, fingerprints only)", detail: "ESM2 druggability, AutoDock Vina docking, opt-in FEP refinement — input is the fingerprint hash + EvidencePointer, not the structure" },
                { name: "L3 Animal Cohort PBPK (Server)", detail: "Multi-species PBPK + allometric scaling per ICH M3(R2) — uses fingerprint-keyed PK parameters, never the SMILES" },
                { name: "L4 Phase 1 Planner (Server)", detail: "MABEL-biased starting dose, IND gate, sealed PreClinicalPackage v2.0.0 handoff — operates on the structured L3 output, no structural data needed" },
              ].map(({ name, detail }) => (
                <div key={name} className="flex gap-3 border border-white/6 rounded-xl px-4 py-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-[5px] flex-shrink-0" />
                  <div>
                    <div className="text-[12px] font-semibold text-emerald-300 mb-0.5">{name}</div>
                    <div className="text-[12px] text-slate-500">{detail}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3">
              None of these engines transmit your inputs to any external server. The computation is <Highlight>ephemeral</Highlight> —
              it exists only for the duration of your browser session.
            </p>
          </SectionBlock>

          <SectionBlock id="third-party" title="Third-Party APIs">
            <p>
              HakaseAI queries several open biomedical APIs during simulation. When you enter a compound ID or target identifier,
              that identifier is used to fetch publicly available scientific data. Specifically:
            </p>
            <div className="space-y-2 mt-3">
              {[
                { api: "ChEMBL / PubChem / UniChem", query: "Compound IDs (e.g. CHEMBL123456, CID 2244) — publicly known chemical identifiers" },
                { api: "UniProt / RCSB PDB / AlphaFold", query: "Protein accession IDs (e.g. P24941) — publicly catalogued protein identifiers" },
                { api: "openFDA FAERS / Drugs@FDA / Labels", query: "Generic drug names (e.g. palbociclib) — publicly available drug names" },
              ].map(({ api, query }) => (
                <div key={api} className="border border-white/6 rounded-xl px-4 py-3 grid grid-cols-[120px_1fr] gap-3">
                  <div className="text-[11px] font-semibold text-violet-400">{api}</div>
                  <div className="text-[12px] text-slate-400">{query}</div>
                </div>
              ))}
            </div>
            <p className="mt-3">
              These API providers have their own privacy policies. The queries sent are limited to
              <Highlight> publicly registered scientific identifiers</Highlight> — not proprietary molecular structures,
              sequence data, or confidential research information. Each provider's terms of service and privacy policy
              govern how they handle request logs.
            </p>
          </SectionBlock>

          <SectionBlock id="no-egress" title="Zero Simulation Data Egress">
            <p>
              HakaseAI explicitly does <Highlight>not</Highlight> transmit the following to any HakaseAI server or third party:
            </p>
            <div className="grid grid-cols-2 gap-2 mt-3">
              {[
                "SMILES strings or molecular structures",
                "ADMET scores or toxicity assessments",
                "PBPK parameters or PK/PD results",
                "Patient cohort configurations",
                "Trial design parameters",
                "Simulation output data",
                "GO/NO-GO verdicts",
                "Regulatory strategy information",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2.5 border border-rose-500/10 rounded-lg px-3 py-2 bg-rose-500/5">
                  <span className="text-rose-500 text-[14px] font-bold">✕</span>
                  <span className="text-[11px] text-slate-400">{item}</span>
                </div>
              ))}
            </div>
            <p className="mt-4">
              This architecture is deliberate. Drug discovery data is highly confidential intellectual property.
              HakaseAI is designed so that your simulation pipeline can never be reconstructed from server-side logs,
              because <Highlight>no simulation data reaches our servers</Highlight>.
            </p>
          </SectionBlock>

          <SectionBlock id="storage" title="Local Storage & Sessions">
            <p>
              HakaseAI stores a minimal set of data in your browser's local storage to preserve your session:
            </p>
            <div className="space-y-2 mt-2">
              {[
                { item: "Authentication token (JWT)", retention: "Expires after 30 days of inactivity", note: "Used to identify your logged-in session — no scientific data included" },
                { item: "UI preferences", retention: "Persisted until you clear browser data", note: "Active layer, panel collapse state — no simulation data" },
                { item: "Last viewed indication / compound name", retention: "Current session only", note: "Used for UI continuity within a single session" },
              ].map(({ item, retention, note }) => (
                <div key={item} className="border border-white/6 rounded-xl px-4 py-3">
                  <div className="text-[12px] font-semibold text-white mb-1">{item}</div>
                  <div className="text-[11px] text-slate-500 mb-0.5">Retention: {retention}</div>
                  <div className="text-[11px] text-slate-600">{note}</div>
                </div>
              ))}
            </div>
            <p className="mt-3">
              You can clear all locally stored data at any time through your browser's storage settings. This will log you out
              but will not affect any scientific data, as none is stored.
            </p>
          </SectionBlock>

          <SectionBlock id="your-rights" title="Your Rights">
            <p>Regardless of your jurisdiction, HakaseAI honours the following rights:</p>
            <div className="space-y-2 mt-3">
              {[
                { right: "Right to Access", detail: "Request a copy of all personal data HakaseAI holds about you (limited to account information and anonymised analytics)." },
                { right: "Right to Deletion", detail: "Request permanent deletion of your account and all associated personal data. Deletion is processed within 30 days." },
                { right: "Right to Correction", detail: "Update or correct your account information at any time through account settings." },
                { right: "Right to Portability", detail: "Request your personal data in a structured, machine-readable format (JSON)." },
                { right: "Right to Opt Out", detail: "Opt out of anonymised analytics collection at any time through account preferences." },
              ].map(({ right, detail }) => (
                <div key={right} className="border border-white/6 rounded-xl px-4 py-3">
                  <div className="text-[12px] font-semibold text-violet-400 mb-0.5">{right}</div>
                  <div className="text-[12px] text-slate-400">{detail}</div>
                </div>
              ))}
            </div>
          </SectionBlock>

          <SectionBlock id="security" title="Security Measures">
            <p>HakaseAI implements the following technical and organisational security measures:</p>
            <div className="grid grid-cols-2 gap-3 mt-3">
              {[
                { label: "TLS 1.3 encryption", detail: "All data in transit is encrypted" },
                { label: "Bcrypt password hashing", detail: "Salted hash, never stored plaintext" },
                { label: "JWT expiry enforcement", detail: "Short-lived tokens with refresh rotation" },
                { label: "No third-party trackers", detail: "No advertising SDKs or tracking pixels" },
                { label: "Zero simulation logging", detail: "Server logs contain no biomedical data" },
                { label: "Access controls", detail: "Role-based access within the platform" },
              ].map(({ label, detail }) => (
                <div key={label} className="border border-emerald-500/15 rounded-xl px-4 py-3 bg-emerald-500/5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <div className="text-[12px] font-semibold text-emerald-300">{label}</div>
                  </div>
                  <div className="text-[11px] text-slate-500">{detail}</div>
                </div>
              ))}
            </div>
          </SectionBlock>

          <SectionBlock id="changes" title="Policy Changes">
            <p>
              If we make material changes to this Privacy Policy, we will notify you by email (to the address associated with
              your account) and display a prominent notice on the platform at least <Highlight>14 days before</Highlight> the
              changes take effect.
            </p>
            <p>
              Continued use of HakaseAI after the effective date constitutes acceptance of the updated policy.
              Previous versions of this policy are available upon request.
            </p>
          </SectionBlock>

          <SectionBlock id="contact" title="Contact">
            <p>
              For privacy-related inquiries, data subject requests, or to report a concern, contact us at:
            </p>
            <div className="border border-white/8 rounded-xl px-5 py-4 bg-white/[0.02] mt-3">
              <div className="text-[13px] font-semibold text-white mb-1">HakaseAI Privacy Team</div>
              <div className="text-[13px] text-violet-400">privacy@hakaseai.com</div>
              <div className="text-[12px] text-slate-600 mt-1">Response within 5 business days</div>
            </div>
          </SectionBlock>

          {/* CTA */}
          <div className="border border-white/8 rounded-2xl p-6 bg-white/[0.015] flex items-center justify-between gap-4">
            <div>
              <div className="text-[14px] font-semibold text-white mb-1">Questions about how your data is used?</div>
              <div className="text-[12px] text-slate-500">See exactly which APIs and databases HakaseAI connects to.</div>
            </div>
            <button
              onClick={() => navigate("/apis")}
              className="shrink-0 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[13px] transition-colors"
            >
              View APIs →
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
