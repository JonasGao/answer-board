# 答题板 Answer Board

A Tauri 2 native desktop app: a simple answer board for tracking answers in a
grilling session. State is kept in memory and survives frontend refreshes while
the app process is running; closing the app discards it.

## Bidirectional socket delivery

Agents deliver a grilling round over a long-lived TCP socket. The default
listener is local-only at `127.0.0.1:8787`; set `ANSWER_BOARD_SOCKET_BIND` to
change the address for one application launch. The **Appearance → Service**
tab configures and saves the binding address and port, and applies a new
listener immediately. The client target is configured with
`ANSWER_BOARD_TARGET`.

Settings are stored as `settings.json` in Tauri's platform configuration
directory (the standard Windows application config directory, or the XDG
config directory on Linux/macOS). Theme, fonts, and service settings share
this file. `ANSWER_BOARD_SOCKET_BIND` is a temporary startup override: it is
shown as the environment source and never overwrites the saved file. If the
override is removed, the saved service binding is restored on the next launch.
When a new binding cannot be opened, the old listener remains active and the
Service tab shows the error.

The socket uses one JSON object per line. A delivery includes a stable
`round_id`; reconnecting with the same ID resumes the existing round instead of
creating a duplicate:

```json
{"type":"deliver","protocol":1,"session_id":"agent-checkout","round_id":"round-1","markdown":"❓ **Q1** - **Scope**: Which users are included?\n\n➡️ Start with signed-in retail users."}
```

The bundled skill script handles Markdown/JSON conversion, reconnects forever
while waiting, and prints the structured result returned by the board:

```bash
skills/answer-board-delivery/scripts/deliver-round.sh \
  --session-id "agent-checkout" \
  --session-name "Checkout design" \
  --markdown-file /path/to/round.md
```

The board sends `round_result` only after the operator clicks **Reply Agent**
for a fully answered round. **Stop and return partial** sends
`status: "stopped"` with the current contents. If the socket disconnects before
a result is received, the client reconnects with the same `round_id`.

When a Codex terminal call yields a background session while waiting, that is
an intermediate state rather than a completed delivery. The delivery skill
must keep polling the same terminal session until the client prints and exits
with the final `round_result`; sending the delivery command again would risk a
duplicate round.

There is no HTTP compatibility endpoint in this version. The socket protocol is
intended for a trusted local machine; expose a wider bind address only when
that is appropriate for the environment.

## Features

- **条目 (Entry)** — each entry is one answer slot: a multi-line text area with
  an explicit Q-number of its own. Numbers are unique within a round and gaps
  are allowed.
- **会话标签 (Session tabs)** — Local always exists and cannot be closed.
  Delivered sessions use their stable ID and keep an in-memory history of
  rounds. Each session has at most one answering round at a time.
- **轮次面板 (Round panels)** — each delivered round is a collapsible panel.
  The newest answering round is expanded and editable; completed or stopped
  rounds are read-only. A new round automatically folds the previous one.
- **问题和推荐回答** — delivered entries safely render Markdown above the
  editable answer; raw HTML displays as text. Answers start as `As suggested`.
- **已答题 (Answered)** — delivered entries start unanswered. Editing an answer
  or pressing Enter to move on marks that entry answered and dims its row.
- **回复 Agent** — sends the complete round back through the waiting socket
  after every entry is marked answered.
- **停止并返回部分答案** — ends the waiting round and sends a structured
  partial result.
- **添加 (Add)** — appends one new local entry at the next number.
- **重编号 (Renumber)** — clears local entries and rebuilds them from a list of
  unique positive numbers.
- **改号 (Relabel)** — edits a local entry's number in place and preserves
  sorted order.
- **复制全部 (Copy All)** — copies local entries as `Q{n}: {answer}` lines.
- **清除 (Clear)** — removes all local entries.

## Keyboard shortcuts

- **Enter** — mark the current entry answered, then focus the next entry; at
  the end of the local board, create a new one.
- **Shift+Enter** — copy all entries.
- **Alt+Enter** — renumber the local board.
- **Ctrl+Enter** — insert a newline in the text area.

## Development

Prerequisites: Node.js ≥ 20, pnpm, Rust toolchain, and the WebView2 runtime
(Windows 10/11 usually ships it).

```bash
pnpm install
pnpm tauri dev
```

## Build and verification

```bash
pnpm build
cargo test                 # run from src-tauri/
cargo check                # run from src-tauri/
```
