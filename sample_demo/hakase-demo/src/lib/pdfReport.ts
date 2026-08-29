/**
 * Structured, exhaustive PDF reporting for the demo.
 *
 * Reports are generated from the complete run payload. The renderer preserves
 * every scalar, null, empty collection and nested record, but presents those
 * values as named sections and compact tables instead of a field-path dump.
 */
import { jsPDF } from "jspdf";

export type PdfReportSource = { title: string; value: unknown };
export type PdfReportFinding = { label: string; value: unknown };

type FlatEntry = { path: string; value: string };
type Scalar = string | number | boolean | null | undefined;

const PAGE = { width: 595.28, height: 841.89, left: 38, right: 38, top: 48, bottom: 46 };
const CONTENT_WIDTH = PAGE.width - PAGE.left - PAGE.right;
const BOTTOM_Y = PAGE.height - PAGE.bottom;

function plain(value: unknown): string {
  if (value === null) return "Not supplied (null)";
  if (value === undefined) return "Not supplied (undefined)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value || "Not supplied (empty string)";
  return String(value);
}

/** Built-in PDF fonts are kept ASCII-safe so any report opens reliably. */
function printable(value: unknown): string {
  return plain(value)
    .replaceAll("\u2013", "-").replaceAll("\u2014", "-").replaceAll("\u2011", "-")
    .replaceAll("\u00b7", " / ").replaceAll("\u2022", "-").replaceAll("\u2192", "->")
    .replaceAll("\u00b2", "^2").replaceAll("\u00b3", "^3").replaceAll("\u00b5", "u")
    .replaceAll("\u03bb", "lambda").replaceAll("\u03c1", "rho").replaceAll("\u00d7", "x")
    .replace(/[^\x20-\x7E\n\t]/g, "?");
}

function isScalar(value: unknown): value is Scalar {
  return value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function flatten(value: unknown, path = "", into: FlatEntry[] = [], seen = new WeakSet<object>()): FlatEntry[] {
  if (isScalar(value)) { into.push({ path: path || "value", value: printable(value) }); return into; }
  if (seen.has(value as object)) { into.push({ path: path || "value", value: "[circular reference]" }); return into; }
  seen.add(value as object);
  if (Array.isArray(value)) {
    if (value.length === 0) into.push({ path: path || "value", value: "[]" });
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, into, seen));
    return into;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) into.push({ path: path || "value", value: "{}" });
  entries.forEach(([key, item]) => flatten(item, path ? `${path}.${key}` : key, into, seen));
  return into;
}

function humanise(token: string) {
  return token.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sectionName(path: string) {
  return path.replace(/\[(\d+)\]/g, " / Record $1").split(".").map(humanise).join(" / ");
}

function timestamp() { return new Date().toISOString().replace("T", " ").replace("Z", " UTC"); }
function chunks<T>(items: T[], size: number) { return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size)); }

export function buildExhaustivePdf({
  title, subtitle, sources, findings = [],
}: {
  title: string;
  subtitle: string;
  sources: PdfReportSource[];
  findings?: PdfReportFinding[];
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const allEntries = sources.flatMap((source) => flatten(source.value, source.title));
  let y = PAGE.top;

  const newPage = () => { doc.addPage(); y = PAGE.top; };
  const ensure = (height: number) => { if (y + height > BOTTOM_Y) newPage(); };
  const line = (colour: [number, number, number] = [219, 229, 238]) => {
    doc.setDrawColor(...colour); doc.line(PAGE.left, y, PAGE.width - PAGE.right, y);
  };
  const heading = (content: string, level: 1 | 2 | 3 = 2) => {
    const size = level === 1 ? 19 : level === 2 ? 13 : 10;
    ensure(size + 20);
    doc.setFont("helvetica", "bold"); doc.setFontSize(size); doc.setTextColor(16, 32, 47);
    doc.text(printable(content), PAGE.left, y); y += size + 7;
    line(level === 1 ? [24, 180, 232] : [181, 229, 248]); y += 8;
  };
  const paragraph = (content: string, options: { size?: number; bold?: boolean; colour?: [number, number, number]; gap?: number } = {}) => {
    const size = options.size ?? 9.5;
    doc.setFont("helvetica", options.bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...(options.colour ?? [48, 65, 82]));
    const lines = doc.splitTextToSize(printable(content), CONTENT_WIDTH) as string[];
    const height = Math.max(lines.length, 1) * (size + 3);
    ensure(height + (options.gap ?? 6)); doc.text(lines, PAGE.left, y); y += height + (options.gap ?? 6);
  };
  const drawTable = (headers: string[], rows: string[][], options: { caption?: string; fieldValue?: boolean } = {}) => {
    if (options.caption) paragraph(options.caption, { size: 8.5, colour: [91, 111, 130], gap: 4 });
    const indexWidth = Math.max(34, CONTENT_WIDTH * 0.08);
    const widths = options.fieldValue
      ? [CONTENT_WIDTH * 0.34, CONTENT_WIDTH * 0.66]
      : headers.map((_, index) => index === 0 ? indexWidth : (CONTENT_WIDTH - indexWidth) / Math.max(headers.length - 1, 1));
    const headerHeight = 20;
    const drawHeader = () => {
      ensure(headerHeight);
      let x = PAGE.left;
      doc.setFillColor(21, 80, 112); doc.rect(PAGE.left, y, CONTENT_WIDTH, headerHeight, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.8); doc.setTextColor(255, 255, 255);
      headers.forEach((header, index) => { doc.text(doc.splitTextToSize(printable(header), widths[index] - 8) as string[], x + 4, y + 12); x += widths[index]; });
      y += headerHeight;
    };
    drawHeader();
    rows.forEach((row, rowIndex) => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.1);
      const cells = row.map((cell, index) => doc.splitTextToSize(printable(cell), widths[index] - 8) as string[]);
      const rowHeight = Math.max(18, ...cells.map((cell) => cell.length * 9.4 + 8));
      if (y + rowHeight > BOTTOM_Y) { newPage(); drawHeader(); }
      doc.setFillColor(rowIndex % 2 === 0 ? 248 : 252, rowIndex % 2 === 0 ? 251 : 254, 255);
      doc.rect(PAGE.left, y, CONTENT_WIDTH, rowHeight, "F");
      let x = PAGE.left;
      cells.forEach((cell, index) => {
        doc.setDrawColor(224, 233, 241); doc.rect(x, y, widths[index], rowHeight);
        doc.setTextColor(index === 0 ? 25 : 51, index === 0 ? 92 : 67, index === 0 ? 124 : 85);
        doc.text(cell, x + 4, y + 11);
        x += widths[index];
      });
      y += rowHeight;
    });
    y += 9;
  };
  const footer = () => {
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page); doc.setDrawColor(219, 229, 238); doc.line(PAGE.left, PAGE.height - 31, PAGE.width - PAGE.right, PAGE.height - 31);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(91, 111, 130);
      doc.text("HakaseAI demonstration report - complete structured data appendix", PAGE.left, PAGE.height - 18);
      doc.text(`Page ${page} of ${pages}`, PAGE.width - PAGE.right, PAGE.height - 18, { align: "right" });
    }
  };
  const renderNode = (value: unknown, path: string) => {
    if (isScalar(value)) { drawTable(["Field", "Value"], [[humanise(path), printable(value)]], { fieldValue: true }); return; }
    if (Array.isArray(value)) {
      heading(`${sectionName(path)} (${value.length} records)`, 3);
      if (value.length === 0) { paragraph("No records were returned for this field.", { size: 8.8, colour: [91, 111, 130] }); return; }
      if (value.every(isScalar)) { drawTable(["#", "Value"], value.map((item, index) => [String(index + 1), printable(item)])); return; }
      const objects = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
      const keys = [...new Set(objects.flatMap((item) => Object.entries(item).filter(([, entry]) => isScalar(entry)).map(([key]) => key)))];
      if (keys.length) {
        chunks(keys, 4).forEach((keyGroup, groupIndex) => drawTable(
          ["#", ...keyGroup.map(humanise)],
          value.map((item, index) => {
            const object = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
            return [String(index + 1), ...keyGroup.map((key) => isScalar(object[key]) ? printable(object[key]) : "—")];
          }),
          { caption: keys.length > 4 ? `Columns ${groupIndex * 4 + 1}-${Math.min((groupIndex + 1) * 4, keys.length)} of ${keys.length}` : undefined },
        ));
      }
      value.forEach((item, index) => {
        if (item && typeof item === "object") Object.entries(item as Record<string, unknown>).filter(([, entry]) => !isScalar(entry)).forEach(([key, entry]) => renderNode(entry, `${path}[${index}].${key}`));
      });
      return;
    }
    const object = value as Record<string, unknown>;
    const scalars = Object.entries(object).filter(([, entry]) => isScalar(entry));
    if (path && !path.includes("[")) heading(sectionName(path), 3);
    if (scalars.length) drawTable(["Field", "Value"], scalars.map(([key, entry]) => [humanise(key), printable(entry)]), { fieldValue: true });
    Object.entries(object).filter(([, entry]) => !isScalar(entry)).forEach(([key, entry]) => renderNode(entry, path ? `${path}.${key}` : key));
  };

  doc.setProperties({ title, subject: "Complete structured simulation output report", author: "HakaseAI demonstration workspace" });
  heading(title, 1);
  paragraph(subtitle, { size: 11, colour: [79, 101, 121], gap: 13 });
  paragraph(`Generated ${timestamp()}`, { size: 8.8, gap: 10 });
  paragraph("This is a review dossier, not a screen scrape. Read the decision summary first, then use the grouped tables to inspect each evidence block. The final sections retain the complete record so no parameter has been omitted.", { bold: true, colour: [7, 90, 124], gap: 14 });
  if (findings.length) {
    heading("Decision summary");
    drawTable(["Item", "Recorded value"], findings.map((finding) => [finding.label, printable(finding.value)]), { fieldValue: true });
  }
  heading("Report map");
  drawTable(["Section", "Values retained"], sources.map((source) => [source.title, `${flatten(source.value).length.toLocaleString()} values`]), { fieldValue: true });
  paragraph(`Coverage statement: ${allEntries.length.toLocaleString()} values are represented below. Each nested record, empty collection, null and submitted input is retained in a labelled table.`, { size: 9, colour: [7, 90, 124], gap: 12 });
  paragraph("Data status: structure-derived physicochemical properties may use browser-side RDKit. Pharmacology, ADMET, virtual animal and translation outputs are demonstration heuristics, not decision-grade evidence.", { size: 8.8, colour: [145, 26, 26], gap: 15 });

  sources.forEach((source) => {
    heading(source.title);
    paragraph(`${flatten(source.value).length.toLocaleString()} values retained in this source block.`, { size: 8.8, colour: [91, 111, 130], gap: 8 });
    renderNode(source.value, "");
  });
  footer();
  return doc;
}

export function downloadExhaustivePdf({ filename, title, subtitle, sources, findings }: {
  filename: string;
  title: string;
  subtitle: string;
  sources: PdfReportSource[];
  findings?: PdfReportFinding[];
}) {
  const doc = buildExhaustivePdf({ title, subtitle, sources, findings });
  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
