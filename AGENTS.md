# Agents

This file tells AI agents (Claude Code, subagents, etc.) how this repo is set up for the engineering skills.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature-slug>/`. See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Triage labels

Five canonical roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See [`docs/agents/domain.md`](docs/agents/domain.md).
