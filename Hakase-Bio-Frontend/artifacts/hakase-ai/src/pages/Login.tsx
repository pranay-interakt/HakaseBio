import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/AuthContext";
import {
  forgotPassword as apiForgotPassword,
  oauthStartUrl,
  resetPassword as apiResetPassword,
  resendVerification,
  verifyEmail,
} from "@/lib/authApi";
import hakaseLogo from "@assets/image_1773504202272.png";

type Screen = "hero" | "create" | "signin" | "forgot" | "reset" | "verified";

const GoogleIcon = () => (
  <svg viewBox="0 0 48 48" className="w-4 h-4" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.2-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.3 0 10-2 13.6-5.2l-6.3-5.3C29.3 35 26.8 36 24 36c-5.2 0-9.7-3.3-11.3-8l-6.6 5.1C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3c-.4.4 6.4-4.7 6.4-14.8 0-1.2-.1-2.4-.4-3.5z" />
  </svg>
);
const AppleIcon = () => (
  <svg viewBox="0 0 384 512" className="w-4 h-4 fill-white" aria-hidden>
    <path d="M318.7 268.7c-.2-37 16.7-65.1 50.7-85.6-19-27.2-47.7-42.2-85.7-45.1-36-2.8-75.4 21-89.7 21-15.2 0-49.2-20-76-20C76.4 140 24 184.7 24 273.7c0 26.3 4.8 53.4 14.4 81.4 12.8 36.5 59 126.1 107.2 124.6 25.2-.6 43-17.9 75.8-17.9 31.9 0 48.4 17.9 76.5 17.9 48.6-.7 90.4-82.1 102.6-118.7-65.2-30.7-81.8-90.1-81.8-92.3zM229.6 110c30.7-36.5 28-69.7 27.1-81.6-27.3 1.6-58.8 18.6-76.7 39.6-19.8 22.5-31.3 50.4-28.9 81 29.4 2.3 56.1-12.8 78.5-39z" />
  </svg>
);
const EyeOpenIcon = () => (
  <svg className="w-4 h-4 text-slate-400 hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);
const EyeClosedIcon = () => (
  <svg className="w-4 h-4 text-slate-400 hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
  </svg>
);

function pwStrength(pw: string): { score: number; label: string; tips: string[] } {
  const tips: string[] = [];
  if (pw.length < 12) tips.push("≥ 12 chars");
  let cats = 0;
  if (/[a-z]/.test(pw)) cats++; else tips.push("lowercase");
  if (/[A-Z]/.test(pw)) cats++; else tips.push("uppercase");
  if (/[0-9]/.test(pw)) cats++; else tips.push("digit");
  if (/[^a-zA-Z0-9]/.test(pw)) cats++; else tips.push("symbol");
  const lengthScore = Math.min(2, Math.floor(pw.length / 8));
  const score = Math.min(4, Math.max(0, cats - 1 + lengthScore));
  const label = ["Very weak", "Weak", "Fair", "Strong", "Excellent"][score]!;
  return { score, label, tips };
}

function Backdrop() {
  return (
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
  );
}

function TopNav({ onHome }: { onHome: () => void }) {
  return (
    <nav className="relative z-10 flex items-center justify-between px-8 py-5">
      <button onClick={onHome} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
        <img src={hakaseLogo} alt="HakaseAI" className="hk-logo h-9 w-auto object-contain" />
      </button>
      <button onClick={onHome} className="text-[13px] text-slate-500 hover:text-white transition-colors flex items-center gap-1.5">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back to home
      </button>
    </nav>
  );
}

function LayerStrip() {
  return (
    <div className="mt-10 text-center">
      <div className="flex items-center justify-center gap-3">
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
      <div className="text-[10px] text-slate-700 mt-2">
        In Vitro Twin · Cohort Twin · Trial Twin
      </div>
    </div>
  );
}

const inputCls =
  "w-full bg-white/5 border border-white/10 rounded-lg px-3.5 py-2 text-[13px] text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/60 focus:bg-violet-500/5 transition-all";
const primaryBtn =
  "w-full mt-2 flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:bg-violet-700 disabled:opacity-60 text-white font-semibold text-[14px] transition-all shadow-lg shadow-violet-500/20";

function Field({ label, right, children }: { label: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[12px] text-slate-400 font-medium">{label}</label>
        {right}
      </div>
      {children}
    </div>
  );
}
function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}
function Arrow() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

export function Login() {
  const [, navigate] = useLocation();
  const { login, signup } = useAuth();

  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const initial: Screen = useMemo(() => {
    if (params.get("verify")) return "verified";
    if (params.get("reset")) return "reset";
    if (params.get("mode") === "signup") return "create";
    if (params.get("mode") === "signin") return "signin";
    return "hero";
  }, [params]);

  // Default post-login destination is the Lab dashboard (/lab). If the user was
  // bounced to /login from a protected page, ?next= preserves that intent.
  const next = params.get("next") ?? "/lab";
  const [screen, setScreen] = useState<Screen>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const t = params.get("verify");
    if (!t) return;
    (async () => {
      try {
        await verifyEmail(t);
        setNotice("Email verified. You can sign in now.");
        setScreen("signin");
      } catch (e) {
        setError((e as Error).message);
        setScreen("signin");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("mr");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showSigninPw, setShowSigninPw] = useState(false);
  const [emailOrUser, setEmailOrUser] = useState("");
  const [signinPw, setSigninPw] = useState("");
  const [resetPw, setResetPw] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");

  const strength = pwStrength(password);

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setError(null); setNotice(null); setBusy(true);
    try {
      await signup(email, title, firstName, lastName, password);
      setNotice("Account created. Check your inbox for the verification link.");
      setScreen("signin");
      setEmailOrUser(email);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function onSignin(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      await login(emailOrUser, signinPw);
      navigate(next, { replace: true });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function onForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      await apiForgotPassword(forgotEmail);
      setNotice("If that email is registered, a reset link is on its way.");
      setScreen("signin");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function onReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const token = params.get("reset") ?? "";
      await apiResetPassword(token, resetPw);
      setNotice("Password reset. Sign in with your new password.");
      setScreen("signin");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function onResendVerify() {
    setError(null); setBusy(true);
    try {
      await resendVerification(emailOrUser || email);
      setNotice("Verification email sent.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  function Banner() {
    return (
      <>
        {error && (
          <div role="alert" className="mb-3 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-[12px] text-red-300">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-3 px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-[12px] text-emerald-300">
            {notice}
          </div>
        )}
      </>
    );
  }

  function HeroScreen() {
    return (
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-violet-500/30 bg-violet-500/8 text-violet-300 text-[11px] font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            BioDigital Twin Platform
          </div>
          <h1 className="text-[34px] font-black tracking-tight text-white leading-tight">HakaseAI</h1>
          <p className="text-[14px] text-slate-400 mt-2 max-w-[320px] mx-auto">
            Layer 1 → Layer 3 in silico → in vitro twin. Build, predict, validate.
          </p>
        </div>
        <div className="bg-[#0d0f17] border border-white/8 rounded-2xl p-7 shadow-2xl space-y-3">
          <button onClick={() => setScreen("create")} className={primaryBtn}>
            Get started <Arrow />
          </button>
          <button onClick={() => setScreen("signin")} className="w-full py-3 rounded-xl border border-white/10 hover:border-white/20 text-slate-200 font-semibold text-[14px] transition-all">
            I already have an account
          </button>
        </div>
        <LayerStrip />
      </div>
    );
  }

  function CreateScreen() {
    const pwOk = strength.tips.length === 0;
    return (
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-3">
          <h1 className="text-[26px] font-black tracking-tight text-white leading-tight">Create an account</h1>
          <p className="text-[12px] text-slate-500 mt-1">Sign up with email, Google, or Apple.</p>
        </div>
        <div className="bg-[#0d0f17] border border-white/8 rounded-2xl p-5 shadow-2xl">
          {Banner()}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <a href={oauthStartUrl("google", next)} className="flex items-center justify-center gap-2 py-2 rounded-lg bg-white text-slate-900 text-[12px] font-semibold">
              <GoogleIcon /> Google
            </a>
            <a href={oauthStartUrl("apple", next)} className="flex items-center justify-center gap-2 py-2 rounded-lg bg-black text-white text-[12px] font-semibold border border-white/10">
              <AppleIcon /> Apple
            </a>
          </div>
          <div className="relative my-1.5 mb-3.5">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/6" /></div>
            <div className="relative flex justify-center text-[10px] text-slate-600"><span className="px-3 bg-[#0d0f17]">or sign up with email</span></div>
          </div>
          <form onSubmit={onSignup} className="space-y-3">
            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-3">
                <Field label="Title">
                  <select value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-[13px] text-white focus:outline-none focus:border-violet-500/60 focus:bg-violet-500/5 transition-all">
                    <option value="mr" className="bg-[#0d0f17] text-white">Mr.</option>
                    <option value="mrs" className="bg-[#0d0f17] text-white">Mrs.</option>
                    <option value="ms" className="bg-[#0d0f17] text-white">Ms.</option>
                    <option value="dr" className="bg-[#0d0f17] text-white">Dr.</option>
                    <option value="other" className="bg-[#0d0f17] text-white">Other</option>
                  </select>
                </Field>
              </div>
              <div className="col-span-4">
                <Field label="First Name">
                  <input required value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First" className={inputCls} />
                </Field>
              </div>
              <div className="col-span-5">
                <Field label="Last Name">
                  <input required value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last" className={inputCls} />
                </Field>
              </div>
            </div>
            <Field label="Email">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hakase.ai" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Password">
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={12}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 12 chars"
                    className={inputCls + " pr-9"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center p-1 text-slate-500 hover:text-white"
                  >
                    {showPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
                  </button>
                </div>
              </Field>
              <Field label="Confirm Password">
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm"
                    className={inputCls + " pr-9"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center p-1 text-slate-500 hover:text-white"
                  >
                    {showConfirmPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
                  </button>
                </div>
              </Field>
            </div>
            {password.length > 0 && (
              <div className="mt-1">
                <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
                  <div className={["w-0", "w-1/4", "w-2/4", "w-3/4", "w-full"][strength.score]! + " h-full bg-violet-500 transition-all"} />
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-[10px] text-slate-500">{strength.label}</span>
                  {strength.tips.length > 0 && (
                    <span className="text-[10px] text-amber-400">missing: {strength.tips.join(", ")}</span>
                  )}
                </div>
              </div>
            )}
            <button type="submit" disabled={busy || !pwOk} className={primaryBtn}>
              {busy ? <Spinner /> : <>Register<Arrow /></>}
            </button>
          </form>
          <div className="mt-4 text-center">
            <button onClick={() => setScreen("signin")} className="text-[12px] text-slate-500 hover:text-white">
              Already have an account? <span className="text-violet-400">Sign in</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  function SigninScreen() {
    return (
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-6">
          <h1 className="text-[28px] font-black tracking-tight text-white">Welcome back</h1>
          <p className="text-[13px] text-slate-500 mt-2">Sign in to your HakaseAI workspace</p>
        </div>
        <div className="bg-[#0d0f17] border border-white/8 rounded-2xl p-7 shadow-2xl">
          {Banner()}
          <div className="grid grid-cols-2 gap-2 mb-5">
            <a href={oauthStartUrl("google", next)} className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-white text-slate-900 text-[12px] font-semibold">
              <GoogleIcon /> Google
            </a>
            <a href={oauthStartUrl("apple", next)} className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-black text-white text-[12px] font-semibold border border-white/10">
              <AppleIcon /> Apple
            </a>
          </div>
          <div className="relative my-2 mb-5">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/6" /></div>
            <div className="relative flex justify-center text-[11px] text-slate-600"><span className="px-3 bg-[#0d0f17]">or with email</span></div>
          </div>
          <form onSubmit={onSignin} className="space-y-4">
            <Field label="Email or username">
              <input required value={emailOrUser} onChange={(e) => setEmailOrUser(e.target.value)} placeholder="you@hakase.ai" className={inputCls} />
            </Field>
            <Field label="Password" right={
              <button type="button" onClick={() => setScreen("forgot")} className="text-[11px] text-violet-400 hover:text-violet-300">Forgot password?</button>
            }>
              <input type="password" required value={signinPw} onChange={(e) => setSigninPw(e.target.value)} placeholder="••••••••••••" className={inputCls} />
            </Field>
            <button type="submit" disabled={busy} className={primaryBtn}>
              {busy ? <Spinner /> : <>Sign In<Arrow /></>}
            </button>
          </form>
          <div className="mt-4 text-[11px] text-slate-500 text-center">
            Didn't get the verification email?{" "}
            <button onClick={onResendVerify} className="text-violet-400 hover:text-violet-300">resend</button>
          </div>
          <div className="mt-5 text-center">
            <button onClick={() => setScreen("create")} className="text-[12px] text-slate-500 hover:text-white">
              New here? <span className="text-violet-400">Create an account</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  function ForgotScreen() {
    return (
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-4">
          <h1 className="text-[26px] font-black tracking-tight text-white leading-tight">Reset your password</h1>
          <p className="text-[12px] text-slate-500 mt-1">We'll email you a reset link.</p>
        </div>
        <div className="bg-[#0d0f17] border border-white/8 rounded-2xl p-5 shadow-2xl">
          {Banner()}
          <form onSubmit={onForgot} className="space-y-4">
            <Field label="Email">
              <input type="email" required value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="you@hakase.ai" className={inputCls} />
            </Field>
            <button type="submit" disabled={busy} className={primaryBtn}>
              {busy ? <Spinner /> : <>Send reset link<Arrow /></>}
            </button>
          </form>
          <div className="mt-4 text-center">
            <button onClick={() => setScreen("signin")} className="text-[12px] text-slate-500 hover:text-white">← Back to sign in</button>
          </div>
        </div>
      </div>
    );
  }

  function ResetScreen() {
    return (
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-4">
          <h1 className="text-[26px] font-black tracking-tight text-white leading-tight">Choose a new password</h1>
        </div>
        <div className="bg-[#0d0f17] border border-white/8 rounded-2xl p-5 shadow-2xl">
          {Banner()}
          <form onSubmit={onReset} className="space-y-4">
            <Field label="New password">
              <input type="password" required minLength={12} value={resetPw} onChange={(e) => setResetPw(e.target.value)} className={inputCls} />
            </Field>
            <button type="submit" disabled={busy} className={primaryBtn}>
              {busy ? <Spinner /> : <>Reset password<Arrow /></>}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07080c] text-white font-['Inter',sans-serif] flex flex-col">
      <Backdrop />
      <TopNav onHome={() => navigate("/")} />
      <div className="relative z-10 flex-1 flex items-center justify-center px-6 py-4">
        {screen === "hero" && HeroScreen()}
        {screen === "create" && CreateScreen()}
        {(screen === "signin" || screen === "verified") && SigninScreen()}
        {screen === "forgot" && ForgotScreen()}
        {screen === "reset" && ResetScreen()}
      </div>
    </div>
  );
}

export default Login;
