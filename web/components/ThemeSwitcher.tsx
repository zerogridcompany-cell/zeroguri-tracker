"use client";

// テーマ切替（default 和 / chic 雅 / mono 墨）。localStorage に保存。
import { useEffect, useState } from "react";

const THEMES: ReadonlyArray<readonly [string, string]> = [
  ["default", "和"],
  ["chic", "雅"],
  ["mono", "墨"],
];

export function ThemeSwitcher() {
  const [theme, setThemeState] = useState("default");

  useEffect(() => {
    const t = localStorage.getItem("zg-theme");
    if (t) setThemeState(t);
  }, []);

  function pick(t: string) {
    setThemeState(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("zg-theme", t);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-1 rounded-full border border-line bg-bg px-1.5 py-1 shadow-sm">
      {THEMES.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => pick(key)}
          aria-label={`theme ${key}`}
          className={
            "flex h-7 w-7 items-center justify-center rounded-full text-[12px] transition-colors " +
            (theme === key ? "bg-accent text-white" : "text-mid hover:text-sumi")
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
