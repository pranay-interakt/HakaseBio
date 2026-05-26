import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";

type Narrative = {
  executiveSummary?: string;
  molecularProfile?: string;
  potencyAndBinding?: string;
  admetCommentary?: string;
  riskAssessment?: string;
  recommendedNextSteps?: string[];
};

export type Layer1ReportInput = {
  smiles: string;
  indication: string;
  molProps: Record<string, unknown> | null;
  simResults: Record<string, unknown> | null;
  inVitroResults: Record<string, unknown> | null;
  captureSelector?: string;
};

const fmt = (v: unknown, digits = 2): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(digits);
  }
  return String(v);
};

async function fetchNarrative(input: Layer1ReportInput): Promise<Narrative> {
  try {
    const res = await fetch("/api/report-narrative", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        smiles: input.smiles,
        indication: input.indication,
        molProps: input.molProps,
        simResults: input.simResults,
        inVitroResults: input.inVitroResults,
      }),
    });
    if (!res.ok) return {};
    const json = await res.json();
    return (json.narrative as Narrative) ?? {};
  } catch {
    return {};
  }
}

export async function generateLayer1Report(input: Layer1ReportInput): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (need: number) => {
    if (y + need > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const drawHeading = (text: string, size = 16) => {
    ensureSpace(size + 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(30, 30, 50);
    doc.text(text, margin, y);
    y += size + 8;
    doc.setDrawColor(180, 180, 200);
    doc.line(margin, y, margin + contentW, y);
    y += 12;
  };

  const drawParagraph = (text: string, size = 10) => {
    if (!text) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(40, 40, 60);
    const lines = doc.splitTextToSize(text, contentW) as string[];
    for (const line of lines) {
      ensureSpace(size + 4);
      doc.text(line, margin, y);
      y += size + 4;
    }
    y += 6;
  };

  const drawKVTable = (rows: Array<[string, string]>) => {
    const rowH = 18;
    const labelW = 180;
    doc.setFontSize(10);
    for (const [k, v] of rows) {
      ensureSpace(rowH);
      doc.setFillColor(245, 246, 250);
      doc.rect(margin, y - 12, labelW, rowH, "F");
      doc.setFont("helvetica", "bold");
      doc.setTextColor(60, 60, 80);
      doc.text(k, margin + 8, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 30, 50);
      const vLines = doc.splitTextToSize(v, contentW - labelW - 16) as string[];
      doc.text(vLines, margin + labelW + 8, y);
      y += Math.max(rowH, vLines.length * 12 + 4);
    }
    y += 8;
  };

  // ── Cover page ───────────────────────────────────────────────
  doc.setFillColor(20, 16, 40);
  doc.rect(0, 0, pageW, 160, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("HAKASE AI · BIODIGITAL TWIN", margin, 60);
  doc.setFontSize(22);
  doc.text("Layer 1 — In Vitro Digital Twin Report", margin, 92);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(180, 180, 220);
  doc.text(`Indication: ${input.indication || "—"}`, margin, 116);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 134);

  y = 200;
  drawHeading("Compound", 14);
  drawKVTable([
    ["SMILES", input.smiles || "—"],
    ["Indication", input.indication || "—"],
    ["Molecular Weight", `${fmt((input.molProps as { mw?: number })?.mw)} g/mol`],
    ["LogP", fmt((input.molProps as { logP?: number })?.logP)],
    ["TPSA", `${fmt((input.molProps as { tpsa?: number })?.tpsa)} Å²`],
    ["HBD / HBA", `${fmt((input.molProps as { hbd?: number })?.hbd, 0)} / ${fmt((input.molProps as { hba?: number })?.hba, 0)}`],
    ["QED (approx)", fmt((input.molProps as { qed_approx?: number })?.qed_approx)],
  ]);

  // ── Narrative from Claude ────────────────────────────────────
  const narrative = await fetchNarrative(input);

  if (narrative.executiveSummary) {
    drawHeading("Executive Summary");
    drawParagraph(narrative.executiveSummary);
  }
  if (narrative.molecularProfile) {
    drawHeading("Molecular Profile");
    drawParagraph(narrative.molecularProfile);
  }
  if (narrative.potencyAndBinding) {
    drawHeading("Potency & Target Engagement");
    drawParagraph(narrative.potencyAndBinding);
  }
  if (narrative.admetCommentary) {
    drawHeading("ADMET Commentary");
    drawParagraph(narrative.admetCommentary);
  }
  if (narrative.riskAssessment) {
    drawHeading("Risk Assessment");
    drawParagraph(narrative.riskAssessment);
  }

  // ── Key numbers ──────────────────────────────────────────────
  const iv = (input.inVitroResults ?? {}) as {
    overallRisk?: string;
    inVitroScore?: number;
    doseResponse?: { ic50_nM?: number | null };
    potencyClass?: string;
    caco2Class?: string;
    microsomalClass?: string;
    hERGClass?: string;
    selectivityClass?: string;
  };
  drawHeading("In Vitro Headline Numbers");
  drawKVTable([
    ["Overall Risk", fmt(iv.overallRisk)],
    ["In Vitro Score", iv.inVitroScore != null ? `${(iv.inVitroScore * 100).toFixed(1)}%` : "—"],
    ["IC50", iv.doseResponse?.ic50_nM != null ? `${iv.doseResponse.ic50_nM.toFixed(1)} nM` : "—"],
    ["Potency Class", fmt(iv.potencyClass)],
    ["Caco-2 Permeability", fmt(iv.caco2Class)],
    ["Microsomal Stability", fmt(iv.microsomalClass)],
    ["hERG Risk", fmt(iv.hERGClass)],
    ["Selectivity", fmt(iv.selectivityClass)],
  ]);

  if (narrative.recommendedNextSteps && narrative.recommendedNextSteps.length > 0) {
    drawHeading("Recommended Next Steps");
    for (const step of narrative.recommendedNextSteps) {
      drawParagraph(`•  ${step}`);
    }
  }

  // ── Captured visuals from results panel ──────────────────────
  const sel = input.captureSelector ?? "#demo-results";
  const node = document.querySelector(sel) as HTMLElement | null;
  if (node) {
    try {
      const canvas = await html2canvas(node, {
        backgroundColor: "#0a0b12",
        scale: 1.5,
        useCORS: true,
        logging: false,
      });
      const imgData = canvas.toDataURL("image/png");
      const imgW = contentW;
      const imgH = (canvas.height / canvas.width) * imgW;
      const usable = pageH - margin * 2;
      let drawn = 0;
      while (drawn < imgH) {
        doc.addPage();
        const sliceH = Math.min(usable, imgH - drawn);
        // Draw the full image but offset upward so the visible window is the slice.
        // jsPDF doesn't crop, so we use a clipping rectangle.
        doc.saveGraphicsState();
        doc.rect(margin, margin, imgW, sliceH).clip();
        doc.addImage(imgData, "PNG", margin, margin - drawn, imgW, imgH);
        doc.restoreGraphicsState();
        drawn += sliceH;
      }
      // Add a heading on the first visuals page
      doc.setPage(doc.getNumberOfPages() - Math.ceil(imgH / usable) + 1);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(120, 120, 140);
      doc.text("Layer 1 — Captured Visuals", margin, margin - 12);
      doc.setPage(doc.getNumberOfPages());
    } catch (err) {
      console.warn("[pdfReport] visual capture failed", err);
    }
  }

  // ── Footer on every page ─────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 170);
    doc.text(`HakaseAI · Layer 1 Report · Page ${i} of ${pageCount}`, margin, pageH - 20);
    doc.text("Pre-clinical research only · Not a clinical recommendation", pageW - margin, pageH - 20, { align: "right" });
  }

  const safeName = (input.indication || "compound").replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
  doc.save(`HakaseAI_Layer1_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
