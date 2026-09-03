# 答题板 Answer Board

A Tauri 2 native desktop app: a simple answer board for tracking answers in a
grilling session. Pure in-memory — nothing is persisted; closing the app
discards everything.

## HTTP delivery

Agents on the same network can deliver a grilling round while the app runs:

```
POST http://<answer-board-host>:8787/api/rounds
Content-Type: application/json
```

The endpoint is write-only. A first round returns `{"status":"applied"}`.
If the session already has a current round, the new round becomes its single
pending round and returns `{"status":"queued"}`. Another delivery then returns
`409` until the operator selects **Enter next round**.

```bash
curl -X POST http://192.168.1.20:8787/api/rounds \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"agent-checkout","session_name":"Checkout design","questions":[
    {"number":1,"body":"**Scope**: Which users are included?","recommendation":"Start with signed-in retail users."},
    {"number":2,"body":"Which failure mode matters most?","recommendation":"Prioritize preventing duplicate charges."}
  ]}'
```

Original grilling Markdown is also accepted. Titles, paragraphs, and lists are
preserved as part of the question:

```bash
curl -X POST http://192.168.1.20:8787/api/rounds \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"agent-checkout","markdown":"❓ **Q3** - **Fallback**: What happens offline?\n\n- Reject immediately\n- Queue locally\n\n➡️ Reject immediately and explain how to retry."}'
```

`session_id` is required and stable; `session_name` is optional. Structured
questions require unique positive `number` values and nonempty `body` and
`recommendation`. Provide exactly one of `questions` or `markdown`.
Repeated requests are new rounds.

The service binds to `0.0.0.0:8787` by default, with no authentication or rate
limit. Use it only on a trusted network and firewall the port as needed. Set
`ANSWER_BOARD_HTTP_BIND` (for example `127.0.0.1:9000`) to override it.

## Features

- **条目 (Entry)** — each entry is one answer slot: a multi-line text area with
  an explicit Q-number of its own. Numbers are unique and the board stays
  sorted by number; gaps are allowed, so a round can be Q2, Q4, Q5 — e.g. Q2
  is a question from the previous round that must be answered again. Deleting
  an entry leaves the other numbers untouched.
- **会话标签 (Session tabs)** — Local always exists and cannot be closed.
  HTTP sessions use their stable ID, can be closed, and are recreated by a
  later delivery. Each tab has independent entries and a pending round.
- **问题和推荐回答** — delivered entries safely render Markdown above the
  editable answer; raw HTML displays as text. Answers start as `As suggested`.
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
