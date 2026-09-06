---
name: answer-board-delivery
description: Deliver one completed grilling round to Answer Board over its bidirectional TCP JSON socket and wait for the operator's result.
---

# Answer Board Delivery

Use this skill only when the user explicitly asks to deliver a grilling round to
Answer Board. It is independent of the skill that started grilling: it applies
after `$grill-with-docs`, `$grill-me`, or another wrapper that ultimately runs
`/grilling`.

## Deliver and wait

1. Keep one stable `session_id` for the entire grilling session. Use a distinct
   ID for each concurrently running agent. Prefer an explicit ID supplied by
   the user or `ANSWER_BOARD_SESSION_ID`; otherwise derive one from the current
   agent/task and reuse it for every round.
2. Create a fresh stable `round_id` for the current round. Preserve the exact
   grilling Markdown blocks and send only the question blocks, without an
   introduction or closing commentary.
3. Run `scripts/deliver-round.sh` from this skill directory. The script sends
   the round to `ANSWER_BOARD_TARGET` (default `127.0.0.1:8787`) over a
   newline-delimited JSON TCP socket, then waits indefinitely for a
   `round_result`. It automatically reconnects and resends the same
   `round_id` after a connection loss.

   ```bash
   scripts/deliver-round.sh \
     --session-id "agent-checkout" \
     --session-name "Checkout design" \
     --markdown-file /path/to/round.md
   ```

   A complete structured payload can be sent without rewriting it:

   ```bash
   scripts/deliver-round.sh --json-file /path/to/round.json
   ```

4. Treat the printed JSON `round_result` as the answer. `status: "completed"`
   means all entries were answered. `status: "stopped"` means the operator or
   agent stopped the round and the result may contain unanswered entries.
   Feed completed answers back into the grilling state before producing the
   next frontier. Do not copy the question or answer blocks into the
   conversation unless the user explicitly asks for them.

## Target and session configuration

`ANSWER_BOARD_TARGET` accepts `host:port` (and tolerates an `http://` prefix
for migration convenience) and defaults to `127.0.0.1:8787`.
`ANSWER_BOARD_SESSION_ID` and `ANSWER_BOARD_SESSION_NAME` are convenience
defaults for the matching command options.

The client sends one JSON object per line. Its `round_id` remains stable across
reconnects, so a retry cannot create a duplicate round. Ctrl-C sends a cancel
message when the round revision is known and exits with status 130.

Completion means the exact current grilling round was sent once, the script
waited for a structured result, and that result was incorporated into the
grilling state. Do not invoke this skill implicitly and do not deliver partial
rounds.
