import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { type Entry, entryNumber, formatAll, nextNumber } from "./format";
import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  type Theme,
  initPrefs,
  isTheme,
  loadFontSettings,
  loadTheme,
  setInputFont,
  setInputFontSize,
  setNumberFont,
  setNumberFontSize,
  setTheme,
  setUiFont,
} from "./prefs";

let nextId = 1;
// The Q-numbering starts here; Q = startNumber + position in the list.
let startNumber = 1;
const entries: Entry[] = [];
const DEFAULT_ANSWER = "As suggested";

const boardEl = document.getElementById("board") as HTMLElement;
const toastEl = document.getElementById("toast") as HTMLElement;
const copyAllBtn = document.getElementById("copy-all-btn") as HTMLButtonElement;
const clearAllBtn = document.getElementById("clear-all-btn") as HTMLButtonElement;
const addEntryBtn = document.getElementById("add-entry-btn") as HTMLButtonElement;
const renumberBtn = document.getElementById("renumber-btn") as HTMLButtonElement;
const themeBtns = document.querySelectorAll<HTMLButtonElement>(".theme-btn");

const renumberDialog = document.getElementById("renumber-dialog") as HTMLDialogElement;
const renumberInput = document.getElementById("renumber-input") as HTMLInputElement;
const renumberStepDownBtn = document.getElementById("renumber-step-down") as HTMLButtonElement;
const renumberStepUpBtn = document.getElementById("renumber-step-up") as HTMLButtonElement;
const renumberHintEl = document.getElementById("renumber-hint") as HTMLElement;
const renumberOkBtn = document.getElementById("renumber-ok") as HTMLButtonElement;
const renumberCancelBtn = document.getElementById("renumber-cancel") as HTMLButtonElement;

const fontSettingsBtn = document.getElementById("font-settings-btn") as HTMLButtonElement;
const fontDialog = document.getElementById("font-dialog") as HTMLDialogElement;
const fontDialogCloseBtn = document.getElementById("font-dialog-close") as HTMLButtonElement;
const uiFontInput = document.getElementById("ui-font-input") as HTMLInputElement;
const inputFontInput = document.getElementById("input-font-input") as HTMLInputElement;
const inputFontSizeInput = document.getElementById("input-font-size") as HTMLInputElement;
const numberFontInput = document.getElementById("number-font-input") as HTMLInputElement;
const numberFontSizeInput = document.getElementById("number-font-size") as HTMLInputElement;

let toastTimer: number | undefined;

function showToast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("visible");
  }, 1600);
}

// Brief synthetic press on the toolbar button that corresponds to a keyboard
// shortcut (Add / Renumber / Copy All): mirrors the look of a real click via
// the .btn-pressed class (which shares the :active rule in styles.css), since
// the shortcut has already run the action itself.
function pressButton(btn: HTMLElement): void {
  btn.classList.remove("btn-pressed");
  void btn.offsetWidth; // restart the press even on repeat presses
  btn.classList.add("btn-pressed");
  window.setTimeout(() => {
    btn.classList.remove("btn-pressed");
  }, 150);
}

function createEntry(): Entry {
  const entry: Entry = { id: nextId++, text: DEFAULT_ANSWER };
  entries.push(entry);
  return entry;
}

function focusEntry(entryId: number): void {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    `textarea[data-entry-id="${entryId}"]`
  );
  textarea?.focus();
}

function addEntry(): void {
  const entry = createEntry();
  render();
  focusEntry(entry.id);
}

function deleteEntry(entryId: number): void {
  const index = entries.findIndex((e) => e.id === entryId);
  if (index === -1) return;
  entries.splice(index, 1);
  render();
}

function clearAll(): void {
  entries.length = 0;
  startNumber = 1;
  render();
}

async function copyText(text: string): Promise<boolean> {
  try {
    await writeText(text);
    return true;
  } catch (error) {
    console.error("clipboard-manager writeText failed:", error);
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error2) {
      console.error("navigator.clipboard.writeText failed:", error2);
      return false;
    }
  }
}

async function copyAll(): Promise<void> {
  const ok = await copyText(formatAll(entries, startNumber));
  showToast(ok ? "Copied" : "Copy failed");
}

// Renumber flow (Alt+Enter / Renumber button): ask for the new start number
// FIRST; only on confirm do we clear everything and rebuild from that number.
// Cancel, empty input, or a non-positive number are all no-ops.
function openRenumberDialog(): void {
  // Default to the next number after the current max (startNumber + count);
  // with an empty board there is no max, so fall back to the start number.
  const next = nextNumber(entries.length, startNumber);
  renumberInput.value = String(next);
  renumberHintEl.textContent = `Current start: ${startNumber} · Next: ${next}`;
  renumberDialog.showModal();
  renumberInput.focus();
  renumberInput.select();
  updateRenumberStepper();
}

function confirmRenumber(): void {
  const value = renumberInput.value.trim();
  const parsed = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1) {
    shakeRenumberInput();
    return;
  }
  renumberDialog.close();
  entries.length = 0;
  startNumber = parsed;
  const entry = createEntry();
  render();
  focusEntry(entry.id);
}

// The field only ever holds digits (filtered on input), so a value that does
// not parse as a positive integer is treated as 1 — the floor.
function renumberValue(): number {
  const parsed = /^\d+$/.test(renumberInput.value) ? Number(renumberInput.value) : NaN;
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function updateRenumberStepper(): void {
  renumberStepDownBtn.disabled = renumberValue() <= 1;
}

function stepRenumber(delta: number): void {
  const next = Math.max(1, renumberValue() + delta);
  renumberInput.value = String(next);
  renumberInput.focus();
  updateRenumberStepper();
}

// Attach one stepper button: the first step fires on pointerdown, holding
// repeats it, and a plain click with no preceding pointerdown still works
// (keyboard activation). Shift steps by 10 instead of 1.
function attachRenumberStepper(btn: HTMLButtonElement, delta: number): void {
  let timer: number | undefined;
  let interval: number | undefined;
  let suppressClick = false;

  const stop = (): void => {
    window.clearTimeout(timer);
    window.clearInterval(interval);
    timer = interval = undefined;
  };

  btn.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    btn.setPointerCapture(event.pointerId);
    suppressClick = true;
    stepRenumber(delta * (event.shiftKey ? 10 : 1));
    timer = window.setTimeout(() => {
      interval = window.setInterval(() => stepRenumber(delta), 80);
    }, 400);
  });
  btn.addEventListener("pointerup", stop);
  btn.addEventListener("pointerleave", stop);
  btn.addEventListener("pointercancel", stop);
  btn.addEventListener("click", (event) => {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      return;
    }
    stepRenumber(delta * (event.shiftKey ? 10 : 1));
  });
  btn.addEventListener("keydown", (event) => {
    if (event.isComposing || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    stepRenumber(delta * (event.shiftKey ? 10 : 1));
  });
}

// Invalid input (empty / 0 / negative) no longer closes silently: flash the
// field red and give it a quick shake, then restore.
function shakeRenumberInput(): void {
  renumberInput.classList.remove("invalid");
  void renumberInput.offsetWidth; // restart the animation on repeat shakes
  renumberInput.classList.add("invalid");
}

function render(): void {
  boardEl.textContent = "";

  if (entries.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "Click Add to start";
    boardEl.appendChild(hint);
    return;
  }

  const entriesEl = document.createElement("div");
  entriesEl.className = "entries";

  entries.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "entry-row";

    const label = document.createElement("span");
    label.className = "entry-label";
    label.textContent = `Q${entryNumber(startNumber, index)}`;

    const textarea = document.createElement("textarea");
    textarea.className = "entry-input";
    textarea.rows = 2;
    textarea.placeholder = DEFAULT_ANSWER;
    textarea.dataset.entryId = String(entry.id);
    textarea.value = entry.text;
    textarea.addEventListener("input", () => {
      entry.text = textarea.value;
    });
    textarea.addEventListener("focus", () => {
      row.classList.add("entry-row-focused");
      if (textarea.value === DEFAULT_ANSWER) {
        textarea.select();
      }
    });
    textarea.addEventListener("blur", () => {
      row.classList.remove("entry-row-focused");
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.isComposing || event.key !== "Enter") return;

      // Ctrl+Enter keeps the default newline; other Ctrl combos are ignored.
      if (event.ctrlKey) return;

      event.preventDefault();

      if (event.shiftKey && event.altKey) return; // undefined combo

      if (event.shiftKey) {
        // Shift+Enter: copy all entries, wherever the focus is.
        void copyAll();
        pressButton(copyAllBtn);
        return;
      }

      if (event.altKey) {
        // Alt+Enter: renumber (clear all and restart from a chosen number),
        // wherever the focus is.
        openRenumberDialog();
        pressButton(renumberBtn);
        return;
      }

      // Enter: next entry, or auto-create one at the end when there is none.
      const next = entries[index + 1];
      if (next) {
        focusEntry(next.id);
      } else {
        const entry = createEntry();
        render();
        focusEntry(entry.id);
        pressButton(addEntryBtn);
      }
    });

    const deleteEntryBtn = document.createElement("button");
    deleteEntryBtn.className = "btn btn-small btn-icon";
    deleteEntryBtn.type = "button";
    deleteEntryBtn.textContent = "✕";
    deleteEntryBtn.title = "Delete entry";
    deleteEntryBtn.addEventListener("click", () => {
      deleteEntry(entry.id);
    });

    row.append(label, textarea, deleteEntryBtn);
    entriesEl.appendChild(row);
  });

  boardEl.appendChild(entriesEl);
}

copyAllBtn.addEventListener("click", () => {
  void copyAll();
});
clearAllBtn.addEventListener("click", clearAll);
addEntryBtn.addEventListener("click", addEntry);
renumberBtn.addEventListener("click", openRenumberDialog);

renumberOkBtn.addEventListener("click", confirmRenumber);
renumberCancelBtn.addEventListener("click", () => renumberDialog.close());
renumberInput.addEventListener("input", () => {
  renumberInput.value = renumberInput.value.replace(/\D/g, "");
  updateRenumberStepper();
});
renumberInput.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Enter") {
    event.preventDefault();
    confirmRenumber();
    return;
  }
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    stepRenumber((event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1));
  }
});
renumberInput.addEventListener("animationend", () => {
  renumberInput.classList.remove("invalid");
});
renumberDialog.addEventListener("click", (event) => {
  // Click on the backdrop closes the dialog (cancel = no-op).
  if (event.target === renumberDialog) {
    renumberDialog.close();
  }
});
attachRenumberStepper(renumberStepDownBtn, -1);
attachRenumberStepper(renumberStepUpBtn, 1);

function applyThemeButtons(theme: Theme): void {
  themeBtns.forEach((btn) => {
    const active = btn.dataset.theme === theme;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

themeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const theme = btn.dataset.theme;
    if (isTheme(theme)) {
      setTheme(theme);
      applyThemeButtons(theme);
    }
  });
});

// Font settings dialog: every change applies live (same as the theme toggle).
// The preview lines render through the same CSS custom properties as the
// board, so they update by themselves — no preview code needed.
function openFontDialog(): void {
  const settings = loadFontSettings();
  uiFontInput.value = settings.uiFont;
  inputFontInput.value = settings.inputFont;
  inputFontSizeInput.value =
    settings.inputFontSize === null ? "" : String(settings.inputFontSize);
  numberFontInput.value = settings.numberFont;
  numberFontSizeInput.value =
    settings.numberFontSize === null ? "" : String(settings.numberFontSize);
  fontDialog.showModal();
  uiFontInput.focus();
  uiFontInput.select();
}

// Font size inputs: empty means "use the default"; values outside the allowed
// range are ignored until they become valid (so typing "15" via "1" does not
// apply the intermediate "1").
function parseFontSize(raw: string): number | null | undefined {
  const value = raw.trim();
  if (value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_FONT_SIZE || parsed > MAX_FONT_SIZE) {
    return undefined;
  }
  return parsed;
}

fontSettingsBtn.addEventListener("click", openFontDialog);
fontDialogCloseBtn.addEventListener("click", () => fontDialog.close());
fontDialog.addEventListener("click", (event) => {
  // Click on the backdrop closes the dialog.
  if (event.target === fontDialog) {
    fontDialog.close();
  }
});

uiFontInput.addEventListener("input", () => {
  setUiFont(uiFontInput.value);
});
inputFontInput.addEventListener("input", () => {
  setInputFont(inputFontInput.value);
});
numberFontInput.addEventListener("input", () => {
  setNumberFont(numberFontInput.value);
});
inputFontSizeInput.addEventListener("input", () => {
  const size = parseFontSize(inputFontSizeInput.value);
  if (size !== undefined) setInputFontSize(size);
});
numberFontSizeInput.addEventListener("input", () => {
  const size = parseFontSize(numberFontSizeInput.value);
  if (size !== undefined) setNumberFontSize(size);
});

initPrefs();
applyThemeButtons(loadTheme());

render();
