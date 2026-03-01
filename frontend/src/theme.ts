export type Theme = "light" | "dark";
const KEY = "theme";

let tmr: number | null = null;

export function getInitialTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(KEY, theme);
}

function withThemeTransition(ms = 280) {
  const root = document.documentElement;

  root.classList.add("theme-transition");
  if (tmr) window.clearTimeout(tmr);

  tmr = window.setTimeout(() => {
    root.classList.remove("theme-transition");
    tmr = null;
  }, ms);
}

export function toggleTheme(): Theme {
  const next: Theme = document.documentElement.classList.contains("dark") ? "light" : "dark";
  withThemeTransition(280);
  applyTheme(next);
  return next;
}