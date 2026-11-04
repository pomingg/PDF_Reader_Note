// Sends captured highlight / note data to the PDF 閱讀筆記 app running on this computer.
const DEFAULTS = { appUrl: "http://localhost:3000", token: "", enabled: true };

async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

const base = (url) => url.replace(/\/+$/, "");

async function record(result) {
  const { stats } = await chrome.storage.local.get({ stats: { sent: 0, created: 0, updated: 0, lastAt: 0, lastError: "" } });
  stats.lastAt = Date.now();
  if (result.ok) {
    stats.sent++;
    stats.created += result.created || 0;
    stats.updated += result.updated || 0;
    stats.lastError = "";
  } else {
    stats.lastError = result.error || "未知錯誤";
  }
  await chrome.storage.local.set({ stats });
  chrome.action.setBadgeBackgroundColor({ color: result.ok ? "#16a34a" : "#dc2626" });
  chrome.action.setBadgeText({ text: result.ok ? (result.created ? `+${result.created}` : "") : "!" });
}

async function send(msg) {
  const s = await settings();
  if (!s.enabled) return;
  if (!s.token) return record({ ok: false, error: "尚未設定同步金鑰" });
  try {
    const res = await fetch(`${base(s.appUrl)}/api/integrations/hyread/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sync-Token": s.token },
      body: JSON.stringify({ url: msg.url, kind: msg.kind, pageTitle: msg.pageTitle, payload: msg.payload }),
    });
    const data = await res.json().catch(() => ({}));
    await record(res.ok ? { ok: true, created: data.created, updated: data.updated } : { ok: false, error: data.error || `HTTP ${res.status}` });
  } catch (e) {
    await record({ ok: false, error: `連不到閱讀筆記程式，請確認它正在執行（${e.message}）` });
  }
}

async function test() {
  const s = await settings();
  try {
    const res = await fetch(`${base(s.appUrl)}/api/integrations/hyread/ping`, { headers: { "X-Sync-Token": s.token } });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : { ok: false, error: data.error || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: `連不到 ${s.appUrl}：${e.message}` };
  }
}

// One at a time, so the counters in storage are not overwritten by parallel sends.
let queue = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "capture") queue = queue.then(() => send(msg), () => send(msg));
  if (msg?.type === "test") {
    test().then(sendResponse);
    return true; // async response
  }
});
