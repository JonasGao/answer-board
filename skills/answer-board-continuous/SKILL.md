---
name: answer-board-continuous
description: Keep an explicitly requested grilling session in continuous Answer Board delivery mode, with no question output in the conversation.
---

# Answer Board Continuous Delivery

Use this skill only after the user explicitly asks to enter continuous Answer
Board mode. It is a wrapper around `$answer-board-delivery`, not a replacement
for the grilling skill that supplies the questions.

Once activated, keep the mode active for the rest of the grilling session:

1. Finish the current grilling frontier and pass its complete question blocks to
   `$answer-board-delivery`.
2. Do not print those question blocks, introductions, or manual copy/paste
   instructions in the conversation. The delivery skill sends them directly to
   Answer Board and waits indefinitely for a structured `round_result`.
   Keep the delivery terminal session alive by polling its returned session ID
   (`write_stdin` in Codex) until the final JSON is available. `Waited for
   background terminal` and `Worked for ...` are intermediate terminal states,
   not results. Do not finish the turn or emit a duplicate waiting message
   merely because the terminal has yielded.
3. Only after parsing `round_result`, incorporate `status: "completed"` answers
   into the grilling state, generate the next frontier, and deliver it
   immediately through the same delivery skill. Reuse one stable session ID for
   every round. If a user follow-up arrives while the terminal is pending,
   resume polling the same process and round; do not resend the delivery.
4. If the result is `status: "stopped"`, stop the continuous loop and report the
   partial result only when the user asks or when continuing is impossible.
5. A transport error, explicit user stop, or agent cancellation exits this mode;
   do not silently fall back to printing the pending questions.

The skill itself is never selected implicitly. “Continuous” means automatic
round-to-round delivery only after the user has explicitly activated this skill.
