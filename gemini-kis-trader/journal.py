"""매매 일지 (JSONL append-only).

Gemini CLI는 매 사이클이 독립 세션이라 과거 맥락을 기억하지 못한다.
판단·주문을 전부 여기 기록하고, 매 사이클 시작 시 읽게 해서 맥락을 잇는다.
"""

import json
from datetime import datetime, timezone, timedelta

from config import JOURNAL_PATH

KST = timezone(timedelta(hours=9))


def append(kind: str, payload: dict) -> None:
    entry = {"time": datetime.now(KST).isoformat(timespec="seconds"), "kind": kind, **payload}
    with open(JOURNAL_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")


def read_recent(n: int = 30) -> list[dict]:
    if not JOURNAL_PATH.exists():
        return []
    with open(JOURNAL_PATH, encoding="utf-8") as f:
        lines = f.readlines()
    return [json.loads(line) for line in lines[-n:]]


def orders_today() -> int:
    """오늘(KST) 실행된 주문 수 — 일일 주문 한도 가드레일에 사용."""
    today = datetime.now(KST).date().isoformat()
    return sum(
        1
        for e in read_recent(1000)
        if e["kind"] == "order" and e["time"].startswith(today)
    )
