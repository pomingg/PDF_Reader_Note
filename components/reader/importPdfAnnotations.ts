"use client";

import { colorKeyFromRgb } from "@/lib/colors";
import type { ImportedAnnotation, NormRect } from "@/lib/types";
import type { PDFDocumentProxy, PDFPageProxy } from "./pdfjs";

/** Text-markup annotations become highlights. */
const MARKUP = new Set(["Highlight", "Underline", "StrikeOut", "Squiggly"]);
/** Sticky notes and text boxes become page notes. */
const NOTES = new Set(["Text", "FreeText"]);
/** Drawings and shapes become area snapshots. */
const SHAPES = new Set(["Ink", "Square", "Circle", "Polygon", "PolyLine", "Line"]);

// The subset of pdf.js annotation data we read.
interface AnnotData {
  id: string;
  subtype: string;
  rect: number[];
  quadPoints?: ArrayLike<number> | null;
  color?: ArrayLike<number> | null;
  contentsObj?: { str?: string };
  inReplyTo?: string;
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

/** Map an annotation colour onto the nearest of our four highlighter colours by hue. */
export const colorKey = colorKeyFromRgb;

export const DOC_NOTE_PREFIX = "【文件筆記】";

/**
 * Split annotation text into comment and tags. Notes this app wrote into a PDF
 * end with a "#tag #tag" line and document notes start with 【文件筆記】;
 * undo both so a round trip gives back the original note.
 */
export function parseContents(raw: string): { comment: string; tags: string[]; docNote: boolean } {
  let text = raw.replace(/\r\n?/g, "\n").trim();
  const docNote = text.startsWith(DOC_NOTE_PREFIX);
  if (docNote) text = text.slice(DOC_NOTE_PREFIX.length).trim();
  const paras = text.split(/\n\s*\n/);
  const last = paras[paras.length - 1]?.trim() ?? "";
  let tags: string[] = [];
  if (last && /^(#[^\s#]+\s*)+$/.test(last)) {
    tags = last.split(/\s+/).map((t) => t.replace(/^#/, "").replace(/_/g, " "));
    paras.pop();
  }
  return { comment: paras.join("\n\n").trim(), tags, docNote };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Axis-aligned boxes [x1, y1, x2, y2] (PDF space) of each quad, or the rect when there are none. */
function quadBoxes(a: AnnotData): number[][] {
  const q = a.quadPoints;
  if (!q || q.length < 8) return [[a.rect[0], a.rect[1], a.rect[2], a.rect[3]]];
  const out: number[][] = [];
  for (let i = 0; i + 7 < q.length; i += 8) {
    const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]];
    const ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
    out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }
  return out;
}

/** Rough advance width of a character in em: CJK / full-width ones are about twice as wide as Latin. */
export function charWeight(ch: string) {
  const c = ch.codePointAt(0) ?? 0;
  const wide =
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    c >= 0x20000;
  return wide ? 1 : 0.5;
}

/** Characters of the page text whose centre falls inside one of the boxes. */
function textInBoxes(items: TextItem[], boxes: number[][]): string {
  const inside = (x: number, y: number) =>
    boxes.some(([x1, y1, x2, y2]) => x >= x1 - 1 && x <= x2 + 1 && y >= y1 - 1 && y <= y2 + 1);
  let out = "";
  let lastY: number | null = null;
  for (const it of items) {
    const chars = [...it.str];
    if (!chars.length) continue;
    const [a, b, c, d, e, f] = it.transform;
    const dirLen = Math.hypot(a, b) || 1;
    const upLen = Math.hypot(c, d) || 1;
    const fontH = it.height || upLen;
    let picked = "";
    // Spread the item's width over its characters by their approximate widths.
    const weights = chars.map(charWeight);
    const total = weights.reduce((sum, w) => sum + w, 0) || 1;
    let before = 0;
    chars.forEach((ch, i) => {
      const along = ((before + weights[i] / 2) / total) * it.width;
      before += weights[i];
      const x = e + (a / dirLen) * along + (c / upLen) * fontH * 0.35;
      const y = f + (b / dirLen) * along + (d / upLen) * fontH * 0.35;
      if (inside(x, y)) picked += ch;
    });
    if (!picked) continue;
    if (lastY !== null && Math.abs(f - lastY) > fontH * 0.5) {
      // New line: keep a space between Latin words, nothing between CJK characters.
      const prev = out.slice(-1);
      if (/[A-Za-z0-9,.;:]/.test(prev) && /[A-Za-z0-9]/.test(picked[0])) out += " ";
    }
    out += picked;
    lastY = f;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Render a page (including its annotations) once, to crop snapshots for drawings. */
async function renderPage(page: PDFPageProxy) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d")!, canvas, viewport }).promise;
  return canvas;
}

function crop(canvas: HTMLCanvasElement, r: NormRect): string {
  const pad = 6;
  const x = Math.max(0, Math.floor(r.x * canvas.width) - pad);
  const y = Math.max(0, Math.floor(r.y * canvas.height) - pad);
  const w = Math.min(canvas.width - x, Math.ceil(r.w * canvas.width) + pad * 2);
  const h = Math.min(canvas.height - y, Math.ceil(r.h * canvas.height) + pad * 2);
  const out = document.createElement("canvas");
  out.width = Math.max(1, w);
  out.height = Math.max(1, h);
  out.getContext("2d")!.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

/**
 * Read the highlights, notes and drawings that other PDF apps (Acrobat, Edge,
 * Preview, GoodNotes, PDF Expert...) saved inside the file.
 */
export async function extractPdfAnnotations(pdf: PDFDocumentProxy): Promise<ImportedAnnotation[]> {
  const out: ImportedAnnotation[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const annots = (await page.getAnnotations()) as unknown as AnnotData[];
    const relevant = annots.filter((a) => MARKUP.has(a.subtype) || NOTES.has(a.subtype) || SHAPES.has(a.subtype));
    if (!relevant.length) continue;

    const vp = page.getViewport({ scale: 1 });
    const norm = ([x1, y1, x2, y2]: number[]): NormRect => {
      const [vx1, vy1] = vp.convertToViewportPoint(x1, y1);
      const [vx2, vy2] = vp.convertToViewportPoint(x2, y2);
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      const left = clamp(Math.min(vx1, vx2) / vp.width);
      const top = clamp(Math.min(vy1, vy2) / vp.height);
      return {
        page: n,
        x: left,
        y: top,
        w: clamp(Math.max(vx1, vx2) / vp.width) - left,
        h: clamp(Math.max(vy1, vy2) / vp.height) - top,
      };
    };
    let text: TextItem[] | null = null;
    let rendered: HTMLCanvasElement | null = null;
    const byId = new Map<string, ImportedAnnotation>();

    for (const a of relevant) {
      const contents = (a.contentsObj?.str ?? "").trim();
      const key = `${a.subtype}:${n}:${a.rect.map((v) => Math.round(v)).join(",")}:${hash(contents)}`;

      // A reply to another annotation: append it to that note's comment.
      const parsed = parseContents(contents);
      if (a.inReplyTo && byId.has(a.inReplyTo)) {
        const parent = byId.get(a.inReplyTo)!;
        if (contents) parent.comment = [parent.comment, contents].filter(Boolean).join("\n\n");
        continue;
      }

      let item: ImportedAnnotation | null = null;
      if (MARKUP.has(a.subtype)) {
        const boxes = quadBoxes(a);
        text ??= ((await page.getTextContent()).items as TextItem[]).filter((i) => "str" in i);
        const quote = textInBoxes(text, boxes);
        const rects = boxes.map(norm).filter((r) => r.w > 0 && r.h > 0);
        if (!rects.length) continue;
        if (quote) {
          item = { type: "highlight", color: colorKey(a.color), rects, quote, comment: parsed.comment, tags: parsed.tags, externalKey: key };
        } else {
          // Scanned page with no text layer: keep it as a picture of the marked area.
          rendered ??= await renderPage(page);
          const box = rects.reduce((u, r) => ({
            page: n,
            x: Math.min(u.x, r.x),
            y: Math.min(u.y, r.y),
            w: Math.max(u.x + u.w, r.x + r.w) - Math.min(u.x, r.x),
            h: Math.max(u.y + u.h, r.y + r.h) - Math.min(u.y, r.y),
          }));
          item = { type: "area", color: colorKey(a.color), rects: [box], image: crop(rendered, box), comment: parsed.comment, tags: parsed.tags, externalKey: key };
        }
      } else if (NOTES.has(a.subtype)) {
        if (!parsed.comment) continue;
        item = { type: "note", page: parsed.docNote ? null : n, comment: parsed.comment, tags: parsed.tags, externalKey: key };
      } else {
        const r = norm(a.rect);
        if (r.w <= 0 || r.h <= 0) continue;
        rendered ??= await renderPage(page);
        item = { type: "area", color: colorKey(a.color), rects: [r], image: crop(rendered, r), comment: parsed.comment, tags: parsed.tags, externalKey: key };
      }
      byId.set(a.id, item);
      out.push(item);
    }
  }
  return out;
}
