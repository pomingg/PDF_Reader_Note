// Runs inside HyRead's own pages. Watches the data the reader sends and receives
// (fetch / XMLHttpRequest) and passes anything that looks like highlights or notes
// to relay.js. Only JSON bodies are looked at; headers and cookies are never read.
(() => {
  if (window.__prnHyreadHook) return;
  window.__prnHyreadHook = true;

  const RELEVANT = /highlight|annot|note|mark|underline|memo|comment|bookmark|劃線|筆記|註記|畫線/i;
  const MAX_CHARS = 2_000_000;

  function toJson(text) {
    if (typeof text !== "string" || !text || text.length > MAX_CHARS) return undefined;
    const t = text.trim();
    if (t[0] === "{" || t[0] === "[") {
      try {
        return JSON.parse(t);
      } catch {
        return undefined;
      }
    }
    // form posts: a=1&b=2
    if (/^[\w%.-]+=[^&]*(&[\w%.-]+=[^&]*)*$/.test(t)) {
      const out = {};
      for (const [k, v] of new URLSearchParams(t)) {
        try {
          out[k] = /^[[{]/.test(v) ? JSON.parse(v) : v;
        } catch {
          out[k] = v;
        }
      }
      return out;
    }
    return undefined;
  }

  function report(kind, url, text) {
    try {
      if (!url || typeof text !== "string") return;
      if (!RELEVANT.test(url) && !RELEVANT.test(text.slice(0, 200_000))) return;
      const payload = toJson(text);
      if (payload === undefined) return;
      window.postMessage({ __prn: "capture", kind, url: String(new URL(url, location.href)), pageTitle: document.title, payload }, "*");
    } catch {
      /* never break the page */
    }
  }

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input && input.url;
    if (init && typeof init.body === "string") report("request", url, init.body);
    const res = await origFetch.apply(this, arguments);
    try {
      const type = res.headers.get("content-type") || "";
      if (/json|text/i.test(type)) res.clone().text().then((t) => report("response", res.url || url, t), () => {});
    } catch {
      /* ignore */
    }
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__prnUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (typeof body === "string") report("request", this.__prnUrl, body);
    this.addEventListener("load", () => {
      try {
        const url = this.responseURL || this.__prnUrl;
        if (this.responseType === "" || this.responseType === "text") report("response", url, this.responseText);
        else if (this.responseType === "json") report("response", url, JSON.stringify(this.response));
      } catch {
        /* ignore */
      }
    });
    return origSend.apply(this, arguments);
  };
})();
