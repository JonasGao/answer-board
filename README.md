# 答题板 Answer Board

A Tauri 2 native desktop app: a simple answer board for tracking answers across
"rounds" of questioning. Pure in-memory — nothing is persisted; closing the app
discards everything.

## Features

- **条目 (Entry)** — each entry is one answer slot: a multi-line text area with
  an auto-assigned global label (`Q1`, `Q2`, `Q3`, …). Numbering is continuous
  across all rounds and never resets.
- **轮次 (Round)** — a container of entries with a fixed title (`Round 1`, `Round 2`, …).
- **添加** — appends one empty entry to the last round (auto-creates `Round 1` on first use).
- **新建轮次** — appends a new empty round.
- **复制批次** — copies that round's entries as `Q{n}: {answer}` lines (blank line between entries).
- **复制全部** — copies all rounds; each round is prefixed with a `Round N` title line.
- **清除** — removes all rounds and entries (no confirmation, per spec).
- Copy feedback: a brief **已复制** toast.

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
