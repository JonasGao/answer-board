# Bidirectional TCP JSON delivery

Answer Board now uses a long-lived TCP socket with one JSON object per line for
agent delivery. The old write-only HTTP endpoint is removed.

## Decision

- The default listener is `127.0.0.1:8787`; `ANSWER_BOARD_SOCKET_BIND` can
  change the bind address.
- Every delivery has a client-generated `round_id`. Reconnecting with the same
  ID resumes an answering round or replays its completed/stopped result.
- A session accepts only one answering round at a time. Once that round is
  completed or stopped, the next delivery is appended to the session's round
  history.
- The board sends a structured result only when the operator explicitly replies
  or stops the round. The client waits indefinitely and reconnects after a
  connection loss.
- Round state remains in memory, so frontend refreshes do not lose it; an
  application restart still starts with an empty board.

## Consequences

The agent no longer needs a copy/paste step, and the board can preserve a
read-only history of earlier rounds. Existing HTTP delivery clients must be
updated to the socket protocol. The local-only default avoids exposing an
unauthenticated listener beyond the machine unless explicitly configured.
