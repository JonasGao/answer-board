// Pure domain + formatting logic for the answer board: the Entry type,
// Q-numbering, clipboard-text serialization, and renumber-list parsing. No
// DOM, no I/O — everything here is a pure function of the entries array (or
// the raw dialog input) so it can be reasoned about in isolation.

export type Entry = { id: number; number: number; text: string };

// The next Q-number to hand out: one past the current max, or 1 on an empty
// board. Used both as the renumber dialog's prefill and as the number given
// to a newly added entry.
export function nextNumber(entries: Entry[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.number), 0) + 1;
}

// Board order: by number ascending (board numbers are unique).
export function byNumber(a: Entry, b: Entry): number {
  return a.number - b.number;
}

// Format everything: "Q{n}: {text}" lines joined by a single newline.
export function formatAll(entries: Entry[]): string {
  return entries.map((entry) => `Q${entry.number}: ${entry.text}`).join("\n");
}

export type ParsedNumberList =
  | { ok: true; numbers: number[] }
  | { ok: false; reason: "invalid" | "duplicate" };

// Parse a renumber list like "2, 4 5": positive integers separated by commas
// and/or whitespace, empty segments tolerated. The list comes back sorted
// ascending. Duplicates reject the whole input — no partial apply, so a typo
// ("2, 2, 5" meant "2, 3, 5") is never silently repaired.
export function parseNumberList(raw: string): ParsedNumberList {
  const parts = raw.split(/[\s,]+/).filter((part) => part !== "");
  if (parts.length === 0) return { ok: false, reason: "invalid" };

  const numbers: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return { ok: false, reason: "invalid" };
    const value = Number(part);
    if (value < 1) return { ok: false, reason: "invalid" };
    numbers.push(value);
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) return { ok: false, reason: "duplicate" };
  }
  return { ok: true, numbers: sorted };
}
