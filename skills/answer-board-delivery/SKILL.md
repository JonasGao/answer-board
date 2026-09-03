---
name: answer-board-delivery
description: Deliver a completed grilling round to Answer Board through its LAN HTTP endpoint.
disable-model-invocation: true
---

# Answer Board Delivery

Use this skill only when the user explicitly asks to deliver a grilling round to
Answer Board. It is independent of the skill that started grilling: it applies
after `$grill-with-docs`, `$grill-me`, or any other wrapper that ultimately runs
`/grilling`.

## Deliver a round

1. Keep one stable `session_id` for the entire grilling session. Use a distinct
   ID for each concurrently running agent. Prefer an explicit ID supplied by
   the user or `ANSWER_BOARD_SESSION_ID`; otherwise derive one from the current
   agent/task and reuse it for every round. An optional display name can come
   from `ANSWER_BOARD_SESSION_NAME`.
2. Wait until the current grilling frontier is complete. Every question must
   have a unique positive number and a recommendation. Preserve the grilling
   Markdown blocks exactly; send only the question blocks, without an
   introduction or closing commentary:

   ```text
   ❓ **Q1** - **Question title**: Question body

   ➡️ Recommended answer
   ```

3. Run `scripts/deliver-round.sh` from this skill directory. The script posts
   to `http://127.0.0.1:8787/api/rounds` by default. Use `--session-id` (and
   optionally `--session-name`) unless the corresponding environment variables
   are set.

   For a Markdown file:

   ```bash
   scripts/deliver-round.sh \
     --session-id "agent-checkout" \
     --session-name "Checkout design" \
     --markdown-file /path/to/round.md
   ```

   For generated Markdown on stdin:

   ```bash
   printf '%s\n' "$ROUND_MARKDOWN" |
     scripts/deliver-round.sh --session-id "agent-checkout"
   ```

   A complete structured payload can be sent without rewriting it:

   ```bash
   scripts/deliver-round.sh --json-file /path/to/round.json
   ```

4. Treat a successful JSON response as the delivery acknowledgement. `applied`
   means the first round became the session's current round immediately (the
   operator can select its tab); `queued` means the session's one pending round
   is waiting for the operator to enter it. A `409` means a pending round already
   exists: report it and do not retry or silently replace the round. For any
   other failure, report the script's error and keep the grilling round
   available in the conversation.

## Target and session configuration

`ANSWER_BOARD_TARGET` changes the destination without changing the command. It
accepts either `host:port` or a URL and defaults to `127.0.0.1:8787`:

```bash
ANSWER_BOARD_TARGET=192.168.1.20:8787 \
  scripts/deliver-round.sh --session-id "agent-checkout" --markdown-file round.md
```

The script also accepts `--target`, which overrides `ANSWER_BOARD_TARGET` for a
single delivery. `ANSWER_BOARD_SESSION_ID` and
`ANSWER_BOARD_SESSION_NAME` are convenience defaults for the matching command
options. The endpoint is write-only and has no query or authentication flow;
do not probe it with GET requests or invent a delivery acknowledgement.

Completion means the exact current grilling round was sent once, the HTTP
response was checked, and the result was reported to the user. Do not invoke
this skill implicitly and do not deliver partial rounds.
