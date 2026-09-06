// Unified appearance preferences. Persistence is provided by the Rust settings
// commands; this module only owns the live preview and a small debounced hook.

export type Theme = "light" | "dark" | "system";

export type FontSettings = {
  uiFont: string;
  uiFontSize: number | null;
  inputFont: string;
  inputFontSize: number | null;
  numberFont: string;
  numberFontSize: number | null;
  questionFont: string;
  questionFontSize: number | null;
  codeFont: string;
};

export const DEFAULT_INPUT_FONT_SIZE = 15;
export const DEFAULT_NUMBER_FONT_SIZE = 14;
export const DEFAULT_QUESTION_FONT_SIZE = 15;
export const DEFAULT_CODE_FONT_FAMILY = "ui-monospace, monospace";
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 200;

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

let currentTheme: Theme = "system";
let current: FontSettings = {
  uiFont: "",
  uiFontSize: null,
  inputFont: "",
  inputFontSize: null,
  numberFont: "",
  numberFontSize: null,
  questionFont: "",
  questionFontSize: null,
  codeFont: "",
};
let persist: ((theme: Theme, fonts: FontSettings) => void) | undefined;
let persistTimer: number | undefined;

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

function sizeCss(size: number | null, fallback: number): string {
  return `${size ?? fallback}px`;
}

function applyFontSettings(settings: FontSettings): void {
  const root = document.documentElement;
  root.style.fontFamily = settings.uiFont.trim();
  root.style.setProperty("--ui-font-size", sizeCss(settings.uiFontSize, 15));
  root.style.setProperty("--input-font-family", settings.inputFont.trim() || "inherit");
  root.style.setProperty("--input-font-size", sizeCss(settings.inputFontSize, DEFAULT_INPUT_FONT_SIZE));
  root.style.setProperty("--number-font-family", settings.numberFont.trim() || "inherit");
  root.style.setProperty("--number-font-size", sizeCss(settings.numberFontSize, DEFAULT_NUMBER_FONT_SIZE));
  root.style.setProperty("--question-font-family", settings.questionFont.trim() || "inherit");
  root.style.setProperty("--question-font-size", sizeCss(settings.questionFontSize, DEFAULT_QUESTION_FONT_SIZE));
  root.style.setProperty("--code-font-family", settings.codeFont.trim() || DEFAULT_CODE_FONT_FAMILY);
}

function schedulePersist(): void {
  if (!persist) return;
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => persist?.(currentTheme, { ...current }), 350);
}

export function setPreferencesPersistor(callback: (theme: Theme, fonts: FontSettings) => void): void {
  persist = callback;
}

export function loadTheme(): Theme {
  return currentTheme;
}

export function loadFontSettings(): FontSettings {
  return { ...current };
}

export function setTheme(theme: Theme): void {
  currentTheme = theme;
  applyTheme(theme);
  schedulePersist();
}

export function setUiFont(value: string): void {
  current = { ...current, uiFont: value.trim() };
  applyFontSettings(current);
  schedulePersist();
}
export function setUiFontSize(value: number | null): void {
  current = { ...current, uiFontSize: value };
  applyFontSettings(current);
  schedulePersist();
}
export function setInputFont(value: string): void {
  current = { ...current, inputFont: value.trim() };
  applyFontSettings(current);
  schedulePersist();
}
export function setInputFontSize(value: number | null): void {
  current = { ...current, inputFontSize: value };
  applyFontSettings(current);
  schedulePersist();
}
export function setNumberFont(value: string): void {
  current = { ...current, numberFont: value.trim() };
  applyFontSettings(current);
  schedulePersist();
}
export function setNumberFontSize(value: number | null): void {
  current = { ...current, numberFontSize: value };
  applyFontSettings(current);
  schedulePersist();
}
export function setQuestionFont(value: string): void {
  current = { ...current, questionFont: value.trim() };
  applyFontSettings(current);
  schedulePersist();
}
export function setQuestionFontSize(value: number | null): void {
  current = { ...current, questionFontSize: value };
  applyFontSettings(current);
  schedulePersist();
}
export function setCodeFont(value: string): void {
  current = { ...current, codeFont: value.trim() };
  applyFontSettings(current);
  schedulePersist();
}

export function initPrefs(theme: Theme = "system", fonts: FontSettings = current): FontSettings {
  currentTheme = theme;
  current = { ...fonts };
  applyTheme(currentTheme);
  applyFontSettings(current);
  return { ...current };
}
