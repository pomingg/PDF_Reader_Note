import { readFileSync } from "node:fs";
import { PDFDocument, PDFHexString, PDFString, type PDFPage, type PDFRef } from "pdf-lib";
import { documentFilePath, getDocument, HttpError } from "./library";
import { getColors, listAnnotations } from "./notes";
import type { Annotation, ColorDef, NormRect } from "./types";

const AUTHOR = "PDF 閱讀筆記";
/** Marks a whole-document note written as a sticky note on page 1 (read back by the importer). */
const DOC_NOTE_PREFIX = "【文件筆記】";

type Matrix = [number, number, number, number, number, number];

/**
 * The same page -> screen transform pdf.js uses (PageViewport, scale 1), so the
 * 0-1 positions saved in the reader map back onto the exact PDF coordinates.
 */
export function viewportTransform(view: [number, number, number, number], rotation: number) {
  const [x1, y1, x2, y2] = view;
  const centerX = (x2 + x1) / 2;
  const centerY = (y2 + y1) / 2;
  let r = rotation % 360;
  if (r < 0) r += 360;
  const [a, b, c, d] =
    r === 90 ? [0, 1, 1, 0] : r === 180 ? [-1, 0, 0, 1] : r === 270 ? [0, -1, -1, 0] : [1, 0, 0, -1];
  let offX: number, offY: number, width: number, height: number;
  if (a === 0) {
    offX = Math.abs(centerY - y1);
    offY = Math.abs(centerX - x1);
    width = y2 - y1;
    height = x2 - x1;
  } else {
    offX = Math.abs(centerX - x1);
    offY = Math.abs(centerY - y1);
    width = x2 - x1;
    height = y2 - y1;
  }
  const m: Matrix = [a, b, c, d, offX - a * centerX - c * centerY, offY - b * centerX - d * centerY];
  return { matrix: m, width, height };
}

/** Normalised (0-1, top-left origin) viewport point -> PDF user-space point. */
function makeToUser(page: PDFPage) {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  // pdf.js shows the intersection of CropBox and MediaBox.
  const vx1 = Math.max(media.x, crop.x);
  const vy1 = Math.max(media.y, crop.y);
  const vx2 = Math.min(media.x + media.width, crop.x + crop.width);
  const vy2 = Math.min(media.y + media.height, crop.y + crop.height);
  const view: [number, number, number, number] =
    vx2 > vx1 && vy2 > vy1 ? [vx1, vy1, vx2, vy2] : [media.x, media.y, media.x + media.width, media.y + media.height];
  const { matrix: [a, b, c, d, e, f], width, height } = viewportTransform(view, page.getRotation().angle);
  const det = a * d - b * c;
  return (nx: number, ny: number): [number, number] => {
    const vx = nx * width - e;
    const vy = ny * height - f;
    return [(d * vx - c * vy) / det, (-b * vx + a * vy) / det];
  };
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const num = (v: number) => (Math.round(v * 1000) / 1000).toString();

function bbox(points: [number, number][], pad = 0): [number, number, number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

function noteText(a: Annotation) {
  const tags = a.tags.length ? a.tags.map((t) => `#${t.replace(/\s+/g, "_")}`).join(" ") : "";
  return [a.comment.trim(), tags].filter(Boolean).join("\n\n");
}

/** A copy of the document's PDF with our notes added as standard PDF annotations. */
export async function annotatedPdf(documentId: string): Promise<{ filename: string; body: Uint8Array }> {
  const doc = getDocument(documentId);
  const bytes = readFileSync(documentFilePath(documentId));
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new HttpError(400, "這份 PDF 有加密或格式特殊，無法寫入筆記");
  }
  const colors = getColors();
  const ctx = pdf.context;
  const pages = pdf.getPages();
  // Annotations imported from this PDF are already in it.
  const notes = listAnnotations(documentId).filter((a) => a.origin !== "pdf");
  const stickyCount = new Map<number, number>();

  const add = (page: PDFPage, dict: Record<string, unknown>) => {
    const ref = ctx.register(ctx.obj({ Type: "Annot", F: 4, P: page.ref, ...dict } as never)) as PDFRef;
    page.node.addAnnot(ref);
  };
  const common = (a: Annotation, color: [number, number, number]) => ({
    C: color,
    T: PDFHexString.fromText(AUTHOR),
    Contents: PDFHexString.fromText(noteText(a)),
    NM: PDFString.of(`prn-${a.id}`),
    M: PDFString.fromDate(new Date(a.updatedAt)),
    CreationDate: PDFString.fromDate(new Date(a.createdAt)),
  });
  const form = (box: number[], content: string, resources?: Record<string, unknown>) =>
    ctx.register(
      ctx.stream(content, { Type: "XObject", Subtype: "Form", BBox: box, ...(resources ? { Resources: resources } : {}) } as never),
    );

  for (const a of notes) {
    const color = rgb(colorHex(colors, a.color));
    if (a.type === "highlight" || a.type === "area") {
      const byPage = new Map<number, NormRect[]>();
      for (const r of a.rects) byPage.set(r.page, [...(byPage.get(r.page) ?? []), r]);
      for (const [pageNo, rects] of byPage) {
        const page = pages[pageNo - 1];
        if (!page) continue;
        const toUser = makeToUser(page);
        if (a.type === "highlight") {
          // Per rect: top-left, top-right, bottom-left, bottom-right (the order viewers expect).
          const quads = rects.map((r) => [
            toUser(r.x, r.y),
            toUser(r.x + r.w, r.y),
            toUser(r.x, r.y + r.h),
            toUser(r.x + r.w, r.y + r.h),
          ]);
          const rect = bbox(quads.flat(), 1);
          const draw = quads
            .map(([tl, tr, bl, br]) => `${num(tl[0])} ${num(tl[1])} m ${num(tr[0])} ${num(tr[1])} l ${num(br[0])} ${num(br[1])} l ${num(bl[0])} ${num(bl[1])} l h f`)
            .join("\n");
          const ap = form(rect, `/GS0 gs ${color.map(num).join(" ")} rg\n${draw}`, {
            ExtGState: { GS0: { Type: "ExtGState", BM: "Multiply" } },
          });
          add(page, {
            Subtype: "Highlight",
            Rect: rect,
            QuadPoints: quads.flat(2),
            ...common(a, color),
            AP: { N: ap },
          });
        } else {
          const r = rects[0];
          const rect = bbox([toUser(r.x, r.y), toUser(r.x + r.w, r.y + r.h)]);
          const [x1, y1, x2, y2] = rect;
          const ap = form(rect, `${color.map(num).join(" ")} RG 2 w ${num(x1 + 1)} ${num(y1 + 1)} ${num(x2 - x1 - 2)} ${num(y2 - y1 - 2)} re S`);
          add(page, { Subtype: "Square", Rect: rect, BS: { W: 2 }, ...common(a, color), AP: { N: ap } });
        }
      }
    } else {
      // Page / document notes become sticky notes near the top-left corner.
      const pageNo = a.page ?? 1;
      const page = pages[pageNo - 1];
      if (!page || !noteText(a)) continue;
      const i = stickyCount.get(pageNo) ?? 0;
      stickyCount.set(pageNo, i + 1);
      const [x, y] = makeToUser(page)(0.02 + 0.04 * (i % 10), 0.02);
      add(page, {
        Subtype: "Text",
        Name: "Comment",
        Open: false,
        Rect: [x, y - 20, x + 20, y],
        ...common(a, rgb("#facc15")),
        Contents: PDFHexString.fromText(a.page == null ? `${DOC_NOTE_PREFIX}\n${noteText(a)}` : noteText(a)),
      });
    }
  }

  return { filename: `${doc.title}（含筆記）.pdf`, body: await pdf.save() };
}

function colorHex(colors: ColorDef[], key: string) {
  return colors.find((c) => c.key === key)?.hex ?? "#facc15";
}
