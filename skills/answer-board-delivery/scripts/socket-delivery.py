#!/usr/bin/env python3
"""Send one Answer Board round over a newline-delimited JSON TCP socket."""

from __future__ import annotations

import json
import socket
import sys
import time
import uuid
from pathlib import Path
from typing import Any


PROTOCOL = 1
RECONNECT_DELAY = 2.0


def parse_target(raw: str) -> tuple[str, int]:
    target = raw.strip()
    for prefix in ("tcp://", "http://", "https://"):
        if target.startswith(prefix):
            target = target[len(prefix) :]
            break
    target = target.split("/", 1)[0]
    if ":" not in target:
        raise ValueError("target must be host:port")
    host, port = target.rsplit(":", 1)
    if not host or not port.isdigit():
        raise ValueError("target must be host:port")
    return host, int(port)


def read_payload(args: list[str]) -> dict[str, Any]:
    if len(args) != 1:
        raise ValueError("socket-delivery.py expects one JSON payload file")
    payload = json.loads(Path(args[0]).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("delivery payload must be a JSON object")
    payload.setdefault("type", "deliver")
    payload.setdefault("protocol", PROTOCOL)
    payload.setdefault("round_id", str(uuid.uuid4()))
    return payload


def send_message(sock: socket.socket, message: dict[str, Any]) -> None:
    encoded = (json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n").encode(
        "utf-8"
    )
    sock.sendall(encoded)


def run(payload: dict[str, Any], target: str) -> int:
    host, port = parse_target(target)
    revision: int | None = None
    interrupted = False

    while True:
        sock: socket.socket | None = None
        reader = None
        try:
            sock = socket.create_connection((host, port), timeout=5)
            sock.settimeout(None)
            reader = sock.makefile("r", encoding="utf-8", newline="\n")
            send_message(sock, payload)
            while True:
                line = reader.readline()
                if not line:
                    raise ConnectionError("Answer Board socket closed")
                message = json.loads(line)
                kind = message.get("type")
                if kind == "ping":
                    send_message(sock, {"type": "pong"})
                elif kind == "delivery_ack":
                    revision = message.get("revision")
                    if message.get("status") == "busy":
                        raise RuntimeError(message.get("message", "round is busy"))
                elif kind == "round_result":
                    send_message(sock, {"type": "result_ack", "round_id": payload["round_id"]})
                    print(
                        json.dumps(message, ensure_ascii=False, separators=(",", ":")),
                        flush=True,
                    )
                    return 0
                elif kind == "error":
                    raise RuntimeError(message.get("message", "Answer Board rejected delivery"))
        except KeyboardInterrupt:
            interrupted = True
            if sock is not None and revision is not None:
                try:
                    send_message(
                        sock,
                        {
                            "type": "cancel",
                            "session_id": payload.get("session_id", ""),
                            "round_id": payload["round_id"],
                            "revision": revision,
                        },
                    )
                except OSError:
                    pass
            return 130
        except RuntimeError as error:
            print(f"socket-delivery.py: {error}", file=sys.stderr)
            return 2
        except (ConnectionError, OSError, json.JSONDecodeError) as error:
            if interrupted:
                return 130
            print(f"socket-delivery.py: connection lost ({error}); retrying", file=sys.stderr)
            time.sleep(RECONNECT_DELAY)
        finally:
            if reader is not None:
                reader.close()
            if sock is not None:
                sock.close()


def main() -> int:
    try:
        payload = read_payload(sys.argv[1:])
        target = __import__("os").environ.get("ANSWER_BOARD_TARGET", "127.0.0.1:8787")
        return run(payload, target)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"socket-delivery.py: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
