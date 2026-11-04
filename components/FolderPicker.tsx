"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Dialog } from "./Dialog";

type Listing = Awaited<ReturnType<typeof api.listDir>>;

/**
 * Browse folders on this computer (through the local server) and pick one.
 * The path can also be pasted directly, e.g. from File Explorer's address bar.
 */
export function FolderPicker({
  title,
  confirmLabel,
  onClose,
  onPick,
}: {
  title: string;
  confirmLabel: string;
  onClose: () => void;
  onPick: (path: string) => Promise<void>;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const open = async (path?: string | null) => {
    setError("");
    try {
      const l = await api.listDir(path);
      setListing(l);
      setInput(l.path ?? "");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    open(null);
  }, []);

  return (
    <Dialog
      title={title}
      submitLabel={busy ? "處理中…" : confirmLabel}
      onClose={onClose}
      onSubmit={async () => {
        const path = input.trim();
        if (!path) return setError("請先選擇資料夾");
        setBusy(true);
        setError("");
        try {
          await onPick(path);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex gap-2">
        <input
          className="input font-mono text-xs"
          aria-label="資料夾路徑"
          placeholder="選擇下方的資料夾，或貼上路徑（例如 C:\Users\你\Documents\論文）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              open(input);
            }
          }}
        />
        <button type="button" className="btn whitespace-nowrap" onClick={() => open(input)}>
          前往
        </button>
      </div>
      {listing && (
        <div className="flex flex-wrap gap-1">
          {listing.places.map((p) => (
            <button key={p.path} type="button" className="rounded-full border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-100" onClick={() => open(p.path)}>
              {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="h-64 overflow-y-auto rounded-lg border border-slate-200 text-sm" data-testid="folder-list">
        {listing?.path && (
          <>
            {listing.parent && (
              <button type="button" className="block w-full px-3 py-1.5 text-left text-slate-500 hover:bg-slate-100" onClick={() => open(listing.parent)}>
                ⬆ 上一層
              </button>
            )}
            {listing.dirs.map((d) => (
              <button
                key={d.path}
                type="button"
                className="block w-full truncate px-3 py-1.5 text-left hover:bg-slate-100"
                onClick={() => open(d.path)}
              >
                📁 {d.name}
              </button>
            ))}
            {!listing.dirs.length && <p className="px-3 py-4 text-center text-slate-400">沒有子資料夾</p>}
          </>
        )}
        {listing && !listing.path && <p className="px-3 py-4 text-center text-slate-400">從上方選擇一個位置開始</p>}
      </div>
      {listing?.path && (
        <p className="text-xs text-slate-500" data-testid="pdf-count">
          這個資料夾有 {listing.pdfCount} 個 PDF（子資料夾裡的也會一起加入）
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Dialog>
  );
}
