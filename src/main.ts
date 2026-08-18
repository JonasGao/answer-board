import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  type Entry,
  type Round,
  entryNumber,
  formatAll,
  formatRound,
  roundTitle,
} from "./format";
import {
  type Theme,
  initPrefs,
  isTheme,
  loadFont,
  loadTheme,
  setFont,
  setTheme,
} from "./prefs";

let nextId = 1;
const rounds: Round[] = [];
const collapsedRoundIds = new Set<number>();
const DEFAULT_ANSWER = "按建议";

const boardEl = document.getElementById("board") as HTMLElement;
const toastEl = document.getElementById("toast") as HTMLElement;
const copyAllBtn = document.getElementById("copy-all-btn") as HTMLButtonElement;
const clearAllBtn = document.getElementById("clear-all-btn") as HTMLButtonElement;
const addEntryBtn = document.getElementById("add-entry-btn") as HTMLButtonElement;
const addRoundBtn = document.getElementById("add-round-btn") as HTMLButtonElement;
const copyLatestBtn = document.getElementById("copy-latest-btn") as HTMLButtonElement;
const themeBtns = document.querySelectorAll<HTMLButtonElement>(".theme-btn");
const fontInput = document.getElementById("font-input") as HTMLInputElement;

let toastTimer: number | undefined;

function showToast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("visible");
  }, 1600);
}

function addRound(): Round {
  const round: Round = { id: nextId++, entries: [] };
  rounds.push(round);
  return round;
}

// "新建轮次": a fresh round that already contains one default-answer entry,
// which is focused so it is immediately usable. Kept separate from addRound()
// so the "添加" path (via ensureLastRound) still creates rounds with no
// entries.
function createEntry(round: Round): Entry {
  const entry: Entry = { id: nextId++, text: DEFAULT_ANSWER };
  round.entries.push(entry);
  return entry;
}

function focusEntry(entryId: number): void {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    `textarea[data-entry-id="${entryId}"]`
  );
  textarea?.focus();
}

// Next entry in global order (round by round, entry by entry), skipping
// empty rounds. Returns the round id plus the entry, or null when there is no
// next entry.
function findNextEntry(
  roundIndex: number,
  entryIndex: number
): { roundId: number; entry: Entry } | null {
  const round = rounds[roundIndex];
  if (!round) return null;
  if (entryIndex + 1 < round.entries.length) {
    return { roundId: round.id, entry: round.entries[entryIndex + 1] };
  }
  for (let i = roundIndex + 1; i < rounds.length; i++) {
    const next = rounds[i];
    if (next.entries.length > 0) {
      return { roundId: next.id, entry: next.entries[0] };
    }
  }
  return null;
}

function addRoundWithEntry(): void {
  const previous = rounds[rounds.length - 1];
  if (previous) {
    collapsedRoundIds.add(previous.id);
  }
  const round = addRound();
  const entry = createEntry(round);
  render();
  focusEntry(entry.id);
}

function ensureLastRound(): Round {
  if (rounds.length === 0) {
    return addRound();
  }
  return rounds[rounds.length - 1];
}

function addEntry(): void {
  const round = ensureLastRound();
  collapsedRoundIds.delete(round.id);
  const entry = createEntry(round);
  render();
  focusEntry(entry.id);
}

function deleteEntry(roundId: number, entryId: number): void {
  const round = rounds.find((r) => r.id === roundId);
  if (!round) return;
  round.entries = round.entries.filter((e) => e.id !== entryId);
  render();
}

function deleteRound(roundId: number): void {
  const index = rounds.findIndex((r) => r.id === roundId);
  if (index === -1) return;
  rounds.splice(index, 1);
  collapsedRoundIds.delete(roundId);
  render();
}

function clearAll(): void {
  rounds.length = 0;
  collapsedRoundIds.clear();
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

async function copyRound(roundId: number): Promise<void> {
  const roundIndex = rounds.findIndex((r) => r.id === roundId);
  if (roundIndex === -1) return;
  const ok = await copyText(formatRound(rounds, roundIndex));
  showToast(ok ? "已复制" : "复制失败");
}

function copyLatestRound(): void {
  const last = rounds[rounds.length - 1];
  if (!last) {
    showToast("无批次");
    return;
  }
  void copyRound(last.id);
}

async function copyAll(): Promise<void> {
  const ok = await copyText(formatAll(rounds));
  showToast(ok ? "已复制" : "复制失败");
}

function render(): void {
  boardEl.textContent = "";

  if (rounds.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "点击「添加」或「新建轮次」开始";
    boardEl.appendChild(hint);
    return;
  }

  rounds.forEach((round, roundIndex) => {
    const section = document.createElement("section");
    section.className = "round";
    const collapsed = collapsedRoundIds.has(round.id);
    if (collapsed) {
      section.classList.add("collapsed");
    }

    const header = document.createElement("div");
    header.className = "round-header";

    const headerLeft = document.createElement("div");
    headerLeft.className = "round-header-left";

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "btn btn-small btn-icon round-toggle";
    toggleBtn.type = "button";
    toggleBtn.textContent = collapsed ? "▸" : "▾";
    toggleBtn.title = "折叠/展开";
    toggleBtn.setAttribute("aria-expanded", String(!collapsed));
    toggleBtn.addEventListener("click", () => {
      if (collapsedRoundIds.has(round.id)) {
        collapsedRoundIds.delete(round.id);
      } else {
        collapsedRoundIds.add(round.id);
      }
      render();
    });

    const title = document.createElement("h2");
    title.className = "round-title";
    title.textContent = roundTitle(roundIndex);

    headerLeft.append(toggleBtn, title);

    const actions = document.createElement("div");
    actions.className = "round-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn btn-small";
    copyBtn.type = "button";
    copyBtn.textContent = "复制批次";
    copyBtn.addEventListener("click", () => {
      void copyRound(round.id);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-small btn-icon";
    deleteBtn.type = "button";
    deleteBtn.textContent = "✕";
    deleteBtn.title = "删除该轮次";
    deleteBtn.addEventListener("click", () => {
      deleteRound(round.id);
    });

    actions.append(copyBtn, deleteBtn);
    header.append(headerLeft, actions);
    section.appendChild(header);

    if (collapsed) {
      boardEl.appendChild(section);
      return;
    }

    const entriesEl = document.createElement("div");
    entriesEl.className = "entries";

    round.entries.forEach((entry, entryIndex) => {
      const row = document.createElement("div");
      row.className = "entry-row";

      const label = document.createElement("span");
      label.className = "entry-label";
      label.textContent = `Q${entryNumber(rounds, roundIndex, entryIndex)}`;

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
        if (event.isComposing || event.key !== "Enter" || !event.shiftKey) return;
        event.preventDefault();
        const next = findNextEntry(roundIndex, entryIndex);
        if (next) {
          if (collapsedRoundIds.has(next.roundId)) {
            collapsedRoundIds.delete(next.roundId);
            render();
          }
          focusEntry(next.entry.id);
        } else {
          void copyRound(round.id);
        }
      });

      const deleteEntryBtn = document.createElement("button");
      deleteEntryBtn.className = "btn btn-small btn-icon";
      deleteEntryBtn.type = "button";
      deleteEntryBtn.textContent = "✕";
      deleteEntryBtn.title = "删除该条目";
      deleteEntryBtn.addEventListener("click", () => {
        deleteEntry(round.id, entry.id);
      });

      row.append(label, textarea, deleteEntryBtn);
      entriesEl.appendChild(row);
    });

    section.appendChild(entriesEl);
    boardEl.appendChild(section);
  });
}

copyAllBtn.addEventListener("click", () => {
  void copyAll();
});
clearAllBtn.addEventListener("click", clearAll);
addEntryBtn.addEventListener("click", addEntry);
addRoundBtn.addEventListener("click", addRoundWithEntry);
copyLatestBtn.addEventListener("click", copyLatestRound);

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

fontInput.addEventListener("input", () => {
  setFont(fontInput.value);
});

initPrefs();
applyThemeButtons(loadTheme());
fontInput.value = loadFont();

render();
