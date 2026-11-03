"use client";

import type { ColorDef } from "@/lib/types";

/** Floating bar shown under a text selection: pick a colour (1-4), add a note (N) or copy. */
export function SelectionToolbar({
  anchor,
  colors,
  onColor,
  onNote,
  onCopy,
}: {
  anchor: { x: number; y: number };
  colors: ColorDef[];
  onColor: (key: string) => void;
  onNote: () => void;
  onCopy: () => void;
}) {
  const left = Math.min(Math.max(8, anchor.x - 140), window.innerWidth - 300);
  const top = Math.min(anchor.y + 8, window.innerHeight - 56);
  return (
    <div
      role="toolbar"
      aria-label="標註工具"
      data-testid="selection-toolbar"
      className="fixed z-30 flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
      style={{ left, top }}
      onMouseDown={(e) => e.preventDefault()} // keep the text selection
    >
      {colors.map((c, i) => (
        <button
          key={c.key}
          title={`${c.label}（${i + 1}）`}
          aria-label={`標成${c.label}`}
          onClick={() => onColor(c.key)}
          className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-100"
        >
          <span className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ background: c.hex }} />
          {c.label}
        </button>
      ))}
      <span className="mx-0.5 h-5 w-px bg-slate-200" />
      <button className="rounded-lg px-2 py-1 text-xs text-slate-700 hover:bg-slate-100" title="加備註（N）" onClick={onNote}>
        ✎ 備註
      </button>
      <button className="rounded-lg px-2 py-1 text-xs text-slate-700 hover:bg-slate-100" title="複製" onClick={onCopy}>
        複製
      </button>
    </div>
  );
}
