/**
 * Batch Library Screening — its own page (/screen).
 * ─────────────────────────────────────────────────────────────────────────
 * The buyer workflow: paste or upload many SMILES, get a ranked triage table
 * (GO / WATCH / REVIEW) with the key safety liabilities and a desirability
 * score, then export CSV. Runs the real ADMET-AI service per compound and
 * scores with the SAME calibrated thresholds + geometric-mean desirability as
 * the Layer-1 engine — kept deliberately separate from the dashboard so it
 * doesn't clutter the single-molecule view.
 *
 * Honest framing: this is a FAST PRE-LAB TRIAGE to rank a library and kill the
 * obvious fails — not a wet-lab replacement. Open any row in the full L1
 * dashboard for the complete molecule report.
 */
import { useState, useCallback, useMemo } from "react";
import { Link } from "wouter";
import { predictAdmetMlBatch } from "@/lib/aiService";
import { fastTriage, type TriageVerdict } from "@/lib/fastTriage";
import { Upload, Play, Download, ArrowUpRight, FlaskConical, Loader2 } from "lucide-react";

type Verdict = TriageVerdict | "ERROR";
interface Row {
  smiles: string;
  name: string;
  verdict: Verdict;
  score: number;            // 0–100 triage desirability
  herg: number | null;      // probability
  dili: number | null;
  ames: number | null;
  clintox: number | null;
  flags: string[];
  error?: string;
}

const SAMPLE = `CC(=O)Oc1ccccc1C(=O)O   aspirin
CN1C=NC2=C1C(=O)N(C(=O)N2C)C   caffeine
CC(C)(C)c1nc(-c2cccc(NS(C)(=O)=O)c2F)c(-c2ccnc(N)n2)s1   novel-lead`;

export default function BatchScreen() {
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [sortKey, setSortKey] = useState<"score" | "verdict">("score");

  const parsed = useMemo(() => {
    return input.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
      const [smiles, ...rest] = l.split(/[\s,\t]+/);
      return { smiles, name: rest.join(" ") || smiles };
    }).filter(x => x.smiles).slice(0, 500);
  }, [input]);

  const run = useCallback(async () => {
    if (parsed.length === 0 || running) return;
    setRunning(true);
    setRows([]);
    setProgress({ done: 0, total: parsed.length });
    // One batch call — ADMET-AI runs the whole library in a single model pass.
    const nameBySmiles = new Map(parsed.map(p => [p.smiles, p.name]));
    try {
      const res = await predictAdmetMlBatch(parsed.map(p => p.smiles));
      const out: Row[] = res.results.map(r => {
        const name = nameBySmiles.get(r.smiles) ?? r.smiles;
        if (!r.found || !r.structured) {
          return { smiles: r.smiles, name, verdict: "ERROR" as const, score: 0, herg: null, dili: null, ames: null, clintox: null, flags: [], error: r.error ?? "no prediction" };
        }
        const t = fastTriage(r.structured);
        return {
          smiles: r.smiles, name, verdict: t.verdict, score: t.score,
          herg: t.endpoints.hERG, dili: t.endpoints.DILI, ames: t.endpoints.AMES, clintox: t.endpoints.ClinTox,
          flags: t.flags,
        };
      });
      setRows(out);
      setProgress({ done: out.length, total: out.length });
    } catch (e: any) {
      setRows(parsed.map(p => ({ smiles: p.smiles, name: p.name, verdict: "ERROR" as const, score: 0, herg: null, dili: null, ames: null, clintox: null, flags: [], error: e?.message ?? "batch request failed" })));
    } finally {
      setRunning(false);
    }
  }, [parsed, running]);

  const onFile = useCallback((f: File) => {
    const reader = new FileReader();
    reader.onload = () => setInput(String(reader.result || ""));
    reader.readAsText(f);
  }, []);

  const sorted = useMemo(() => {
    const rank = { "GO": 0, "WATCH": 1, "REVIEW": 2, "ERROR": 3 } as Record<Verdict, number>;
    return [...rows].sort((a, b) => sortKey === "score" ? b.score - a.score : rank[a.verdict] - rank[b.verdict]);
  }, [rows, sortKey]);

  const exportCsv = useCallback(() => {
    const head = ["name", "smiles", "verdict", "score", "hERG_prob", "DILI_prob", "Ames_prob", "ClinTox_prob", "flags"];
    const lines = [head.join(",")].concat(sorted.map(r =>
      [r.name, r.smiles, r.verdict, r.score, r.herg ?? "", r.dili ?? "", r.ames ?? "", r.clintox ?? "", `"${r.flags.join("; ")}"`].join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `hakase-batch-screen-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  }, [sorted]);

  const tone = (v: Verdict) => v === "GO" ? "text-emerald-400" : v === "WATCH" ? "text-amber-300" : v === "REVIEW" ? "text-red-400" : "text-slate-500";
  const counts = useMemo(() => ({
    go: rows.filter(r => r.verdict === "GO").length,
    watch: rows.filter(r => r.verdict === "WATCH").length,
    review: rows.filter(r => r.verdict === "REVIEW").length,
  }), [rows]);

  return (
    <div className="hk-app-bg min-h-screen text-white font-['Inter'] px-6 py-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
          <div>
            <h1 className="hk-display text-[28px] text-white">Batch Library Screening</h1>
            <p className="text-[13px] text-slate-400 mt-1">Fast pre-lab triage — rank a library by safety liabilities, then take survivors into the full L1 report.</p>
          </div>
          <Link href="/dashboard" className="hk-chip hover:border-cyan-500/40">← Single-molecule dashboard</Link>
        </div>

        {/* Input */}
        <div className="hk-panel hk-topline p-5 mb-5">
          <div className="hk-eyebrow mb-2.5">Input · one compound per line — "SMILES name" (CSV/TSV ok, ≤500)</div>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={SAMPLE}
            spellCheck={false}
            className="w-full h-40 rounded-xl bg-black/30 border border-white/10 px-3 py-2.5 text-[12px] font-mono text-slate-200 outline-none focus:border-cyan-500/40 resize-y"
          />
          <div className="flex items-center gap-2.5 mt-3 flex-wrap">
            <button onClick={run} disabled={running || parsed.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 px-4 py-2 text-[13px] font-medium text-white transition-colors">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {running ? `Screening… ${progress.done}/${progress.total}` : `Screen ${parsed.length || ""} compound${parsed.length === 1 ? "" : "s"}`}
            </button>
            <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3.5 py-2 text-[12px] text-slate-300 cursor-pointer transition-colors">
              <Upload className="w-3.5 h-3.5" /> Upload CSV / SMILES
              <input type="file" accept=".csv,.smi,.tsv,.txt" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            {rows.length > 0 && (
              <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3.5 py-2 text-[12px] text-slate-300 transition-colors">
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        {rows.length > 0 && (
          <div className="hk-panel p-5">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="hk-chip"><span className="text-emerald-400 font-semibold">{counts.go}</span> GO</span>
                <span className="hk-chip"><span className="text-amber-300 font-semibold">{counts.watch}</span> WATCH</span>
                <span className="hk-chip"><span className="text-red-400 font-semibold">{counts.review}</span> REVIEW</span>
                <span className="text-[10px] text-slate-500">{rows.length} screened</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                sort
                <button onClick={() => setSortKey("score")} className={`hk-chip ${sortKey === "score" ? "border-cyan-500/40 text-cyan-300" : ""}`}>score</button>
                <button onClick={() => setSortKey("verdict")} className={`hk-chip ${sortKey === "verdict" ? "border-cyan-500/40 text-cyan-300" : ""}`}>verdict</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-500 text-left border-b border-white/8">
                    <th className="py-2 pr-3 font-medium">#</th>
                    <th className="py-2 pr-3 font-medium">Compound</th>
                    <th className="py-2 pr-3 font-medium">Verdict</th>
                    <th className="py-2 pr-3 font-medium">Score</th>
                    <th className="py-2 pr-3 font-medium">hERG</th>
                    <th className="py-2 pr-3 font-medium">DILI</th>
                    <th className="py-2 pr-3 font-medium">Ames</th>
                    <th className="py-2 pr-3 font-medium">Liabilities</th>
                    <th className="py-2 pr-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => (
                    <tr key={r.smiles + i} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="py-2 pr-3 text-slate-600">{i + 1}</td>
                      <td className="py-2 pr-3"><div className="text-slate-200 font-medium">{r.name}</div><div className="text-[9px] text-slate-600 font-mono truncate max-w-[200px]">{r.smiles}</div></td>
                      <td className={`py-2 pr-3 font-semibold ${tone(r.verdict)}`}>{r.verdict}</td>
                      <td className="py-2 pr-3 font-mono tabular-nums text-slate-300">{r.verdict === "ERROR" ? "—" : r.score}</td>
                      <td className="py-2 pr-3 font-mono tabular-nums">{r.herg != null ? `${Math.round(r.herg * 100)}%` : "—"}</td>
                      <td className="py-2 pr-3 font-mono tabular-nums">{r.dili != null ? `${Math.round(r.dili * 100)}%` : "—"}</td>
                      <td className="py-2 pr-3 font-mono tabular-nums">{r.ames != null ? `${Math.round(r.ames * 100)}%` : "—"}</td>
                      <td className="py-2 pr-3 text-slate-400">{r.error ? <span className="text-slate-600 italic">{r.error}</span> : r.flags.length ? r.flags.join(" · ") : <span className="text-emerald-400/70">clean</span>}</td>
                      <td className="py-2 pr-3">
                        <Link href={`/dashboard?smiles=${encodeURIComponent(r.smiles)}`} className="inline-flex items-center gap-0.5 text-cyan-300 hover:text-cyan-200" title="Open in full L1 report">
                          full <ArrowUpRight className="w-2.5 h-2.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[9px] text-slate-600 italic mt-3">
              <FlaskConical className="inline w-2.5 h-2.5 mr-1" />
              Fast triage on ADMET-AI safety endpoints + calibrated ICH thresholds. Directional pre-lab ranking — not a wet-lab replacement.
              Open any row for the full Layer-1 report (read-across, benefit-risk, evidence).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
