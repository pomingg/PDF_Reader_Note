"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const KEY = "pdfnotes:theme";

/** Runs before first paint (inlined in <head>) so the page never flashes the wrong theme. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    let t: Theme = "system";
    try {
      t = (localStorage.getItem(KEY) as Theme) || "system";
    } catch {
      /* storage unavailable */
    }
    setTheme(t);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply((localStorage.getItem(KEY) as Theme) || "system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <label className="flex items-center gap-2 text-xs text-slate-500">
      <span>外觀</span>
      <select
        aria-label="外觀主題"
        className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs text-slate-700"
        value={theme}
        onChange={(e) => {
          const t = e.target.value as Theme;
          setTheme(t);
          try {
            localStorage.setItem(KEY, t);
          } catch {
            /* storage unavailable */
          }
          apply(t);
        }}
      >
        <option value="system">跟隨系統</option>
        <option value="light">淺色</option>
        <option value="dark">深色</option>
      </select>
    </label>
  );
}
