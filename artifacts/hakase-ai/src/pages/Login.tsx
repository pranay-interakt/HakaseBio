import { useState } from "react";
import { useLocation } from "wouter";
import hakaseLogo from "@assets/image_1773504202272.png";

export function Login() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      navigate("/dashboard");
    }, 800);
  };

  return (
    <div className="min-h-screen bg-[#07080c] text-white font-['Inter',sans-serif] flex flex-col">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <svg width="100%" height="100%" className="opacity-[0.03]">
          <defs>
            <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
              <path d="M 60 0 L 0 0 0 60" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-violet-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-blue-600/6 rounded-full blur-[100px]" />
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-5">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
        >
          <img src={hakaseLogo} alt="HakaseAI" className="h-9 w-auto object-contain" />
        </button>
        <button
          onClick={() => navigate("/")}
          className="text-[13px] text-slate-500 hover:text-white transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to home
        </button>
      </nav>

      {/* Main */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-[400px]">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-violet-500/30 bg-violet-500/8 text-violet-300 text-[11px] font-medium mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              BioDigital Twin Platform
            </div>
            <h1 className="text-[28px] font-black tracking-tight text-white">Welcome back</h1>
            <p className="text-[14px] text-slate-500 mt-2">Sign in to your HakaseAI workspace</p>
          </div>

          {/* Card */}
          <div className="bg-[#0d0f17] border border-white/8 rounded-2xl p-7 shadow-2xl">
            <form onSubmit={handleSignIn} className="space-y-4">
              {/* Email */}
              <div>
                <label className="block text-[12px] text-slate-400 mb-1.5 font-medium">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="researcher@hakase.ai"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3.5 py-2.5 text-[13px] text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60 focus:bg-violet-500/5 transition-all"
                />
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[12px] text-slate-400 font-medium">Password</label>
                  <button type="button" className="text-[11px] text-violet-400 hover:text-violet-300 transition-colors">
                    Forgot password?
                  </button>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3.5 py-2.5 text-[13px] text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60 focus:bg-violet-500/5 transition-all"
                />
              </div>

              {/* Sign in */}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:bg-violet-700 text-white font-semibold text-[14px] transition-all shadow-lg shadow-violet-500/20"
              >
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign In
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </>
                )}
              </button>
            </form>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/6" />
              </div>
              <div className="relative flex justify-center text-[11px] text-slate-600">
                <span className="px-3 bg-[#0d0f17]">or continue with</span>
              </div>
            </div>

            {/* SSO options */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Microsoft SSO", icon: "M" },
                { label: "Google SSO", icon: "G" },
              ].map(({ label, icon }) => (
                <button
                  key={label}
                  onClick={() => navigate("/dashboard")}
                  className="flex items-center justify-center gap-2 py-2.5 rounded-lg border border-white/8 text-slate-400 hover:text-white hover:border-white/20 text-[12px] font-medium transition-all"
                >
                  <span className="w-4 h-4 flex items-center justify-center text-[11px] font-bold">{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Demo access note */}
          <div className="mt-5 text-center">
            <button
              onClick={() => navigate("/dashboard")}
              className="text-[12px] text-slate-600 hover:text-slate-400 transition-colors underline underline-offset-2"
            >
              Access demo workspace without signing in →
            </button>
          </div>

          {/* Divider + layer indicators */}
          <div className="mt-10 flex items-center justify-center gap-3">
            {[
              { label: "Layer 1", color: "bg-violet-500" },
              { label: "Layer 2", color: "bg-blue-500" },
              { label: "Layer 3", color: "bg-emerald-500" },
            ].map(({ label, color }) => (
              <div key={label} className="flex items-center gap-1.5 text-[10px] text-slate-600">
                <span className={`w-1.5 h-1.5 rounded-full ${color} opacity-60`} />
                {label}
              </div>
            ))}
          </div>
          <div className="text-center mt-2 text-[10px] text-slate-700">
            In Vitro Twin · Cohort Twin · Trial Twin
          </div>
        </div>
      </div>
    </div>
  );
}
