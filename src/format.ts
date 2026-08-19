// Pure domain + formatting logic for the answer board: the Entry type,
// Q-numbering, and clipboard-text serialization. No DOM, no I/O — everything
// here is a pure function of the entries array and the start number so it can
// be reasoned about in isolation.

export type Entry = { id: number; text: string };

// Global continuous Q-number of the entry at the given index, derived from
// the start number: Q = startNumber + index.
export function entryNumber(startNumber: number, index: number): number {
  return startNumber + index;
}

// The next Q-number to start from: one past the current max (startNumber +
// entryCount), or the start number itself when the board is empty (no max
// exists yet). Default prefill for the renumber input.
export function nextNumber(entryCount: number, startNumber: number): number {
  return entryCount > 0 ? startNumber + entryCount : startNumber;
}

// Format everything: "Q{n}: {text}" lines joined by a single newline.
export function formatAll(entries: Entry[], startNumber: number): string {
  return entries
    .map((entry, index) => `Q${entryNumber(startNumber, index)}: ${entry.text}`)
    .join("\n");
}
