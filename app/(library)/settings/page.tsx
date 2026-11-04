"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/LibraryDialogs";
import { LinkedFoldersSection } from "@/components/LinkedFoldersSection";
import { notifyLibraryChanged } from "@/lib/client";

interface RestoreResult {
  projects: number;
  documents: number;
  annotations: number;
  safetyBackup: string;
}

export default function SettingsPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const restore = async (file: File) => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("confirm", "replace-all");
      const res = await fetch("/api/backup/restore", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "還原失敗");
      setResult(data);
      notifyLibraryChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">匯出與備份</h1>
        <p className="mt-1 text-sm text-slate-500">你的筆記永遠可以帶走：匯出成 Markdown 給其他工具使用，或下載完整備份以便日後還原。</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">📄 匯出 Markdown</h2>
        <p className="mt-1 text-sm text-slate-600">
          每份文件一個 <code>.md</code> 檔，依「專案／資料夾」分層，包含原文引用、頁碼、備註、標籤與框選截圖，可直接放進 Obsidian 等筆記軟體。
          只想匯出某個專案或某份文件時，可在該專案頁面或閱讀器工具列按「⬇」。
        </p>
        <a className="btn mt-3" href="/api/export/markdown?all=1" download data-testid="export-all">
          ⬇ 匯出全部筆記（zip）
        </a>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">💾 完整備份</h2>
        <p className="mt-1 text-sm text-slate-600">
          包含所有專案、資料夾、PDF 檔、筆記、標籤、截圖與設定。建議定期下載一份，放到雲端硬碟或隨身碟。
        </p>
        <a className="btn btn-primary mt-3" href="/api/backup" download data-testid="download-backup">
          ⬇ 下載完整備份
        </a>
      </section>

      <LinkedFoldersSection />

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="font-semibold">♻️ 從備份還原</h2>
        <p className="mt-1 text-sm text-slate-700">
          用備份檔<strong>取代目前所有資料</strong>。還原前會自動把現有資料另存一份到 <code>data/backups/</code>，萬一選錯檔案也能找回。
        </p>
        <button className="btn mt-3" disabled={busy} onClick={() => fileInput.current?.click()}>
          {busy ? "還原中…" : "選擇備份檔…"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          data-testid="restore-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPending(f);
            e.target.value = "";
          }}
        />
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {result && (
          <p className="mt-3 text-sm text-green-700" data-testid="restore-result">
            已還原：{result.projects} 個專案、{result.documents} 份文件、{result.annotations} 則筆記。原本的資料已另存為{" "}
            <code>data/{result.safetyBackup}</code>。
          </p>
        )}
      </section>

      {pending && (
        <ConfirmDialog
          title="確定要還原？"
          message={`將用「${pending.name}」取代目前所有的專案、文件與筆記。現有資料會先自動備份。`}
          confirmLabel="取代並還原"
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const f = pending;
            setPending(null);
            await restore(f);
          }}
        />
      )}
    </div>
  );
}
