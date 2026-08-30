# 答题板 Answer Board

A Tauri 2 native desktop app: a simple answer board for tracking answers in a
grilling session. Pure in-memory — nothing is persisted; closing the app
discards everything.

## Features

- **条目 (Entry)** — each entry is one answer slot: a multi-line text area with
  an explicit Q-number of its own. Numbers are unique and the board stays
  sorted by number; gaps are allowed, so a round can be Q2, Q4, Q5 — e.g. Q2
  is a question from the previous round that must be answered again. Deleting
  an entry leaves the other numbers untouched.
- **添加 (Add)** — appends one new entry at the end with the next number
  (max on board + 1, or Q1 when empty) and focuses it.
- **重编号 (Renumber)** — clears all entries, asks for a list of numbers
  ("2, 4 5"; duplicates reject the whole input), then rebuilds the board from
  that list in ascending order. A single number keeps the old behavior:
  restart there with one entry. Prefilled with the next number; canceling
  does nothing.
- **改号 (Relabel)** — click an entry's Q-label to edit its number in place;
  the entry moves to its sorted position. Use it to add a re-answered old
  number mid-round.
- **复制全部 (Copy All)** — copies all entries as `Q{n}: {answer}` lines
  separated by single newlines.
- **清除 (Clear)** — removes all entries (no confirmation, per spec).
- Copy feedback: a brief **Copied** toast.

## Keyboard shortcuts

- **Enter** — focus the next entry; at the end, creates a new one.
- **Shift+Enter** — copy all entries.
- **Alt+Enter** — renumber (clear all and rebuild from a list of numbers).
- **Ctrl+Enter** — insert a newline in the text area.

## Development

Prerequisites: Node.js ≥ 20, pnpm, Rust toolchain, and the WebView2 runtime
(Windows 10/11 usually ships it).

```bash
pnpm install        # install frontend dependencies
pnpm tauri dev      # run the app in development
```

## Build

```bash
pnpm tauri build    # produce a release bundle (NSIS/MSI on Windows)
```

## Verification

```bash
pnpm build          # type-check (tsc) + build frontend (vite)
cargo check         # in src-tauri/ — check the Rust backend
```
