#!/usr/bin/env bash
# Answer Board 启动包装脚本
# 用法: bash ask.sh --questions <path> [--answers <path>]
# - 自动挑选空闲端口
# - 启动 board.mjs（前台，继承 stdio）
# - 等待用户提交（服务自动退出）
# - 打印答案文件路径和内容
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOARD_MJS="$SCRIPT_DIR/board.mjs"

# Defaults
QUESTIONS=""
ANSWERS=""

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --questions)
      QUESTIONS="$2"
      shift 2
      ;;
    --answers)
      ANSWERS="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 --questions <path> [--answers <path>]"
      echo ""
      echo "启动 answer-board 一次性问答服务。自动挑选空闲端口，启动 board.mjs，"
      echo "等待用户提交后打印答案。"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$QUESTIONS" ]]; then
  echo "Error: --questions is required" >&2
  exit 2
fi

if [[ ! -f "$QUESTIONS" ]]; then
  echo "Error: questions file not found: $QUESTIONS" >&2
  exit 2
fi

if [[ -z "$ANSWERS" ]]; then
  ANSWERS="${QUESTIONS%.json}.answers.json"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required but not found in PATH" >&2
  exit 2
fi

# Find a free port using Node's net module
PORT=$(node -e "const net=require('net'); const s=net.createServer(); s.listen(0, '0.0.0.0', () => { console.log(s.address().port); s.close(); });" 2>/dev/null)

if [[ -z "$PORT" ]]; then
  echo "Error: failed to find a free port" >&2
  exit 1
fi

echo "Using port: $PORT" >&2

# Run the board server (foreground, inheriting stdio)
node "$BOARD_MJS" "$QUESTIONS" "$ANSWERS" "$PORT"
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "Error: board server exited with code $EXIT_CODE" >&2
  exit $EXIT_CODE
fi

# Print answers
if [[ -f "$ANSWERS" ]]; then
  echo "---ANSWERS_FILE---"
  echo "$ANSWERS"
  echo "---ANSWERS---"
  cat "$ANSWERS"
else
  echo "Error: answers file not found: $ANSWERS" >&2
  exit 1
fi
