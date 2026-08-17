import { writeText } from "@tauri-apps/plugin-clipboard-manager";

type Entry = { id: number; text: string };
type Round = { id: number; entries: Entry[] };

let nextId = 1;
const rounds: Round[] = [];

const boardEl = document.getElementById("board") as HTMLElement;
const toastEl = document.getElementById("toast") as HTMLElement;
const copyAllBtn = document.getElementById("copy-all-btn") as HTMLButtonElement;
const clearAllBtn = document.getElementById("clear-all-btn") as HTMLButtonElement;
const addEntryBtn = document.getElementById("add-entry-btn") as HTMLButtonElement;
const addRoundBtn = document.getElementById("add-round-btn") as HTMLButtonElement;

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

function ensureLastRound(): Round {
  if (rounds.length === 0) {
    return addRound();
  }
  return rounds[rounds.length - 1];
}

function addEntry(): void {
  const round = ensureLastRound();
  const entry: Entry = { id: nextId++, text: "" };
  round.entries.push(entry);
  render();
  const textarea = document.querySelector<HTMLTextAreaElement>(
    `textarea[data-entry-id="${entry.id}"]`
  );
  textarea?.focus();
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
  render();
}

function clearAll(): void {
  rounds.length = 0;
  render();
}

// Global continuous Q-number of the entry at (roundIndex, entryIndex).
function entryNumber(roundIndex: number, entryIndex: number): number {
  let n = 0;
  for (let i = 0; i < roundIndex; i++) {
    n += rounds[i].entries.length;
  }
  return n + entryIndex + 1;
}

// Number of entries that precede the given round (for Q numbering).
function entriesBeforeRound(roundIndex: number): number {
  let n = 0;
  for (let i = 0; i < roundIndex; i++) {
    n += rounds[i].entries.length;
  }
  return n;
}

// Format one round: each entry on its own line "Q{n}: {answer}",
// entries separated by a blank line. Empty round -> empty string.
function formatRound(round: Round): string {
  const roundIndex = rounds.indexOf(round);
  let q = entriesBeforeRound(roundIndex);
  const lines: string[] = [];
  for (const entry of round.entries) {
    q += 1;
    lines.push(`Q${q}: ${entry.text}`);
  }
  return lines.join("\n\n");
}

// Format everything: each round is prepended with a "Round N" title line,
// rounds separated by a blank line. Empty rounds still emit their title line.
function formatAll(): string {
  const blocks: string[] = [];
  let q = 0;
  rounds.forEach((round, roundIndex) => {
    const blockLines: string[] = [`Round ${roundIndex + 1}`];
    for (const entry of round.entries) {
      q += 1;
      blockLines.push(`Q${q}: ${entry.text}`);
    }
    blocks.push(blockLines.join("\n\n"));
  });
  return blocks.join("\n\n");
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
  const round = rounds.find((r) => r.id === roundId);
  if (!round) return;
  const ok = await copyText(formatRound(round));
  showToast(ok ? "已复制" : "复制失败");
}

async function copyAll(): Promise<void> {
  const ok = await copyText(formatAll());
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

    const header = document.createElement("div");
    header.className = "round-header";

    const title = document.createElement("h2");
    title.className = "round-title";
    title.textContent = `Round ${roundIndex + 1}`;

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
    header.append(title, actions);
    section.appendChild(header);

    const entriesEl = document.createElement("div");
    entriesEl.className = "entries";

    round.entries.forEach((entry, entryIndex) => {
      const row = document.createElement("div");
      row.className = "entry-row";

      const label = document.createElement("span");
      label.className = "entry-label";
      label.textContent = `Q${entryNumber(roundIndex, entryIndex)}`;

      const textarea = document.createElement("textarea");
      textarea.className = "entry-input";
      textarea.rows = 2;
      textarea.placeholder = "答案…";
      textarea.dataset.entryId = String(entry.id);
      textarea.value = entry.text;
      textarea.addEventListener("input", () => {
        entry.text = textarea.value;
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
addRoundBtn.addEventListener("click", () => {
  addRound();
  render();
});

render();
