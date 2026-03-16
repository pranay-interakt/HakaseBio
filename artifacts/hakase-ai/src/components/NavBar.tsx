import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import hakaseLogo from "@assets/image_1773504202272.png";

interface NavBarProps {
  sticky?: boolean;
  anchorLinks?: { href: string; label: string }[];
}

export function NavBar({ sticky = false, anchorLinks = [] }: NavBarProps) {
  const [, navigate] = useLocation();
  const [platformOpen, setPlatformOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setPlatformOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const platformItems = [
    { label: "Overview",                     sub: "What BioDigital Twin is",              anchor: "",            route: "",            color: "violet"  },
    { label: "Layer 1 — Molecular",          sub: "ADMET · Binding · Go/No-Go",           anchor: "#layer1",     route: "",            color: "violet"  },
    { label: "Layer 2 — Patient Cohort",     sub: "PK/PD · Responders · Adverse events",  anchor: "#layer2",     route: "",            color: "blue"    },
    { label: "VPSE · Live",                  sub: "PBPK · NHANES · ChEMBL · FAERS",        anchor: "#vpse",       route: "",            color: "blue"    },
    { label: "Layer 3 — Trial Digital Twin", sub: "Power · Enrollment · Verdict",          anchor: "#layer3",     route: "",            color: "emerald" },
    { label: "Regulatory Intelligence",      sub: "IND · FDA Designations · Timeline",     anchor: "",            route: "/regulatory", color: "blue"    },
    { label: "Privacy",                      sub: "Client-side · Zero data egress",        anchor: "#privacy",    route: "",            color: "slate"   },
    { label: "Advanced AI · v2",             sub: "50+ models · 8 component upgrades",     anchor: "#ai-v2",      route: "",            color: "amber"   },
  ];

  const landingAnchors = new Set(["#privacy", "#ai-v2", "#vpse"]);

  function handlePlatformNav(anchor: string, route: string) {
    setPlatformOpen(false);
    setMobileOpen(false);
    if (route) {
      navigate(route);
    } else if (landingAnchors.has(anchor)) {
      navigate("/");
      setTimeout(() => {
        document.querySelector(anchor)?.scrollIntoView({ behavior: "smooth" });
      }, 150);
    } else {
      navigate("/platform" + anchor);
    }
  }

  return (
    <>
      <nav className={`${sticky ? "sticky top-0" : "relative"} z-40 flex items-center justify-between px-6 md:px-8 py-5 border-b border-white/5 bg-[#07080c]/95 backdrop-blur-sm`}>

        {/* Logo */}
        <button onClick={() => { navigate("/"); setMobileOpen(false); }} className="flex items-center gap-2.5 shrink-0">
          <img src={hakaseLogo} alt="HakaseAI" className="h-9 w-auto object-contain" />
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/8 text-slate-400 font-mono">v1.0</span>
        </button>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6 text-[13px] text-slate-400">

          {/* Platform dropdown */}
          <div ref={dropdownRef} className="relative">
            <button
              onClick={() => setPlatformOpen(o => !o)}
              className={`flex items-center gap-1.5 transition-colors ${platformOpen ? "text-white" : "hover:text-white"}`}
            >
              Platform
              <svg className={`w-3 h-3 transition-transform duration-200 ${platformOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
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
                      <div className={`text-[12px] font-semibold mb-0.5 transition-colors group-hover:text-white ${
                        color === "violet" ? "text-violet-300" : color === "blue" ? "text-blue-300" : color === "emerald" ? "text-emerald-300" : color === "amber" ? "text-amber-300" : "text-slate-300"
                      }`}>{label}</div>
                      <div className="text-[11px] text-slate-500 group-hover:text-slate-400 transition-colors">{sub}</div>
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

        {/* Mobile: hamburger */}
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

            {/* Platform section */}
            <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold px-3 pb-2 pt-1">Platform</div>
            {platformItems.map(({ label, sub, anchor, route, color }) => (
              <button
                key={label}
                onClick={() => handlePlatformNav(anchor, route)}
                className="w-full text-left px-3 py-3 rounded-xl hover:bg-white/5 transition-colors group"
              >
                <div className={`text-[14px] font-semibold mb-0.5 ${
                  color === "violet" ? "text-violet-300" : color === "blue" ? "text-blue-300" : color === "emerald" ? "text-emerald-300" : color === "amber" ? "text-amber-300" : "text-slate-300"
                }`}>{label}</div>
                <div className="text-[12px] text-slate-500">{sub}</div>
              </button>
            ))}

            <div className="border-t border-white/5 my-4" />

            {/* Other links */}
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
