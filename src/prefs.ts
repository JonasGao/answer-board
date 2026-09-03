// Preference handling for the answer board: UI theme (light / dark / system)
// and the four font groups (interface / answer input / number / code). Loads
// persisted values from localStorage on launch, applies them to the document,
// and persists on change. Only preferences are persisted — answer content
// stays in memory.

export type Theme = "light" | "dark" | "system";

const THEME_KEY = "answer-board:theme";
const OLD_FONT_KEY = "answer-board:font";
const UI_FONT_KEY = "answer-board:ui-font";
const INPUT_FONT_KEY = "answer-board:input-font";
const INPUT_FONT_SIZE_KEY = "answer-board:input-font-size";
const NUMBER_FONT_KEY = "answer-board:number-font";
const NUMBER_FONT_SIZE_KEY = "answer-board:number-font-size";
const CODE_FONT_KEY = "answer-board:code-font";
const CODE_FONT_SIZE_KEY = "answer-board:code-font-size";

// Stylesheet defaults for the font sizes (mirrored in styles.css :root). An
// empty size input means "use these defaults".
export const DEFAULT_INPUT_FONT_SIZE = 15;
export const DEFAULT_NUMBER_FONT_SIZE = 14;
export const DEFAULT_CODE_FONT_FAMILY = "ui-monospace, monospace";
export const DEFAULT_CODE_FONT_SIZE = 15;
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 200;

// All font preferences as one value. Family strings are CSS font stacks;
// "" means "use the stylesheet default" (for input/number that also means
// inheriting the interface font). Sizes are whole px; null means "use the
// stylesheet default size".
export type FontSettings = {
  uiFont: string;
  inputFont: string;
  inputFontSize: number | null;
  numberFont: string;
  numberFontSize: number | null;
  codeFont: string;
  codeFontSize: number | null;
};

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function loadTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  return isTheme(stored) ? stored : "system";
}

function readString(key: string): string {
  return localStorage.getItem(key) ?? "";
}

function readSize(key: string): number | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= MIN_FONT_SIZE && value <= MAX_FONT_SIZE
    ? value
    : null;
}

// The old single global font (answer-board:font) becomes the interface font
// on first launch after the split.
function migrateOldFont(): void {
  if (localStorage.getItem(UI_FONT_KEY) !== null) return;
  const old = (localStorage.getItem(OLD_FONT_KEY) ?? "").trim();
  if (old !== "") localStorage.setItem(UI_FONT_KEY, old);
  localStorage.removeItem(OLD_FONT_KEY);
}

export function loadFontSettings(): FontSettings {
  migrateOldFont();
  return {
    uiFont: readString(UI_FONT_KEY),
    inputFont: readString(INPUT_FONT_KEY),
    inputFontSize: readSize(INPUT_FONT_SIZE_KEY),
    numberFont: readString(NUMBER_FONT_KEY),
    numberFontSize: readSize(NUMBER_FONT_SIZE_KEY),
    codeFont: readString(CODE_FONT_KEY),
    codeFontSize: readSize(CODE_FONT_SIZE_KEY),
  };
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  localStorage.setItem(THEME_KEY, theme);
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

// The interface font is the document-wide family (CSSOM property setter only:
// the whole input is one font-family value, never interpolated into a
// style/HTML string). Input and number fonts ride on CSS custom properties:
// an empty family becomes "inherit" (falls back to the interface font), a
// null size becomes the stylesheet default size.
function applyFontSettings(settings: FontSettings): void {
  const root = document.documentElement;
  root.style.fontFamily = settings.uiFont.trim();
  root.style.setProperty("--input-font-family", settings.inputFont.trim() || "inherit");
  root.style.setProperty(
    "--input-font-size",
    sizeCss(settings.inputFontSize, DEFAULT_INPUT_FONT_SIZE)
  );
  root.style.setProperty("--number-font-family", settings.numberFont.trim() || "inherit");
  root.style.setProperty(
    "--number-font-size",
    sizeCss(settings.numberFontSize, DEFAULT_NUMBER_FONT_SIZE)
  );
  root.style.setProperty(
    "--code-font-family",
    settings.codeFont.trim() || DEFAULT_CODE_FONT_FAMILY,
  );
  root.style.setProperty(
    "--code-font-size",
    sizeCss(settings.codeFontSize, DEFAULT_CODE_FONT_SIZE),
  );
}

function sizeCss(size: number | null, fallback: number): string {
  return `${size ?? fallback}px`;
}

function writeString(key: string, value: string): void {
  if (value === "") {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, value);
  }
}

function writeSize(key: string, value: number | null): void {
  if (value === null) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, String(value));
  }
}

// Snapshot of the current settings, patched by the setters below so each one
// can persist and re-apply the full state.
let current: FontSettings = {
  uiFont: "",
  inputFont: "",
  inputFontSize: null,
  numberFont: "",
  numberFontSize: null,
  codeFont: "",
  codeFontSize: null,
};

export function setUiFont(value: string): void {
  const trimmed = value.trim();
  current = { ...current, uiFont: trimmed };
  writeString(UI_FONT_KEY, trimmed);
  applyFontSettings(current);
}

export function setInputFont(value: string): void {
  const trimmed = value.trim();
  current = { ...current, inputFont: trimmed };
  writeString(INPUT_FONT_KEY, trimmed);
  applyFontSettings(current);
}

export function setInputFontSize(value: number | null): void {
  current = { ...current, inputFontSize: value };
  writeSize(INPUT_FONT_SIZE_KEY, value);
  applyFontSettings(current);
}

export function setNumberFont(value: string): void {
  const trimmed = value.trim();
  current = { ...current, numberFont: trimmed };
  writeString(NUMBER_FONT_KEY, trimmed);
  applyFontSettings(current);
}

export function setNumberFontSize(value: number | null): void {
  current = { ...current, numberFontSize: value };
  writeSize(NUMBER_FONT_SIZE_KEY, value);
  applyFontSettings(current);
}

export function setCodeFont(value: string): void {
  const trimmed = value.trim();
  current = { ...current, codeFont: trimmed };
  writeString(CODE_FONT_KEY, trimmed);
  applyFontSettings(current);
}

export function setCodeFontSize(value: number | null): void {
  current = { ...current, codeFontSize: value };
  writeSize(CODE_FONT_SIZE_KEY, value);
  applyFontSettings(current);
}

// Apply persisted preferences on launch.
export function initPrefs(): FontSettings {
  applyTheme(loadTheme());
  current = loadFontSettings();
  applyFontSettings(current);
  return current;
}
