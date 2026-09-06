# ADR 0004: Platform settings and safe socket rebinding

## Context

Answer Board needs one durable home for theme, fonts, and the TCP service
binding. The socket may also need to move between a loopback address and a LAN
address while the app is running.

## Decision

- Store a single `settings.json` under Tauri's platform configuration
  directory. Writes use a temporary file followed by replacement.
- Treat `ANSWER_BOARD_SOCKET_BIND` as a startup-only override. It is never
  written to the settings file; removing it restores the saved binding.
- Rebinding is transactional: bind the new address first, then stop the old
  listener. A failed bind leaves the old listener and saved configuration
  unchanged.
- Keep the effective source (`environment`, `saved`, or `default`) and service
  state in memory and publish changes through `service-status-changed`.

## Consequences

The Service settings tab can report exactly which binding is active and why.
Users can recover from an occupied or invalid port without losing a working
listener. The settings file is intentionally process-independent; application
restart is required to re-evaluate the environment override.
