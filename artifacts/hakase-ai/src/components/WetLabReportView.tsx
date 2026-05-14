import { useEffect, useMemo, useRef } from "react";
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

  // Ref to the rendered <article> so we can clone its HTML into a print iframe.
  const articleRef = useRef<HTMLElement | null>(null);

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

  // Print via an off-screen iframe with only the report HTML inside.
  // This sidesteps the entire app's fixed/flex/overflow layout and gives
  // the browser a clean, paginating document for "Save as PDF".
  const handlePrint = () => {
    const article = articleRef.current;
    if (!article) {
      window.print();
      return;
    }
    // Collect the parent document's stylesheets (KaTeX, app CSS) so the
    // iframe inherits the same typography and chart styling.
    const styleNodes = Array.from(
      document.querySelectorAll('link[rel="stylesheet"], style'),
    )
      .map((n) => n.outerHTML)
      .join("\n");

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    document.body.appendChild(iframe);

    const cleanup = () => {
      // Defer removal so the print dialog has the iframe attached.
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1000);
    };

    const docHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${(input.molName || "Wet-Lab Report").replace(/[<&>]/g, "")} — Wet-Lab Report</title>
${styleNodes}
<style>
  @page { size: A4; margin: 14mm 14mm 16mm 14mm; }
  html, body { background: #ffffff !important; color: #0f172a !important; margin: 0; padding: 0; }
  body { padding: 0; }
  .wet-lab-report { max-width: none !important; margin: 0 !important; padding: 0 !important; box-shadow: none !important; border-radius: 0 !important; background: #ffffff !important; color: #0f172a !important; }
  .wet-lab-report h1, .wet-lab-report h2, .wet-lab-report h3 { break-after: avoid; page-break-after: avoid; }
  .wet-lab-report table, .wet-lab-report pre, .wet-lab-report .wet-lab-chart, .wet-lab-report .katex-display { break-inside: avoid; page-break-inside: avoid; }
  .wet-lab-report tr, .wet-lab-report li { break-inside: avoid; page-break-inside: avoid; }
</style>
</head>
<body>${article.outerHTML}</body>
</html>`;

    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) {
      cleanup();
      window.print();
      return;
    }
    doc.open();
    doc.write(docHtml);
    doc.close();

    // Wait for stylesheets / fonts (KaTeX) to load inside the iframe before printing.
    const triggerPrint = () => {
      try {
        win.focus();
        win.print();
      } catch {
        // ignore
      }
      cleanup();
    };
    if (doc.readyState === "complete") {
      // Give KaTeX/web-fonts a tick to settle.
      setTimeout(triggerPrint, 250);
    } else {
      iframe.onload = () => setTimeout(triggerPrint, 250);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-[#05060a] flex flex-col">
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
      <div className="flex-1 overflow-y-auto">
        <article
          ref={articleRef}
          className="wet-lab-report mx-auto max-w-[920px] px-10 py-12 bg-white text-slate-900 my-6 rounded-md shadow-2xl"
        >
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
