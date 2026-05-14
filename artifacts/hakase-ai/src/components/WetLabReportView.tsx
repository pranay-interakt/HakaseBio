import { useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { X, Download, Printer, Copy } from "lucide-react";
import "katex/dist/katex.min.css";
import { buildWetLabMarkdownReport, type ReportInput } from "@/lib/wetLabReportMarkdown";
import { WetLabReportChart } from "./WetLabReportChart";

type Props = ReportInput & {
  open: boolean;
  onClose: () => void;
};

export function WetLabReportView({ open, onClose, ...input }: Props) {
  // Memo on the primitive inputs that drive the report, not on the spread
  // object reference (which is recreated every render and would defeat the
  // memo, forcing markdown + KaTeX regeneration on every overlay rerender).
  const { smiles, molName, molProps, iv, therapeuticArea, uniprotId, proteinName, pdbId, indication } = input;
  const markdown = useMemo(
    () => (open ? buildWetLabMarkdownReport({ smiles, molName, molProps, iv, therapeuticArea, uniprotId, proteinName, pdbId, indication }) : ""),
    [open, smiles, molName, molProps, iv, therapeuticArea, uniprotId, proteinName, pdbId, indication],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const fileName = `WetLabReport_${input.molName?.replace(/\s+/g, "_") || "compound"}_${new Date().toISOString().slice(0, 10)}.md`;

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      // ignore — browser permission denied
    }
  };

  const handlePrint = () => window.print();

  return (
    <div className="fixed inset-0 z-[100] bg-[#05060a] flex flex-col print:bg-white print:relative print:inset-auto">
      {/* Header toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-[#0d0f17]/80 backdrop-blur print:hidden">
        <div>
          <div className="text-[12px] text-slate-400">Wet-Lab Report</div>
          <div className="text-[14px] font-semibold text-white">
            {input.molName || "Compound"} · {input.uniprotId ?? "no validated target"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 rounded-md text-[11px] text-slate-300 hover:text-white border border-white/10 hover:border-white/20 inline-flex items-center gap-1.5"
            title="Copy raw Markdown"
          >
            <Copy className="w-3.5 h-3.5" /> Copy MD
          </button>
          <button
            onClick={handleDownload}
            className="px-3 py-1.5 rounded-md text-[11px] text-slate-300 hover:text-white border border-white/10 hover:border-white/20 inline-flex items-center gap-1.5"
            title="Download as .md"
          >
            <Download className="w-3.5 h-3.5" /> Download
          </button>
          <button
            onClick={handlePrint}
            className="px-3 py-1.5 rounded-md text-[11px] text-slate-300 hover:text-white border border-white/10 hover:border-white/20 inline-flex items-center gap-1.5"
            title="Print / Save as PDF"
          >
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
          <button
            onClick={onClose}
            className="ml-2 px-3 py-1.5 rounded-md text-[11px] bg-violet-500/15 border border-violet-500/30 text-violet-200 hover:bg-violet-500/25 inline-flex items-center gap-1.5"
            title="Close (Esc)"
          >
            <X className="w-3.5 h-3.5" /> Close
          </button>
        </div>
      </div>

      {/* Document */}
      <div className="flex-1 overflow-y-auto print:overflow-visible">
        <article className="wet-lab-report mx-auto max-w-[920px] px-10 py-12 bg-white text-slate-900 print:max-w-none print:px-0 print:py-0 my-6 print:my-0 rounded-md print:rounded-none shadow-2xl print:shadow-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeRaw, rehypeKatex]}
            components={{
              code({ className, children, ...rest }) {
                const lang = /language-(\w[\w-]*)/.exec(className || "")?.[1];
                if (lang === "chart-dose-response") {
                  try {
                    const payload = JSON.parse(String(children).trim());
                    return <WetLabReportChart payload={payload} />;
                  } catch {
                    return (
                      <pre className="chart-error">
                        Failed to render dose-response chart (invalid payload).
                      </pre>
                    );
                  }
                }
                return (
                  <code className={className} {...rest}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {markdown}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
