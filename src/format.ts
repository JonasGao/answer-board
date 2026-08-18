// Pure domain + formatting logic for the answer board: the Entry/Round types,
// Q-numbering, and clipboard-text serialization. No DOM, no I/O — everything
// here is a pure function of the rounds array so it can be reasoned about in
// isolation.

export type Entry = { id: number; text: string };
export type Round = { id: number; entries: Entry[] };

// Number of entries that precede the given round (used for Q numbering).
export function entriesBeforeRound(
  rounds: Round[],
  roundIndex: number
): number {
  let n = 0;
  for (let i = 0; i < roundIndex; i++) {
    n += rounds[i].entries.length;
  }
  return n;
}

// Global continuous Q-number of the entry at (roundIndex, entryIndex).
export function entryNumber(
  rounds: Round[],
  roundIndex: number,
  entryIndex: number
): number {
  return entriesBeforeRound(rounds, roundIndex) + entryIndex + 1;
}

// Fixed round title: Round 1, Round 2, ...
export function roundTitle(roundIndex: number): string {
  return `Round ${roundIndex + 1}`;
}

// Emit one round's entries as "Q{n}: {text}" lines, advancing a running Q
// counter starting from startQ (exclusive).
function emitEntryLines(round: Round, startQ: number): string[] {
  const lines: string[] = [];
  let q = startQ;
  for (const entry of round.entries) {
    q += 1;
    lines.push(`Q${q}: ${entry.text}`);
  }
  return lines;
}

// Format one round: entries separated by a single newline. Empty round -> "".
export function formatRound(rounds: Round[], roundIndex: number): string {
  const startQ = entriesBeforeRound(rounds, roundIndex);
  return emitEntryLines(rounds[roundIndex], startQ).join("\n");
}

// Format everything: each round is prepended with a "Round N" title line,
// followed by a blank line before its entries; rounds separated by a blank
// line. Empty rounds still emit their title line only.
export function formatAll(rounds: Round[]): string {
  const blocks: string[] = [];
  let q = 0;
  rounds.forEach((round, roundIndex) => {
    const entries = emitEntryLines(round, q);
    q += round.entries.length;
    const block =
      entries.length > 0
        ? `${roundTitle(roundIndex)}\n\n${entries.join("\n")}`
        : `${roundTitle(roundIndex)}`;
    blocks.push(block);
  });
  return blocks.join("\n\n");
}
