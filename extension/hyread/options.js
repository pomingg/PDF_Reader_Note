const $ = (id) => document.getElementById(id);
const DEFAULTS = { appUrl: "http://localhost:3000", token: "", enabled: true };

function show(text, ok) {
  $("msg").textContent = text;
  $("msg").className = ok ? "ok" : "err";
}

async function load() {
  const s = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
  $("appUrl").value = s.appUrl;
  $("token").value = s.token;
  $("enabled").checked = s.enabled;
  const { stats } = await chrome.storage.local.get({ stats: null });
  $("stats").textContent = stats
    ? `已送出 ${stats.sent} 次，新增 ${stats.created}、更新 ${stats.updated} 則筆記` +
      (stats.lastAt ? `，最近一次 ${new Date(stats.lastAt).toLocaleString()}` : "") +
      (stats.lastError ? `\n最近錯誤：${stats.lastError}` : "")
    : "還沒有同步紀錄。打開一本 HyRead 書畫個重點試試。";
}

async function save() {
  await chrome.storage.local.set({
    appUrl: $("appUrl").value.trim() || DEFAULTS.appUrl,
    token: $("token").value.trim(),
    enabled: $("enabled").checked,
  });
}

$("save").addEventListener("click", async () => {
  await save();
  show("已儲存", true);
});
$("test").addEventListener("click", async () => {
  await save();
  show("測試中…", true);
  const r = await chrome.runtime.sendMessage({ type: "test" });
  show(r && r.ok ? "連線成功，金鑰正確 ✓" : `失敗：${(r && r.error) || "沒有回應"}`, r && r.ok);
});
load();
