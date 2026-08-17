// Preference handling for the answer board: UI theme (light / dark / system)
// and the UI font-family. Loads persisted values from localStorage on launch,
// applies them to the document, and persists on change. Only preferences are
// persisted — answer content stays in memory.

export type Theme = "light" | "dark" | "system";

export const THEMES: readonly Theme[] = ["light", "dark", "system"];

const THEME_KEY = "answer-board:theme";
const FONT_KEY = "answer-board:font";

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function loadTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  return isTheme(stored) ? stored : "system";
}

export function loadFont(): string {
  return localStorage.getItem(FONT_KEY) ?? "";
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

function applyFont(value: string): void {
  // CSSOM property setter only: the whole input is one font-family value,
  // never interpolated into a style/HTML string.
  document.documentElement.style.fontFamily = value.trim();
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  localStorage.setItem(THEME_KEY, theme);
}

export function setFont(value: string): void {
  applyFont(value);
  const trimmed = value.trim();
  if (trimmed === "") {
    localStorage.removeItem(FONT_KEY);
  } else {
    localStorage.setItem(FONT_KEY, trimmed);
  }
}

// Apply persisted preferences on launch.
export function initPrefs(): void {
  applyTheme(loadTheme());
  applyFont(loadFont());
}
