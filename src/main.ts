import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { activeFontToken, filterFontFamilies, replaceFontToken } from "./font-completion";
import {
  type Entry,
  byNumber,
  formatAll,
  nextNumber,
  parseNumberList,
} from "./format";
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
  setCodeFont,
  setNumberFont,
  setNumberFontSize,
  setQuestionFont,
  setQuestionFontSize,
  setTheme,
  setUiFont,
  setUiFontSize,
} from "./prefs";

const LOCAL_ID = "local";
const DEFAULT_ANSWER = "As suggested";
const CHANGE_EVENT = "board-changed";
type Round = { revision: number; entries: Entry[] };
type Session = {
  id: string;
  name: string;
  local: boolean;
  current: Round | null;
  pending: Round | null;
};
type BoardChange = { session_id: string; status: "applied" | "queued" };
type SaveSnapshot = { revision: number; entries: Entry[] };

let sessions: Session[] = [];
let activeSessionId = LOCAL_ID;
let nextId = 1;
let toastTimer: number | undefined;
let refreshQueue = Promise.resolve();
const saveChains = new Map<string, Promise<boolean>>();
const pendingSaves = new Map<string, SaveSnapshot>();

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
const boardEl = $("board");
const boardContentEl = $("board-content");
const localToolbarEl = $("local-toolbar");
const tabsEl = $("session-tabs");
const roundBarEl = $("round-bar");
const toastEl = $("toast");
const copyAllBtn = $("copy-all-btn") as HTMLButtonElement;
const clearAllBtn = $("clear-all-btn") as HTMLButtonElement;
const addEntryBtn = $("add-entry-btn") as HTMLButtonElement;
const renumberBtn = $("renumber-btn") as HTMLButtonElement;
const renumberDialog = $("renumber-dialog") as HTMLDialogElement;
const renumberInput = $("renumber-input") as HTMLInputElement;
const renumberStepDownBtn = $("renumber-step-down") as HTMLButtonElement;
const renumberStepUpBtn = $("renumber-step-up") as HTMLButtonElement;
const renumberHintEl = $("renumber-hint");
const renumberOkBtn = $("renumber-ok") as HTMLButtonElement;
const renumberCancelBtn = $("renumber-cancel") as HTMLButtonElement;
const appearanceBtn = $("appearance-btn") as HTMLButtonElement;
const appearanceDialog = $("appearance-dialog") as HTMLDialogElement;
const appearanceDialogCloseBtn = $(
  "appearance-dialog-close",
) as HTMLButtonElement;
const appearanceDialogCloseBottomBtn = $(
  "appearance-dialog-close-bottom",
) as HTMLButtonElement;
const uiFontInput = $("ui-font-input") as HTMLInputElement;
const uiFontSizeInput = $("ui-font-size") as HTMLInputElement;
const inputFontInput = $("input-font-input") as HTMLInputElement;
const inputFontSizeInput = $("input-font-size") as HTMLInputElement;
const numberFontInput = $("number-font-input") as HTMLInputElement;
const numberFontSizeInput = $("number-font-size") as HTMLInputElement;
const questionFontInput = $("question-font-input") as HTMLInputElement;
const questionFontSizeInput = $("question-font-size") as HTMLInputElement;
const codeFontInput = $("code-font-input") as HTMLInputElement;
const themeBtns = document.querySelectorAll<HTMLButtonElement>(".theme-btn");

const fontInputs = [uiFontInput, inputFontInput, numberFontInput, questionFontInput, codeFontInput];
let systemFonts: string[] | null = null;
let systemFontsPromise: Promise<void> | null = null;

function activeSession(): Session | undefined {
  return sessions.find((session) => session.id === activeSessionId);
}
function activeEntries(): Entry[] {
  return activeSession()?.current?.entries ?? [];
}
function showToast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => toastEl.classList.remove("visible"),
    1600,
  );
}
function pressButton(btn: HTMLElement): void {
  btn.classList.remove("btn-pressed");
  void btn.offsetWidth;
  btn.classList.add("btn-pressed");
  window.setTimeout(() => btn.classList.remove("btn-pressed"), 150);
}
function syncNextId(): void {
  const max = sessions
    .flatMap((s) => [s.current?.entries ?? [], s.pending?.entries ?? []])
    .flat()
    .reduce((value, entry) => Math.max(value, entry.id), 0);
  nextId = Math.max(nextId, max + 1);
}
async function refreshAll(): Promise<void> {
  try {
    sessions = await invoke<Session[]>("get_sessions");
    syncNextId();
    if (!sessions.some((session) => session.id === activeSessionId))
      activeSessionId = LOCAL_ID;
    render();
  } catch (error) {
    console.error(error);
    showToast("Could not refresh sessions");
  }
}
async function refreshFromEvent(change: BoardChange): Promise<void> {
  try {
    const visibleSessionId = activeSessionId;
    const old = activeSession();
    const incoming = await invoke<Session[]>("get_sessions");
    const next = incoming.find((session) => session.id === visibleSessionId);
    const appliedToVisible =
      change.session_id === visibleSessionId && change.status === "applied";
    if (
      activeSessionId === visibleSessionId &&
      !appliedToVisible &&
      old?.current &&
      next
    )
      next.current = old.current;
    sessions = incoming;
    syncNextId();
    if (!sessions.some((session) => session.id === activeSessionId)) {
      activeSessionId = LOCAL_ID;
      render();
    } else if (activeSessionId !== visibleSessionId || appliedToVisible) render();
    else {
      renderTabs();
      renderRoundBar();
    }
  } catch (error) {
    console.error(error);
    showToast("Could not refresh sessions");
  }
}
function queueRefresh(task: () => Promise<void>): void {
  refreshQueue = refreshQueue.then(task, task);
}
function saveEntries(
  sessionId = activeSessionId,
  source = activeEntries(),
): Promise<boolean> {
  const snapshot = structuredClone(source);
  const revision = sessions.find((session) => session.id === sessionId)?.current
    ?.revision;
  if (revision === undefined) return Promise.resolve(false);
  pendingSaves.set(sessionId, { revision, entries: snapshot });
  const running = saveChains.get(sessionId);
  if (running) return running;
  const current = (async () => {
    let latestSucceeded = true;
    while (true) {
      const pending = pendingSaves.get(sessionId);
      if (!pending) return latestSucceeded;
      pendingSaves.delete(sessionId);
      try {
        await invoke("replace_entries", {
          payload: {
            session_id: sessionId,
            revision: pending.revision,
            entries: pending.entries,
          },
        });
        latestSucceeded = true;
      } catch (error) {
        latestSucceeded = false;
        console.error(error);
        showToast("Could not save answers");
      }
    }
  })();
  saveChains.set(sessionId, current);
  void current.finally(() => {
    if (saveChains.get(sessionId) === current) saveChains.delete(sessionId);
  });
  return current;
}
function blankEntry(number: number): Entry {
  return {
    id: nextId++,
    number,
    question: "",
    recommendation: "",
    text: DEFAULT_ANSWER,
  };
}
function addEntry(): void {
  if (!activeSession()?.local) return;
  const entry = blankEntry(nextNumber(activeEntries()));
  activeEntries().push(entry);
  void saveEntries();
  render();
  focusEntry(entry.id);
}
function focusEntry(id: number): void {
  document
    .querySelector<HTMLTextAreaElement>(`textarea[data-entry-id="${id}"]`)
    ?.focus();
}
function deleteEntry(id: number): void {
  if (!activeSession()?.local) return;
  const current = activeEntries();
  const index = current.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  current.splice(index, 1);
  void saveEntries();
  render();
}
function clearAll(): void {
  if (!activeSession()?.local) return;
  activeEntries().length = 0;
  void saveEntries();
  render();
}
async function copyAll(): Promise<void> {
  try {
    await writeText(formatAll(activeEntries()));
    showToast("Copied");
  } catch {
    try {
      await navigator.clipboard.writeText(formatAll(activeEntries()));
      showToast("Copied");
    } catch {
      showToast("Copy failed");
    }
  }
}

function appendInline(container: HTMLElement, text: string): void {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    container.append(document.createTextNode(text.slice(cursor, index)));
    const token = match[0];
    const el = document.createElement(
      token.startsWith("**") ? "strong" : "code",
    );
    if (token.startsWith("`")) el.className = "inline-code";
    el.textContent = token.startsWith("**")
      ? token.slice(2, -2)
      : token.slice(1, -1);
    container.append(el);
    cursor = index + token.length;
  }
  container.append(document.createTextNode(text.slice(cursor)));
}
function renderMarkdown(raw: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "markdown";
  let list: HTMLElement | null = null;
  let kind = "";
  let code: HTMLElement | null = null;
  for (const line of raw.split("\n")) {
    if (line.trim().startsWith("```")) {
      if (code) {
        root.append(code);
        code = null;
      } else {
        code = document.createElement("pre");
        code.className = "code-block";
        code.append(document.createElement("code"));
      }
      list = null;
      kind = "";
      continue;
    }
    if (code) {
      code.firstElementChild!.textContent += `${line}\n`;
      continue;
    }
    const unordered = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (unordered || ordered) {
      const nextKind = unordered ? "ul" : "ol";
      if (!list || kind !== nextKind) {
        list = document.createElement(nextKind);
        kind = nextKind;
        root.append(list);
      }
      const li = document.createElement("li");
      appendInline(li, (unordered ?? ordered)![1]);
      list.append(li);
      continue;
    }
    list = null;
    kind = "";
    if (!line.trim()) continue;
    const p = document.createElement("p");
    appendInline(p, line);
    root.append(p);
  }
  if (code) root.append(code);
  return root;
}

function activateSessionTab(index: number): void {
  const session = sessions[index];
  if (!session) return;
  activeSessionId = session.id;
  render();
  tabsEl
    .querySelector<HTMLButtonElement>(
      `.session-tab[data-session-id="${CSS.escape(session.id)}"]`,
    )
    ?.focus();
}
function renderTabs(): void {
  tabsEl.textContent = "";
  sessions.forEach((session, index) => {
    const wrap = document.createElement("div");
    wrap.className = "session-tab-wrap";
    wrap.classList.toggle("active", session.id === activeSessionId);
    wrap.setAttribute("role", "presentation");
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "session-tab";
    tab.id = `session-tab-${index}`;
    tab.dataset.sessionId = session.id;
    tab.textContent = session.name;
    tab.classList.toggle("active", session.id === activeSessionId);
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", "board");
    tab.setAttribute("aria-selected", String(session.id === activeSessionId));
    tab.tabIndex = session.id === activeSessionId ? 0 : -1;
    if (session.id === activeSessionId)
      boardEl.setAttribute("aria-labelledby", tab.id);
    if (session.pending) {
      const badge = document.createElement("span");
      badge.className = "pending-badge";
      badge.textContent = "1";
      badge.title = "One pending round";
      tab.append(badge);
    }
    tab.addEventListener("click", () => {
      activeSessionId = session.id;
      render();
    });
    tab.addEventListener("keydown", (event) => {
      let nextIndex: number | undefined;
      if (event.key === "ArrowLeft")
        nextIndex = (index - 1 + sessions.length) % sessions.length;
      else if (event.key === "ArrowRight")
        nextIndex = (index + 1) % sessions.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = sessions.length - 1;
      if (nextIndex === undefined) return;
      event.preventDefault();
      activateSessionTab(nextIndex);
    });
    wrap.append(tab);
    if (!session.local) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "tab-close";
      close.textContent = "×";
      close.title = "Close session";
      close.ariaLabel = `Close ${session.name} session`;
      close.addEventListener("click", () => void closeSession(session.id));
      wrap.append(close);
    }
    tabsEl.append(wrap);
  });
}
async function closeSession(id: string): Promise<void> {
  try {
    await (saveChains.get(id) ?? Promise.resolve(true));
    await invoke("close_session", { sessionId: id });
    if (activeSessionId === id) activeSessionId = LOCAL_ID;
    await refreshAll();
  } catch (error) {
    console.error(error);
    showToast("Could not close session");
  }
}
async function advanceRound(): Promise<void> {
  const session = activeSession();
  if (!session?.pending) return;
  if (!(await (saveChains.get(session.id) ?? Promise.resolve(true)))) return;
  try {
    await invoke("advance_round", { sessionId: session.id });
    await refreshAll();
  } catch (error) {
    console.error(error);
    showToast("Could not enter next round");
  }
}
function renderRoundBar(): void {
  roundBarEl.textContent = "";
  const session = activeSession();
  if (!session?.pending) {
    roundBarEl.hidden = true;
    return;
  }
  roundBarEl.hidden = false;
  const message = document.createElement("span");
  message.textContent = `A new round with ${session.pending.entries.length} questions is waiting.`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-primary";
  button.textContent = "Enter next round";
  button.addEventListener("click", () => void advanceRound());
  roundBarEl.append(message, button);
}
function startRelabel(entry: Entry, label: HTMLButtonElement): void {
  if (!activeSession()?.local) return;
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
  const commit = (strict: boolean): void => {
    if (settled) return;
    const value = /^\d+$/.test(input.value) ? Number(input.value) : NaN;
    const current = activeEntries();
    const collision =
      Number.isInteger(value) &&
      current.some((other) => other.id !== entry.id && other.number === value);
    if (Number.isInteger(value) && value > 0 && !collision) {
      settled = true;
      entry.number = value;
      current.sort(byNumber);
      void saveEntries();
      render();
      focusEntry(entry.id);
    } else if (strict) {
      input.classList.add("invalid");
      if (collision) showToast("That number is already on the board");
    } else {
      settled = true;
      render();
    }
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
  renderTabs();
  renderRoundBar();
  const session = activeSession();
  const isLocal = Boolean(session?.local);
  localToolbarEl.hidden = !isLocal;
  boardContentEl.textContent = "";
  const current = session?.current?.entries ?? [];
  if (!current.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const mark = document.createElement("div");
    mark.className = "empty-mark";
    mark.textContent = "+";
    const title = document.createElement("p");
    title.className = "empty-title";
    title.textContent = "No answers yet";
    const add = document.createElement("button");
    add.className = "btn";
    add.type = "button";
    add.textContent = "Add first answer";
    add.addEventListener("click", addEntry);
    empty.append(mark, title, add);
    if (isLocal) boardContentEl.append(empty);
    else {
      const message = document.createElement("div");
      message.className = "empty-state";
      message.append(mark, title);
      boardContentEl.append(message);
    }
    return;
  }
  const list = document.createElement("div");
  list.className = "entries";
  current.forEach((entry, index) => {
    const row = document.createElement("article");
    row.className = "entry-row";
    if (!isLocal) row.classList.add("delivery-entry-row");
    const label = document.createElement(isLocal ? "button" : "span");
    if (isLocal) (label as HTMLButtonElement).type = "button";
    label.className = "entry-label";
    if (!isLocal) label.classList.add("entry-label-static");
    label.textContent = `Q${entry.number}`;
    if (isLocal) {
      label.title = "Click to edit number";
      label.addEventListener("click", () =>
        startRelabel(entry, label as HTMLButtonElement),
      );
    }
    const content = document.createElement("div");
    content.className = "entry-content";
    if (entry.question) {
      const heading = document.createElement("div");
      heading.className = "content-label";
      heading.textContent = "Question";
      content.append(heading, renderMarkdown(entry.question));
    }
    if (entry.recommendation) {
      const recommendation = document.createElement("div");
      recommendation.className = "recommendation";
      const heading = document.createElement("div");
      heading.className = "content-label";
      heading.textContent = "Recommended answer";
      recommendation.append(heading, renderMarkdown(entry.recommendation));
      content.append(recommendation);
    }
    const textarea = document.createElement("textarea");
    textarea.className = "entry-input";
    textarea.rows = 2;
    textarea.placeholder = DEFAULT_ANSWER;
    textarea.dataset.entryId = String(entry.id);
    textarea.value = entry.text;
    textarea.addEventListener("input", () => {
      entry.text = textarea.value;
      void saveEntries(session!.id, current);
    });
    textarea.addEventListener("focus", () => {
      if (textarea.value === DEFAULT_ANSWER) textarea.select();
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.isComposing || event.key !== "Enter") return;
      if (event.ctrlKey) return;
      event.preventDefault();
      if (event.shiftKey && event.altKey) return;
      if (event.shiftKey) {
        void copyAll();
        pressButton(copyAllBtn);
      } else if (event.altKey) {
        if (session?.local) {
          openRenumberDialog();
          pressButton(renumberBtn);
        }
      } else {
        const next = current[index + 1];
        if (next) focusEntry(next.id);
        else if (session?.local) {
          const added = blankEntry(nextNumber(current));
          current.push(added);
          void saveEntries(session!.id, current);
          render();
          focusEntry(added.id);
          pressButton(addEntryBtn);
        }
      }
    });
    content.append(textarea);
    if (isLocal) {
      const remove = document.createElement("button");
      remove.className = "delete-entry-btn";
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Delete entry";
      remove.ariaLabel = "Delete entry";
      remove.addEventListener("click", () => deleteEntry(entry.id));
      row.append(label, content, remove);
    } else row.append(label, content);
    list.append(row);
  });
  boardContentEl.append(list);
}

function openRenumberDialog(): void {
  if (!activeSession()?.local) return;
  renumberInput.value = String(nextNumber(activeEntries()));
  renumberDialog.showModal();
  renumberInput.focus();
  renumberInput.select();
  updateRenumberDialog();
}
function confirmRenumber(): void {
  if (!activeSession()?.local) return;
  const parsed = parseNumberList(renumberInput.value);
  if (!parsed.ok) {
    renumberInput.classList.add("invalid");
    return;
  }
  renumberDialog.close();
  const current = activeEntries();
  current.splice(0, current.length, ...parsed.numbers.map(blankEntry));
  void saveEntries();
  render();
  if (current[0]) focusEntry(current[0].id);
}
function updateRenumberDialog(): void {
  const parsed = parseNumberList(renumberInput.value);
  const single =
    parsed.ok && parsed.numbers.length === 1 ? parsed.numbers[0] : null;
  renumberStepDownBtn.disabled = single === null || single <= 1;
  renumberStepUpBtn.disabled = single === null;
  renumberHintEl.textContent = parsed.ok
    ? `Board becomes: ${parsed.numbers.map((n) => `Q${n}`).join(" · ")}`
    : parsed.reason === "duplicate"
      ? "Duplicate numbers"
      : `Next: ${nextNumber(activeEntries())}`;
}
function stepRenumber(delta: number): void {
  const parsed = parseNumberList(renumberInput.value);
  if (!parsed.ok || parsed.numbers.length !== 1) return;
  renumberInput.value = String(Math.max(1, parsed.numbers[0] + delta));
  renumberInput.focus();
  updateRenumberDialog();
}
function attachStepper(btn: HTMLButtonElement, delta: number): void {
  let timer: number | undefined;
  let interval: number | undefined;
  let suppress = false;
  const stop = (): void => {
    window.clearTimeout(timer);
    window.clearInterval(interval);
    timer = interval = undefined;
  };
  btn.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    btn.setPointerCapture(event.pointerId);
    suppress = true;
    stepRenumber(delta * (event.shiftKey ? 10 : 1));
    timer = window.setTimeout(() => {
      interval = window.setInterval(() => stepRenumber(delta), 80);
    }, 400);
  });
  btn.addEventListener("pointerup", stop);
  btn.addEventListener("pointerleave", stop);
  btn.addEventListener("pointercancel", stop);
  btn.addEventListener("click", (event) => {
    if (suppress) {
      suppress = false;
      event.preventDefault();
    } else stepRenumber(delta * (event.shiftKey ? 10 : 1));
  });
}
function applyThemeButtons(theme: Theme): void {
  themeBtns.forEach((btn) => {
    const active = btn.dataset.theme === theme;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}
function closeFontSuggestions(): void {
  fontInputs.forEach((input) => {
    input.setAttribute("aria-expanded", "false");
    const list = document.getElementById(input.getAttribute("aria-controls")!);
    if (list) list.hidden = true;
  });
}
function renderFontSuggestions(input: HTMLInputElement): void {
  const list = document.getElementById(input.getAttribute("aria-controls")!);
  if (!list || !systemFonts) return;
  const token = activeFontToken(input.value, input.selectionStart ?? input.value.length);
  const matches = filterFontFamilies(systemFonts, token.query);
  list.textContent = "";
  matches.forEach((family) => {
    const option = document.createElement("div");
    option.className = "font-suggestion";
    option.setAttribute("role", "option");
    option.textContent = family;
    option.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const replacement = replaceFontToken(input.value, token, family);
      input.value = replacement.value;
      input.setSelectionRange(replacement.cursor, replacement.cursor);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      closeFontSuggestions();
    });
    list.append(option);
  });
  const visible = matches.length > 0;
  list.hidden = !visible;
  input.setAttribute("aria-expanded", String(visible));
}
function attachFontAutocomplete(input: HTMLInputElement): void {
  input.addEventListener("input", () => renderFontSuggestions(input));
  input.addEventListener("focus", () => renderFontSuggestions(input));
  input.addEventListener("keydown", (event) => {
    const list = document.getElementById(input.getAttribute("aria-controls")!);
    const options = list ? [...list.querySelectorAll<HTMLElement>("[role=option]")] : [];
    if (!options.length) return;
    const active = options.findIndex((option) => option.classList.contains("active"));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown"
        ? (active + 1) % options.length
        : (active - 1 + options.length) % options.length;
      options.forEach((option, index) => option.classList.toggle("active", index === next));
      options[next].scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" || event.key === "Tab") {
      const option = options[active < 0 ? 0 : active];
      option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      if (event.key === "Tab") event.preventDefault();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeFontSuggestions();
    }
  });
}
async function loadSystemFonts(): Promise<void> {
  if (systemFonts) return;
  if (systemFontsPromise) return systemFontsPromise;
  systemFontsPromise = invoke<string[]>("list_system_fonts")
    .then((fonts) => { systemFonts = fonts; })
    .catch((error) => { console.warn("System font suggestions unavailable", error); systemFonts = []; })
    .finally(() => { systemFontsPromise = null; });
  await systemFontsPromise;
}
function openAppearanceDialog(): void {
  const settings = loadFontSettings();
  uiFontInput.value = settings.uiFont;
  uiFontSizeInput.value = settings.uiFontSize === null ? "" : String(settings.uiFontSize);
  inputFontInput.value = settings.inputFont;
  inputFontSizeInput.value =
    settings.inputFontSize === null ? "" : String(settings.inputFontSize);
  numberFontInput.value = settings.numberFont;
  numberFontSizeInput.value =
    settings.numberFontSize === null ? "" : String(settings.numberFontSize);
  questionFontInput.value = settings.questionFont;
  questionFontSizeInput.value = settings.questionFontSize === null ? "" : String(settings.questionFontSize);
  codeFontInput.value = settings.codeFont;
  appearanceDialog.showModal();
  void loadSystemFonts();
  uiFontInput.focus();
  uiFontInput.select();
}
function parseFontSize(raw: string): number | null | undefined {
  if (!raw.trim()) return null;
  const value = Number(raw);
  return Number.isInteger(value) &&
    value >= MIN_FONT_SIZE &&
    value <= MAX_FONT_SIZE
    ? value
    : undefined;
}

copyAllBtn.addEventListener("click", () => void copyAll());
clearAllBtn.addEventListener("click", clearAll);
addEntryBtn.addEventListener("click", addEntry);
renumberBtn.addEventListener("click", openRenumberDialog);
renumberOkBtn.addEventListener("click", confirmRenumber);
renumberCancelBtn.addEventListener("click", () => renumberDialog.close());
renumberInput.addEventListener("input", () => {
  renumberInput.value = renumberInput.value.replace(/[^\d,\s]/g, "");
  updateRenumberDialog();
});
renumberInput.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Enter") {
    event.preventDefault();
    confirmRenumber();
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    stepRenumber(
      (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1),
    );
  }
});
renumberInput.addEventListener("animationend", () =>
  renumberInput.classList.remove("invalid"),
);
renumberDialog.addEventListener("click", (event) => {
  if (event.target === renumberDialog) renumberDialog.close();
});
renumberDialog
  .querySelector<HTMLButtonElement>(".dialog-close")
  ?.addEventListener("click", () => renumberDialog.close());
attachStepper(renumberStepDownBtn, -1);
attachStepper(renumberStepUpBtn, 1);
themeBtns.forEach((btn) =>
  btn.addEventListener("click", () => {
    if (isTheme(btn.dataset.theme)) {
      setTheme(btn.dataset.theme);
      applyThemeButtons(btn.dataset.theme);
    }
  }),
);
appearanceBtn.addEventListener("click", openAppearanceDialog);
appearanceDialogCloseBtn.addEventListener("click", () =>
  appearanceDialog.close(),
);
appearanceDialogCloseBottomBtn.addEventListener("click", () =>
  appearanceDialog.close(),
);
appearanceDialog.addEventListener("click", (event) => {
  if (event.target === appearanceDialog) appearanceDialog.close();
});
appearanceDialog.addEventListener("close", closeFontSuggestions);
uiFontInput.addEventListener("input", () => setUiFont(uiFontInput.value));
uiFontSizeInput.addEventListener("input", () => {
  const value = parseFontSize(uiFontSizeInput.value);
  if (value !== undefined) setUiFontSize(value);
});
inputFontInput.addEventListener("input", () =>
  setInputFont(inputFontInput.value),
);
numberFontInput.addEventListener("input", () =>
  setNumberFont(numberFontInput.value),
);
inputFontSizeInput.addEventListener("input", () => {
  const value = parseFontSize(inputFontSizeInput.value);
  if (value !== undefined) setInputFontSize(value);
});
numberFontSizeInput.addEventListener("input", () => {
  const value = parseFontSize(numberFontSizeInput.value);
  if (value !== undefined) setNumberFontSize(value);
});
questionFontInput.addEventListener("input", () => setQuestionFont(questionFontInput.value));
questionFontSizeInput.addEventListener("input", () => {
  const value = parseFontSize(questionFontSizeInput.value);
  if (value !== undefined) setQuestionFontSize(value);
});
codeFontInput.addEventListener("input", () => setCodeFont(codeFontInput.value));
fontInputs.forEach(attachFontAutocomplete);

initPrefs();
applyThemeButtons(loadTheme());
void listen<BoardChange>(CHANGE_EVENT, (event) => {
  queueRefresh(() => refreshFromEvent(event.payload));
})
  .then(() => queueRefresh(refreshAll))
  .catch((error) => {
    console.error(error);
    showToast("Could not connect to board state");
  });
