#!/usr/bin/env bash
set -euo pipefail

target="${ANSWER_BOARD_TARGET:-127.0.0.1:8787}"
session_id="${ANSWER_BOARD_SESSION_ID:-}"
session_name="${ANSWER_BOARD_SESSION_NAME:-}"
json_file=""
markdown_file=""
round_id=""

usage() {
  cat <<'USAGE'
Usage:
  deliver-round.sh [options] < round.md
  deliver-round.sh [options] --markdown-file <file>
  deliver-round.sh [options] --json-file <file>

Options:
  --target <host:port>      Override ANSWER_BOARD_TARGET for this delivery
  --session-id <id>         Stable grilling session ID (required for Markdown)
  --session-name <name>     Optional session display name
  --round-id <id>           Stable round ID (generated when omitted)
  --markdown-file <file>    Read grilling Markdown from a file; '-' means stdin
  --json-file <file>        Read a complete delivery JSON payload
  -h, --help                Show this help

Environment:
  ANSWER_BOARD_TARGET       Socket destination, default: 127.0.0.1:8787
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
    --round-id)
      (($# >= 2)) || die "--round-id requires a value"
      round_id="$2"
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
[[ -n "$session_id" || -n "$json_file" ]] || die "--session-id is required for Markdown input"
if command -v python3 >/dev/null 2>&1; then
  python_bin="python3"
elif command -v python >/dev/null 2>&1; then
  python_bin="python"
else
  die "python3 or python is required"
fi

temp_payload="$(mktemp)"
markdown_temp=""
cleanup() {
  rm -f "$temp_payload"
  [[ -z "$markdown_temp" ]] || rm -f "$markdown_temp"
}
trap cleanup EXIT

if [[ -n "$json_file" ]]; then
  [[ -r "$json_file" ]] || die "cannot read JSON file: $json_file"
  "$python_bin" - "$json_file" "$round_id" >"$temp_payload" <<'PY'
import json
import sys
import uuid
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if not isinstance(payload, dict):
    raise SystemExit("deliver-round.sh: JSON input must be an object")
payload.setdefault("type", "deliver")
payload.setdefault("protocol", 1)
payload.setdefault("round_id", sys.argv[2] or str(uuid.uuid4()))
print(json.dumps(payload, ensure_ascii=False))
PY
else
  source=""
  if [[ -n "$markdown_file" ]]; then
    source="$markdown_file"
  elif [[ ! -t 0 ]]; then
    source="-"
  else
    die "provide --markdown-file, --json-file, or Markdown on stdin"
  fi
  if [[ "$source" != "-" && ! -r "$source" ]]; then
    die "cannot read Markdown file: $source"
  fi
  if [[ "$source" == "-" ]]; then
    markdown_temp="$(mktemp)"
    "$python_bin" -c 'import pathlib, sys; pathlib.Path(sys.argv[1]).write_text(sys.stdin.read(), encoding="utf-8")' "$markdown_temp"
    source="$markdown_temp"
  fi
  [[ -n "$round_id" ]] || round_id="$("$python_bin" -c 'import uuid; print(uuid.uuid4())')"
  "$python_bin" - "$session_id" "$session_name" "$round_id" "$source" >"$temp_payload" <<'PY'
import json
import sys
from pathlib import Path

session_id, session_name, round_id, source = sys.argv[1:]
markdown = Path(source).read_text(encoding="utf-8")
if not markdown.strip():
    raise SystemExit("deliver-round.sh: Markdown input must not be empty")
payload = {
    "type": "deliver",
    "protocol": 1,
    "session_id": session_id,
    "round_id": round_id,
    "markdown": markdown,
}
if session_name:
    payload["session_name"] = session_name
print(json.dumps(payload, ensure_ascii=False))
PY
fi

ANSWER_BOARD_TARGET="$target" \
  "$python_bin" "$(dirname "$0")/socket-delivery.py" "$temp_payload"
