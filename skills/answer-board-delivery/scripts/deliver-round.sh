#!/usr/bin/env bash
set -euo pipefail

target="${ANSWER_BOARD_TARGET:-127.0.0.1:8787}"
session_id="${ANSWER_BOARD_SESSION_ID:-}"
session_name="${ANSWER_BOARD_SESSION_NAME:-}"
json_file=""
markdown_file=""

usage() {
  cat <<'USAGE'
Usage:
  deliver-round.sh [options] < round.md
  deliver-round.sh [options] --markdown-file <file>
  deliver-round.sh [options] --json-file <file>

Options:
  --target <host:port|url>  Override ANSWER_BOARD_TARGET for this delivery
  --session-id <id>         Stable grilling session ID (required for Markdown)
  --session-name <name>     Optional session display name
  --markdown-file <file>    Read grilling Markdown from a file; '-' means stdin
  --json-file <file>        Read a complete /api/rounds JSON payload
  -h, --help                Show this help

Environment:
  ANSWER_BOARD_TARGET       Destination base, default: 127.0.0.1:8787
  ANSWER_BOARD_SESSION_ID   Default value for --session-id
  ANSWER_BOARD_SESSION_NAME Default value for --session-name
USAGE
}

die() {
  printf 'deliver-round.sh: %s\n' "$1" >&2
  exit 2
}

while (($# > 0)); do
  case "$1" in
    --target)
      (($# >= 2)) || die "--target requires a value"
      target="$2"
      shift 2
      ;;
    --session-id)
      (($# >= 2)) || die "--session-id requires a value"
      session_id="$2"
      shift 2
      ;;
    --session-name)
      (($# >= 2)) || die "--session-name requires a value"
      session_name="$2"
      shift 2
      ;;
    --markdown-file)
      (($# >= 2)) || die "--markdown-file requires a value"
      markdown_file="$2"
      shift 2
      ;;
    --json-file)
      (($# >= 2)) || die "--json-file requires a value"
      json_file="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1 (use --help)"
      ;;
  esac
done

if [[ -n "$json_file" && -n "$markdown_file" ]]; then
  die "choose exactly one of --json-file or --markdown-file"
fi

payload=""
if [[ -n "$json_file" ]]; then
  [[ -r "$json_file" ]] || die "cannot read JSON file: $json_file"
  payload="$(<"$json_file")"
else
  source=""
  if [[ -n "$markdown_file" ]]; then
    source="$markdown_file"
  elif [[ ! -t 0 ]]; then
    source="-"
  else
    die "provide --markdown-file, --json-file, or Markdown on stdin"
  fi
  [[ -n "$session_id" ]] || die "--session-id is required for Markdown input"
  command -v python3 >/dev/null 2>&1 || die "python3 is required for Markdown input"
  if [[ "$source" != "-" && ! -r "$source" ]]; then
    die "cannot read Markdown file: $source"
  fi
  payload="$(python3 -c '
import json
from pathlib import Path
import sys

session_id, session_name, source = sys.argv[1:]
markdown = sys.stdin.read() if source == "-" else Path(source).read_text(encoding="utf-8")
if not markdown.strip():
    raise SystemExit("deliver-round.sh: Markdown input must not be empty")
payload = {"session_id": session_id, "markdown": markdown}
if session_name:
    payload["session_name"] = session_name
print(json.dumps(payload, ensure_ascii=False))
' "$session_id" "$session_name" "$source")"
fi

base="$target"
[[ -n "$base" ]] || die "target must not be empty"
case "$base" in
  http://*|https://*) ;;
  *) base="http://$base" ;;
esac
url="${base%/}/api/rounds"

command -v curl >/dev/null 2>&1 || die "curl is required"
printf '%s' "$payload" |
  curl --fail-with-body --silent --show-error \
    --connect-timeout 5 --max-time 30 \
    --request POST "$url" \
    --header 'Content-Type: application/json' \
    --data-binary @-
