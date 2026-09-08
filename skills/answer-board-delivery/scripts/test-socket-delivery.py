#!/usr/bin/env python3
"""Regression test for delayed round_result delivery and result acknowledgement."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path


CLIENT = Path(__file__).with_name("socket-delivery.py")


def read_line(conn: socket.socket) -> dict:
    data = bytearray()
    while not data.endswith(b"\n"):
        chunk = conn.recv(4096)
        if not chunk:
            raise AssertionError("client closed before sending a complete JSON line")
        data.extend(chunk)
    return json.loads(data.decode("utf-8"))


def main() -> int:
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    server.settimeout(5)
    host, port = server.getsockname()
    state: dict[str, object] = {"deliveries": 0, "ack": None, "error": None}
    markdown = (
        "❓ **Q1** - ## 复杂问题\n\n"
        "- 第一项\n"
        "  - 嵌套项\n\n"
        "```text\n➡️ 代码里的标记\n```\n\n"
        "| 名称 | 值 |\n| --- | ---: |\n| A | 1 |\n\n"
        "➡️ **建议**\n\n1. 保留原始排版"
    )

    def serve() -> None:
        try:
            conn, _ = server.accept()
            with conn:
                delivery = read_line(conn)
                assert delivery["type"] == "deliver"
                assert delivery["markdown"] == markdown
                state["deliveries"] = int(state["deliveries"]) + 1
                ack = {
                    "type": "delivery_ack",
                    "protocol": 1,
                    "session_id": delivery["session_id"],
                    "round_id": delivery["round_id"],
                    "revision": 1,
                    "status": "accepted",
                }
                conn.sendall((json.dumps(ack) + "\n").encode("utf-8"))
                time.sleep(0.2)
                result = {
                    "type": "round_result",
                    "protocol": 1,
                    "session_id": delivery["session_id"],
                    "round_id": delivery["round_id"],
                    "revision": 1,
                    "status": "completed",
                    "answers": [{"number": 1, "text": "accepted", "answered": True}],
                }
                conn.sendall((json.dumps(result) + "\n").encode("utf-8"))
                state["ack"] = read_line(conn)
            server.settimeout(0.4)
            try:
                server.accept()
            except TimeoutError:
                return
            raise AssertionError("client opened a second connection for the same round")
        except Exception as error:  # pragma: no cover - reported by the parent thread
            state["error"] = error

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    payload = {
        "type": "deliver",
        "protocol": 1,
        "session_id": "delivery-regression",
        "round_id": "round-delayed-result",
        "markdown": markdown,
    }
    payload_fd, payload_name = tempfile.mkstemp(prefix="answer-board-", suffix=".json")
    os.close(payload_fd)
    payload_path = Path(payload_name)
    payload_path.write_text(json.dumps(payload), encoding="utf-8")
    started = time.monotonic()
    try:
        environment = dict(os.environ, ANSWER_BOARD_TARGET=f"{host}:{port}")
        completed = subprocess.run(
            [sys.executable, str(CLIENT), str(payload_path)],
            capture_output=True,
            text=True,
            env=environment,
            timeout=5,
            check=False,
        )
    finally:
        payload_path.unlink(missing_ok=True)
    thread.join(timeout=1)
    server.close()

    if state["error"] is not None:
        raise state["error"]  # type: ignore[misc]
    if completed.returncode != 0:
        raise AssertionError(
            f"client exited {completed.returncode}: {completed.stdout}\n{completed.stderr}"
        )
    output = json.loads(completed.stdout.strip())
    assert output["type"] == "round_result"
    assert output["status"] == "completed"
    assert output["answers"][0]["text"] == "accepted"
    assert state["deliveries"] == 1
    assert state["ack"] == {"type": "result_ack", "round_id": payload["round_id"]}
    assert (time.monotonic() - started) < 5
    print("socket-delivery delayed-result regression: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
