// Bridge: the page-world hook cannot talk to the extension directly.
window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.__prn !== "capture") return;
  const { kind, url, pageTitle, payload } = e.data;
  try {
    chrome.runtime.sendMessage({ type: "capture", kind, url, pageTitle, payload });
  } catch {
    /* extension reloaded; ignore */
  }
});
