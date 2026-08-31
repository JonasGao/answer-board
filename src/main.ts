import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { type Entry, byNumber, formatAll, nextNumber, parseNumberList } from "./format";
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
// Entries carry their own Q-number; the array stays sorted by it.
const entries: Entry[] = [];
const DEFAULT_ANSWER = "As suggested";

const boardEl = document.getElementById("board") as HTMLElement;
const toastEl = document.getElementById("toast") as HTMLElement;
const copyAllBtn = document.getElementById("copy-all-btn") as HTMLButtonElement;
const clearAllBtn = document.getElementById("clear-all-btn") as HTMLButtonElement;
const addEntryBtn = document.getElementById("add-entry-btn") as HTMLButtonElement;
const renumberBtn = document.getElementById("renumber-btn") as HTMLButtonElement;
const themeBtns = document.querySelectorAll<HTMLButtonElement>(".theme-btn");
const overflowBtn = document.getElementById("overflow-btn") as HTMLButtonElement;
const overflowMenu = document.getElementById("overflow-menu") as HTMLElement;

const renumberDialog = document.getElementById("renumber-dialog") as HTMLDialogElement;
const renumberInput = document.getElementById("renumber-input") as HTMLInputElement;
const renumberStepDownBtn = document.getElementById("renumber-step-down") as HTMLButtonElement;
const renumberStepUpBtn = document.getElementById("renumber-step-up") as HTMLButtonElement;
const renumberHintEl = document.getElementById("renumber-hint") as HTMLElement;
const renumberOkBtn = document.getElementById("renumber-ok") as HTMLButtonElement;
const renumberCancelBtn = document.getElementById("renumber-cancel") as HTMLButtonElement;

const appearanceBtn = document.getElementById("appearance-btn") as HTMLButtonElement;
const appearanceDialog = document.getElementById("appearance-dialog") as HTMLDialogElement;
const appearanceDialogCloseBtn = document.getElementById("appearance-dialog-close") as HTMLButtonElement;
const appearanceDialogCloseBottomBtn = document.getElementById("appearance-dialog-close-bottom") as HTMLButtonElement;
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

function createEntry(number: number): Entry {
  const entry: Entry = { id: nextId++, number, text: DEFAULT_ANSWER };
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
  const entry = createEntry(nextNumber(entries));
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
  render();
}

function closeOverflowMenu(returnFocus = false): void {
  if (overflowMenu.hidden) return;
  overflowMenu.hidden = true;
  overflowBtn.setAttribute("aria-expanded", "false");
  if (returnFocus) overflowBtn.focus();
}

function toggleOverflowMenu(): void {
  const willOpen = overflowMenu.hidden;
  overflowMenu.hidden = !willOpen;
  overflowBtn.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) overflowMenu.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
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
  const ok = await copyText(formatAll(entries));
  showToast(ok ? "Copied" : "Copy failed");
}

// Renumber flow (Alt+Enter / Renumber button): ask for the list of numbers to
// answer FIRST; only on confirm do we clear everything and rebuild from that
// list. Cancel or invalid input is a no-op.
function openRenumberDialog(): void {
  // Prefill with the next number after the current max (1 on an empty board):
  // the common "just continue" case, which can then be extended into a list.
  renumberInput.value = String(nextNumber(entries));
  renumberDialog.showModal();
  renumberInput.focus();
  renumberInput.select();
  updateRenumberDialog();
}

function confirmRenumber(): void {
  const parsed = parseNumberList(renumberInput.value);
  if (!parsed.ok) {
    shakeRenumberInput();
    return;
  }
  renumberDialog.close();
  entries.length = 0;
  for (const number of parsed.numbers) {
    createEntry(number);
  }
  render();
  if (entries.length > 0) focusEntry(entries[0].id);
}

// Steppers only make sense while the input is a single number; a list
// disables them. While the input parses, the hint previews the board it
// would build; otherwise it names the duplicate problem or falls back to the
// next-number suggestion.
function updateRenumberDialog(): void {
  const parsed = parseNumberList(renumberInput.value);
  const single = parsed.ok && parsed.numbers.length === 1 ? parsed.numbers[0] : null;
  renumberStepDownBtn.disabled = single === null || single <= 1;
  renumberStepUpBtn.disabled = single === null;
  renumberHintEl.textContent = !parsed.ok
    ? parsed.reason === "duplicate"
      ? "Duplicate numbers — every number must be distinct"
      : `Next: ${nextNumber(entries)}`
    : `Board becomes: ${parsed.numbers.map((n) => `Q${n}`).join(" · ")}`;
}

function stepRenumber(delta: number): void {
  const parsed = parseNumberList(renumberInput.value);
  if (!parsed.ok || parsed.numbers.length !== 1) return;
  renumberInput.value = String(Math.max(1, parsed.numbers[0] + delta));
  renumberInput.focus();
  updateRenumberDialog();
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

// Relabel: swap an entry's number label for a small inline editor. Enter or
// blur commits (the entry then re-sorts to its new position); Escape cancels.
// A commit that would collide with an existing number keeps the editor open:
// via Enter it shakes (plus a toast for the collision case), via click-away
// it silently restores the label.
function startRelabel(entry: Entry, label: HTMLButtonElement): void {
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.className = "relabel-input";
  input.ariaLabel = "Entry number";
  input.value = String(entry.number);
  label.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;
  const commit = (viaEnter: boolean): void => {
    if (settled) return;
    const parsed = /^\d+$/.test(input.value) ? Number(input.value) : NaN;
    const valid = Number.isInteger(parsed) && parsed >= 1;
    const collision = valid && entries.some((other) => other.id !== entry.id && other.number === parsed);
    if (valid && !collision) {
      settled = true;
      entry.number = parsed;
      entries.sort(byNumber);
      render();
      focusEntry(entry.id);
      return;
    }
    if (viaEnter) {
      input.classList.remove("invalid");
      void input.offsetWidth; // restart the shake even on repeat attempts
      input.classList.add("invalid");
      if (collision) showToast("That number is already on the board");
      return;
    }
    settled = true;
    render(); // click-away with an invalid value just cancels
  };

  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "");
  });
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commit(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      settled = true;
      render();
    }
  });
  input.addEventListener("blur", () => commit(false));
}

function render(): void {
  boardEl.textContent = "";

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const mark = document.createElement("div");
    mark.className = "empty-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "+";
    const title = document.createElement("p");
    title.className = "empty-title";
    title.textContent = "No answers yet";
    const add = document.createElement("button");
    add.className = "btn";
    add.type = "button";
    add.textContent = "Add first answer";
    add.title = "Add first answer";
    add.addEventListener("click", addEntry);
    empty.append(mark, title, add);
    boardEl.appendChild(empty);
    return;
  }

  const entriesEl = document.createElement("div");
  entriesEl.className = "entries";

  entries.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "entry-row";

    const label = document.createElement("button");
    label.type = "button";
    label.className = "entry-label";
    label.title = "Click to edit number";
    label.textContent = `Q${entry.number}`;
    label.addEventListener("click", () => startRelabel(entry, label));

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
      if (textarea.value === DEFAULT_ANSWER) {
        textarea.select();
      }
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
        const entry = createEntry(nextNumber(entries));
        render();
        focusEntry(entry.id);
        pressButton(addEntryBtn);
      }
    });

    const deleteEntryBtn = document.createElement("button");
    deleteEntryBtn.className = "delete-entry-btn";
    deleteEntryBtn.type = "button";
    deleteEntryBtn.textContent = "✕";
    deleteEntryBtn.ariaLabel = "Delete entry";
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
clearAllBtn.addEventListener("click", () => {
  closeOverflowMenu(true);
  clearAll();
});
addEntryBtn.addEventListener("click", addEntry);
renumberBtn.addEventListener("click", openRenumberDialog);
overflowBtn.addEventListener("click", toggleOverflowMenu);
document.addEventListener("pointerdown", (event) => {
  if (!overflowMenu.hidden && !event.composedPath().includes(overflowBtn) && !event.composedPath().includes(overflowMenu)) {
    closeOverflowMenu();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !overflowMenu.hidden) {
    event.preventDefault();
    closeOverflowMenu(true);
  }
});

renumberOkBtn.addEventListener("click", confirmRenumber);
renumberCancelBtn.addEventListener("click", () => renumberDialog.close());
renumberInput.addEventListener("input", () => {
  // Keep digits and the list separators; everything else is stripped.
  renumberInput.value = renumberInput.value.replace(/[^\d,\s]/g, "");
  updateRenumberDialog();
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
renumberDialog.querySelector<HTMLButtonElement>(".dialog-close")?.addEventListener("click", () => renumberDialog.close());

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
function openAppearanceDialog(): void {
  const settings = loadFontSettings();
  uiFontInput.value = settings.uiFont;
  inputFontInput.value = settings.inputFont;
  inputFontSizeInput.value =
    settings.inputFontSize === null ? "" : String(settings.inputFontSize);
  numberFontInput.value = settings.numberFont;
  numberFontSizeInput.value =
    settings.numberFontSize === null ? "" : String(settings.numberFontSize);
  appearanceDialog.showModal();
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

appearanceBtn.addEventListener("click", openAppearanceDialog);
appearanceDialogCloseBtn.addEventListener("click", () => appearanceDialog.close());
appearanceDialogCloseBottomBtn.addEventListener("click", () => appearanceDialog.close());
appearanceDialog.addEventListener("click", (event) => {
  // Click on the backdrop closes the dialog.
  if (event.target === appearanceDialog) {
    appearanceDialog.close();
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
