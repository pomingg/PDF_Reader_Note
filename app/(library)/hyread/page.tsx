"use client";

import { useCallback, useEffect, useState } from "react";
import { api, formatSize, formatTime, notifyLibraryChanged } from "@/lib/client";
import type { Project } from "@/lib/types";

interface Capture {
  id: string;
  url: string;
  kind: string;
  pageTitle: string;
  status: string;
  detail: string;
  createdAt: number;
}
interface Status {
  token: string;
  books: number;
  notes: number;
  lastCaptureAt: number | null;
  projectId: string | null;
  suggestedFolder: string | null;
  captures: Capture[];
}
interface Scan {
  root: string;
  truncated: boolean;
  files: { path: string; size: number; modifiedAt: number; type: string }[];
}

const STATUS_LABEL: Record<string, string> = { parsed: "已同步", unparsed: "未辨識", error: "錯誤", stored: "已保存" };
const DEFAULT_FOLDER = "C:\\Users\\<你的使用者名稱>\\AppData\\Roaming\\HyRead";

export default function HyreadPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [copied, setCopied] = useState("");
  const [folder, setFolder] = useState("");
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanError, setScanError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(() => {
    fetch("/api/integrations/hyread/status")
      .then((r) => r.json())
      .then((s: Status) => {
        setStatus(s);
        if (s.suggestedFolder) setFolder((f) => f || s.suggestedFolder!);
      });
  }, []);
  useEffect(() => {
    load();
    api.projects().then(setProjects);
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 2500);
    } catch {
      setMessage("無法存取剪貼簿，請手動選取複製");
    }
  };

  const runScan = async (onlyRecent = false) => {
    setScanError("");
    const res = await fetch("/api/integrations/hyread/scan-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: folder }),
    });
    const data = await res.json();
    if (!res.ok) return setScanError(data.error ?? "掃描失敗");
    if (onlyRecent) data.files = data.files.filter((f: Scan["files"][0]) => Date.now() - f.modifiedAt < 10 * 60 * 1000);
    setScan(data);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">HyRead 同步</h1>
        <p className="mt-1 text-sm text-slate-500">
          在 HyRead 畫的重點與筆記會自動變成這裡的「電子書筆記」，只同步你的劃線與備註，不會下載書籍內容。
        </p>
      </div>

      {status && (
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            ["同步的書", status.books],
            ["同步的筆記", status.notes],
            ["最近一次收到資料", status.lastCaptureAt ? formatTime(status.lastCaptureAt) : "尚未收到"],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xl font-semibold" data-testid={`stat-${label}`}>
                {value}
              </div>
              <div className="text-xs text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">① 安裝瀏覽器擴充功能（線上閱讀，以及雲端同步）</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>
            在 Chrome 網址列輸入 <code>chrome://extensions</code>，打開右上角「開發人員模式」
          </li>
          <li>
            按「載入未封裝項目」，選擇程式資料夾裡的 <code>extension/hyread</code>
          </li>
          <li>點擴充功能圖示打開設定，貼上下面的同步金鑰，按「測試連線」</li>
        </ol>
        {status && (
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-slate-100 px-2 py-1.5 text-xs" data-testid="sync-token">
              {status.token}
            </code>
            <button className="btn text-xs" onClick={() => copy(status.token, "token")}>
              {copied === "token" ? "已複製" : "複製金鑰"}
            </button>
            <button
              className="btn text-xs"
              title="舊的金鑰會失效"
              onClick={async () => {
                if (!confirm("重新產生後，擴充功能要貼上新的金鑰才能繼續同步。確定？")) return;
                await fetch("/api/integrations/hyread/token", { method: "POST" });
                load();
              }}
            >
              重新產生
            </button>
          </div>
        )}
        <label className="mt-4 flex items-center gap-2 text-sm">
          <span className="text-slate-600">新同步的書放到</span>
          <select
            className="input w-auto py-1"
            value={status?.projectId ?? ""}
            onChange={async (e) => {
              await fetch("/api/integrations/hyread/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId: e.target.value || null }),
              });
              load();
            }}
          >
            <option value="">📥 未分類</option>
            {projects
              .filter((p) => !p.isSystem)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.name}
                </option>
              ))}
          </select>
        </label>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">② 電腦版 HyRead 本機資料（找出筆記存放位置）</h2>
        <p className="mt-1 text-sm text-slate-600">
          輸入 HyRead 電腦版的資料夾（通常是 <code>{DEFAULT_FOLDER}</code>）按「掃描」。接著在 HyRead 畫一個重點，再按「只看最近 10
          分鐘變動」，就能看出筆記存在哪個檔案。這只會列出檔名與大小，不會讀取或修改內容。
        </p>
        <div className="mt-3 flex gap-2">
          <input
            className="input"
            placeholder={DEFAULT_FOLDER}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            aria-label="HyRead 資料夾路徑"
          />
          <button className="btn whitespace-nowrap" onClick={() => runScan(false)} disabled={!folder.trim()}>
            掃描
          </button>
          <button className="btn whitespace-nowrap" onClick={() => runScan(true)} disabled={!folder.trim()}>
            只看最近 10 分鐘變動
          </button>
        </div>
        {scanError && <p className="mt-2 text-sm text-red-600">{scanError}</p>}
        {scan && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>
                {scan.files.length} 個檔案{scan.truncated ? "（只列出前 600 個）" : ""}，依修改時間排序
              </span>
              <button
                className="btn text-xs"
                onClick={() =>
                  copy(scan.files.map((f) => `${f.path}\t${f.type}\t${f.size}\t${new Date(f.modifiedAt).toISOString()}`).join("\n"), "scan")
                }
              >
                {copied === "scan" ? "已複製" : "複製清單"}
              </button>
            </div>
            <div className="max-h-72 overflow-auto rounded border border-slate-200 text-xs" data-testid="scan-result">
              <table className="w-full">
                <tbody>
                  {scan.files.map((f) => (
                    <tr key={f.path} className="border-b border-slate-100">
                      <td className="px-2 py-1 font-mono">{f.path}</td>
                      <td className="px-2 py-1 text-slate-500">{f.type}</td>
                      <td className="px-2 py-1 text-right text-slate-500">{formatSize(f.size)}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-slate-400">{formatTime(f.modifiedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 font-semibold">最近收到的資料</h2>
          <button
            className="btn text-xs"
            onClick={async () => {
              const r = await (await fetch("/api/integrations/hyread/reparse", { method: "POST" })).json();
              setMessage(`重新解析 ${r.captures} 筆資料，其中 ${r.parsed} 筆辨識出筆記`);
              notifyLibraryChanged();
              load();
            }}
          >
            重新解析
          </button>
          <button
            className="btn text-xs"
            title="複製最近收到的資料（已移除登入資訊），貼給 Claude 協助調整同步"
            onClick={async () => copy(await (await fetch("/api/integrations/hyread/diagnostics")).text(), "diag")}
          >
            {copied === "diag" ? "已複製" : "複製診斷資料"}
          </button>
        </div>
        {message && <p className="mt-2 text-sm text-emerald-700">{message}</p>}
        <div className="mt-3 divide-y divide-slate-100 text-sm" data-testid="captures">
          {status?.captures.length ? (
            status.captures.map((c) => (
              <div key={c.id} className="flex items-start gap-3 py-2">
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 text-xs ${
                    c.status === "parsed" ? "bg-emerald-100 text-emerald-700" : c.status === "error" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-slate-700">{c.pageTitle || c.url}</div>
                  <div className="truncate text-xs text-slate-400">{c.detail}</div>
                </div>
                <span className="shrink-0 text-xs text-slate-400">{formatTime(c.createdAt)}</span>
              </div>
            ))
          ) : (
            <p className="py-4 text-center text-slate-400">還沒有收到資料。安裝擴充功能後，在 Chrome 打開一本 HyRead 書畫幾個重點試試。</p>
          )}
        </div>
      </section>
    </div>
  );
}
