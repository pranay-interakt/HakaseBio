import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import hakaseLogo from "@assets/image_1773504202272.png";

interface NavBarProps {
  sticky?: boolean;
  anchorLinks?: { href: string; label: string }[];
}

const ChevronDown = ({ open }: { open: boolean }) => (
  <svg className={`w-3 h-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);

export function NavBar({ sticky = false, anchorLinks = [] }: NavBarProps) {
  const [, navigate] = useLocation();
  const [platformOpen, setPlatformOpen] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const platformRef = useRef<HTMLDivElement>(null);
  const techRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (platformRef.current && !platformRef.current.contains(e.target as Node)) setPlatformOpen(false);
      if (techRef.current && !techRef.current.contains(e.target as Node)) setTechOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const platformItems = [
    { label: "Overview",                              sub: "Pre-clinical pipeline, end-to-end",                          anchor: "",        route: "",            color: "violet"  },
    { label: "Layer 1 — In Vitro Twin",               sub: "RDKit · ADMET · Binding · Cascade Gate",                     anchor: "#layer1", route: "",            color: "violet"  },
    { label: "Layer 2 — Confirmation Layer",          sub: "Docking · FEP · ML cross-check · PBPK · QSP/PD · Ex-Vivo",   anchor: "#layer2", route: "",            color: "blue"    },
    { label: "IVIVE Bridge",                          sub: "In-silico → animal cohort · literature + in-house substrate · sealed sign-off", anchor: "",   route: "/ivive",      color: "blue"    },
    { label: "Layer 3 — Animal Cohort",               sub: "Multi-species PBPK · Formulation · NOAEL · Allometric",      anchor: "#layer3", route: "",            color: "amber"   },
    { label: "Layer 4 — First-In-Human Readiness",    sub: "MABEL · IND gate · Phase 1 Planner · Sealed Handoff",        anchor: "#layer4", route: "",            color: "emerald" },
    { label: "Regulatory Intelligence",               sub: "IND-enabling · FDA Designations · Pre-IND meetings",         anchor: "",        route: "/regulatory", color: "blue"    },
  ];

  const techItems = [
    {
      label: "APIs & Data Sources",
      sub: "ChEMBL · PubChem · UniProt · RCSB · AlphaFold · openFDA",
      route: "/apis",
      color: "violet",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      label: "Databases",
      sub: "NHANES · FAERS · PDB · ChEMBL · AlphaFold · UniProtKB",
      route: "/apis#databases",
      color: "blue",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2 1.8 3 4 3h8c2.2 0 4-1 4-3V7c0-2-1.8-3-4-3H8C5.8 4 4 5 4 7zm0 5h16" />
        </svg>
      ),
    },
    {
      label: "Advanced v2",
      sub: "Deep learning upgrades · 16 AI modules · 3-phase rollout",
      route: "/advanced-v2",
      color: "violet",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
      ),
    },
    {
      label: "IVIVE Bridge",
      sub: "In-silico → animal cohort gate · substrate matrix · Obach 1999 · sealed sign-off",
      route: "/ivive",
      color: "blue",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h4l3-7 4 14 3-7h4" />
        </svg>
      ),
    },
    {
      label: "HAIOps Framework",
      sub: "Healthcare AI Operations · Safety cascade · Governance",
      route: "/haiopsdna",
      color: "violet",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      ),
    },
    {
      label: "Privacy",
      sub: "Client-side computation · Zero data egress · Your rights",
      route: "/privacy",
      color: "emerald",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
    },
  ];

  const landingAnchors = new Set(["#ai-v2"]);

  function handlePlatformNav(anchor: string, route: string) {
    setPlatformOpen(false);
    setMobileOpen(false);
    if (route) {
      navigate(route);
    } else if (landingAnchors.has(anchor)) {
      navigate("/");
      setTimeout(() => { document.querySelector(anchor)?.scrollIntoView({ behavior: "smooth" }); }, 150);
    } else {
      navigate("/platform" + anchor);
    }
  }

  function handleTechNav(route: string) {
    setTechOpen(false);
    setMobileOpen(false);
    if (route.includes("#")) {
      const [path, hash] = route.split("#");
      navigate(path);
      setTimeout(() => { document.querySelector("#" + hash)?.scrollIntoView({ behavior: "smooth" }); }, 200);
    } else {
      navigate(route);
    }
  }

  const colorMap: Record<string, string> = {
    violet: "text-violet-300", blue: "text-blue-300", emerald: "text-emerald-300",
    amber: "text-amber-300", slate: "text-slate-300",
  };
  const accentMap: Record<string, string> = {
    violet: "text-violet-400", blue: "text-blue-400", emerald: "text-emerald-400",
  };

  return (
    <>
      <nav className={`${sticky ? "sticky top-0" : "relative"} z-40 flex items-center justify-between px-6 md:px-8 py-5 border-b border-white/5 bg-[#07080c]/95 backdrop-blur-sm`}>

        {/* Logo */}
        <button onClick={() => { navigate("/"); setMobileOpen(false); }} className="flex items-center gap-2.5 shrink-0">
          <img src={hakaseLogo} alt="HakaseAI" className="h-9 w-auto object-contain" />
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/8 text-slate-400 font-mono">v1.0</span>
        </button>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-7 text-[13px] text-slate-400">

          {/* Platform dropdown */}
          <div ref={platformRef} className="relative">
            <button
              onClick={() => { setPlatformOpen(o => !o); setTechOpen(false); }}
              className={`flex items-center gap-1.5 transition-colors ${platformOpen ? "text-white" : "hover:text-white"}`}
            >
              Platform <ChevronDown open={platformOpen} />
            </button>
            {platformOpen && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-72 rounded-2xl border border-white/10 bg-[#0d0f17] shadow-2xl shadow-black/80 overflow-hidden z-[100]">
                <div className="p-1.5 space-y-0.5">
                  {platformItems.map(({ label, sub, anchor, route, color }) => (
                    <button
                      key={label}
                      onClick={() => handlePlatformNav(anchor, route)}
                      className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors group"
                    >
                      <div className={`text-[12px] font-semibold mb-0.5 transition-colors group-hover:text-white ${colorMap[color]}`}>{label}</div>
                      <div className="text-[11px] text-slate-500 group-hover:text-slate-400 transition-colors">{sub}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Technology dropdown */}
          <div ref={techRef} className="relative">
            <button
              onClick={() => { setTechOpen(o => !o); setPlatformOpen(false); }}
              className={`flex items-center gap-1.5 transition-colors ${techOpen ? "text-white" : "hover:text-white"}`}
            >
              Technology <ChevronDown open={techOpen} />
            </button>
            {techOpen && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-80 rounded-2xl border border-white/10 bg-[#0d0f17] shadow-2xl shadow-black/80 overflow-hidden z-[100]">
                <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-slate-600 font-semibold">Technology</div>
                <div className="p-1.5 space-y-0.5">
                  {techItems.map(({ label, sub, route, color, icon }) => (
                    <button
                      key={label}
                      onClick={() => handleTechNav(route)}
                      className="w-full text-left px-3 py-3 rounded-xl hover:bg-white/5 transition-colors group flex items-start gap-3"
                    >
                      <div className={`mt-0.5 ${accentMap[color]} opacity-70 group-hover:opacity-100 transition-opacity shrink-0`}>{icon}</div>
                      <div>
                        <div className={`text-[12px] font-semibold mb-0.5 transition-colors group-hover:text-white ${colorMap[color]}`}>{label}</div>
                        <div className="text-[11px] text-slate-500 group-hover:text-slate-400 transition-colors leading-relaxed">{sub}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {anchorLinks.map(({ href, label }) => (
            <a key={href} href={href} className="hover:text-white transition-colors">{label}</a>
          ))}

          <button onClick={() => navigate("/story")} className="hover:text-white transition-colors">The Story</button>
        </div>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center shrink-0">
          <button
            onClick={() => navigate("/login")}
            className="text-[13px] font-semibold px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 transition-colors text-white"
          >
            Get Started →
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          onClick={() => setMobileOpen(o => !o)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </nav>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 top-[73px] z-30 bg-[#07080c]/98 backdrop-blur-sm overflow-y-auto">
          <div className="px-6 py-6 space-y-1">

            <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold px-3 pb-2 pt-1">Platform</div>
            {platformItems.map(({ label, sub, anchor, route, color }) => (
              <button
                key={label}
                onClick={() => handlePlatformNav(anchor, route)}
                className="w-full text-left px-3 py-3 rounded-xl hover:bg-white/5 transition-colors group"
              >
                <div className={`text-[14px] font-semibold mb-0.5 ${colorMap[color]}`}>{label}</div>
                <div className="text-[12px] text-slate-500">{sub}</div>
              </button>
            ))}

            <div className="border-t border-white/5 my-4" />

            <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold px-3 pb-2">Technology</div>
            {techItems.map(({ label, sub, route, color }) => (
              <button
                key={label}
                onClick={() => handleTechNav(route)}
                className="w-full text-left px-3 py-3 rounded-xl hover:bg-white/5 transition-colors group"
              >
                <div className={`text-[14px] font-semibold mb-0.5 ${colorMap[color]}`}>{label}</div>
                <div className="text-[12px] text-slate-500">{sub}</div>
              </button>
            ))}

            <div className="border-t border-white/5 my-4" />

            {anchorLinks.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className="block px-3 py-3 text-[14px] text-slate-400 hover:text-white transition-colors rounded-xl hover:bg-white/5"
              >
                {label}
              </a>
            ))}
            <button
              onClick={() => { navigate("/story"); setMobileOpen(false); }}
              className="w-full text-left px-3 py-3 text-[14px] text-slate-400 hover:text-white transition-colors rounded-xl hover:bg-white/5"
            >
              The Story
            </button>

            <div className="pt-4">
              <button
                onClick={() => { navigate("/login"); setMobileOpen(false); }}
                className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 transition-colors text-white font-semibold text-[14px]"
              >
                Get Started →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
