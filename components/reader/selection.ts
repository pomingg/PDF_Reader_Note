import type { NormRect } from "@/lib/types";

export interface TextSelection {
  rects: NormRect[];
  quote: string;
  prefix: string;
  suffix: string;
  /** Where to show the toolbar (viewport coordinates, below the end of the selection). */
  anchor: { x: number; y: number };
}

const CONTEXT = 40;

/**
 * Turn the current browser selection inside the PDF text layers into
 * page-relative rectangles plus the quoted text and its surroundings.
 */
export function readSelection(root: HTMLElement): TextSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const startLayer = closestLayer(range.startContainer);
  const endLayer = closestLayer(range.endContainer);
  if (!startLayer && !endLayer) return null;

  const quote = sel.toString().replace(/\s+\n/g, "\n").trim();
  if (!quote) return null;

  const pages = [...root.querySelectorAll<HTMLElement>(".pdf-page")].map((el) => ({
    page: Number(el.dataset.page),
    box: el.getBoundingClientRect(),
  }));

  const rects: NormRect[] = [];
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 1) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const p = pages.find((p) => cx >= p.box.left && cx <= p.box.right && cy >= p.box.top && cy <= p.box.bottom);
    if (!p) continue;
    // Clip to the page, then normalise to 0-1.
    const left = Math.max(r.left, p.box.left);
    const right = Math.min(r.right, p.box.right);
    const top = Math.max(r.top, p.box.top);
    const bottom = Math.min(r.bottom, p.box.bottom);
    rects.push({
      page: p.page,
      x: (left - p.box.left) / p.box.width,
      y: (top - p.box.top) / p.box.height,
      w: (right - left) / p.box.width,
      h: (bottom - top) / p.box.height,
    });
  }
  if (!rects.length) return null;

  const before = document.createRange();
  if (startLayer) {
    before.setStart(startLayer, 0);
    before.setEnd(range.startContainer, range.startOffset);
  }
  const after = document.createRange();
  if (endLayer) {
    after.setStart(range.endContainer, range.endOffset);
    after.setEnd(endLayer, endLayer.childNodes.length);
  }

  const last = range.getClientRects();
  const end = last[last.length - 1] ?? range.getBoundingClientRect();
  return {
    rects: mergeRects(rects),
    quote,
    prefix: startLayer ? before.toString().slice(-CONTEXT) : "",
    suffix: endLayer ? after.toString().slice(0, CONTEXT) : "",
    anchor: { x: end.right, y: end.bottom },
  };
}

function closestLayer(node: Node): HTMLElement | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return (el?.closest(".textLayer") as HTMLElement | null) ?? null;
}

/** Join rects that sit on the same line and touch, and drop ones fully inside another. */
export function mergeRects(rects: NormRect[]): NormRect[] {
  const sorted = [...rects].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const out: NormRect[] = [];
  for (const r of sorted) {
    const prev = out[out.length - 1];
    const sameLine =
      prev &&
      prev.page === r.page &&
      Math.abs(prev.y - r.y) < Math.min(prev.h, r.h) * 0.5 &&
      Math.abs(prev.h - r.h) < Math.max(prev.h, r.h) * 0.6;
    if (sameLine && r.x <= prev.x + prev.w + 0.01) {
      const x = Math.min(prev.x, r.x);
      const y = Math.min(prev.y, r.y);
      prev.w = Math.max(prev.x + prev.w, r.x + r.w) - x;
      prev.h = Math.max(prev.y + prev.h, r.y + r.h) - y;
      prev.x = x;
      prev.y = y;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}
