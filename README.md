# 答题板 Answer Board

A Tauri 2 native desktop app: a simple answer board for tracking answers in a
grilling session. Pure in-memory — nothing is persisted; closing the app
discards everything.

## Features

- **条目 (Entry)** — each entry is one answer slot: a multi-line text area with
  an auto-assigned label (`Q1`, `Q2`, `Q3`, …). Numbering is derived from the
  current start number plus the entry's position, so it is always continuous;
  deleting a middle entry shifts the ones after it.
- **添加 (Add)** — appends one new entry at the end and focuses it.
- **重编号 (Renumber)** — clears all entries, asks for a new start number
  (positive integer only; canceling does nothing), then recreates a single
  entry with that number. The numbering continues from there.
- **复制全部 (Copy All)** — copies all entries as `Q{n}: {answer}` lines
  separated by single newlines.
- **清除 (Clear)** — removes all entries and resets numbering to Q1 (no
  confirmation, per spec).
- Copy feedback: a brief **Copied** toast.

## Keyboard shortcuts

- **Enter** — focus the next entry; at the end, creates a new one.
- **Shift+Enter** — copy all entries.
- **Alt+Enter** — renumber (clear all and restart from a chosen number).
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
