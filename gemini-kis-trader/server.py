"""Gemini CLI에 물리는 MCP 서버.

- 국내 시세/잔고/주문: python-kis (한국투자증권 모의투자)
- 글로벌 리서치: OpenBB (설치돼 있을 때만 활성화, yfinance 무료 provider 사용)
- 매매 일지: journal.jsonl — Gemini의 세션 간 기억

실행: python server.py  (Gemini CLI가 stdio로 띄운다 — 직접 실행할 일은 거의 없음)
"""

from datetime import timedelta

from mcp.server.mcpserver import MCPServer

import guardrails
import journal
from kis_client import get_kis

mcp = MCPServer("kis-trader")


# ── 조회 ──────────────────────────────────────────────────

@mcp.tool()
def get_quote(symbol: str) -> dict:
    """국내 주식 현재 시세를 조회한다. symbol은 6자리 종목코드 (예: 삼성전자 '005930')."""
    q = get_kis().stock(symbol).quote()
    return {
        "symbol": q.symbol,
        "name": q.name,
        "price": float(q.price),
        "change": float(q.change),
        "rate_pct": float(q.rate),
        "open": float(q.open),
        "high": float(q.high),
        "low": float(q.low),
        "volume": int(q.volume),
        "market_cap": float(q.market_cap) if q.market_cap else None,
        "sector": q.sector_name,
        "halted": q.halt,
    }


@mcp.tool()
def get_daily_chart(symbol: str, days: int = 30) -> list[dict]:
    """국내 주식의 최근 일봉을 조회한다 (최대 90일)."""
    days = min(days, 90)
    chart = get_kis().stock(symbol).daily_chart(start=timedelta(days=days))
    return [
        {
            "date": bar.time_kst.date().isoformat(),
            "open": float(bar.open),
            "high": float(bar.high),
            "low": float(bar.low),
            "close": float(bar.close),
            "volume": int(bar.volume),
        }
        for bar in chart.bars
    ]


@mcp.tool()
def get_portfolio() -> dict:
    """모의투자 계좌의 예수금, 보유 종목, 평가손익을 조회한다."""
    balance = get_kis().account().balance()
    return {
        "deposit_krw": float(balance.deposits["KRW"].amount) if "KRW" in balance.deposits else 0.0,
        "total_value": float(balance.total),
        "purchase_amount": float(balance.purchase_amount),
        "profit": float(balance.profit),
        "profit_rate_pct": float(balance.profit_rate),
        "holdings": [
            {
                "symbol": s.symbol,
                "name": s.name,
                "qty": float(s.qty),
                "avg_price": float(s.purchase_price),
                "current_price": float(s.price),
                "profit": float(s.profit),
                "profit_rate_pct": float(s.profit_rate),
            }
            for s in balance.stocks
        ],
    }


@mcp.tool()
def get_pending_orders() -> list[dict]:
    """아직 체결되지 않은 미체결 주문 목록을 조회한다."""
    pending = get_kis().account().pending_orders()
    return [
        {
            "symbol": o.symbol,
            "name": o.name,
            "type": o.type,
            "qty": float(o.qty),
            "executed_qty": float(o.executed_qty),
            "price": float(o.price) if o.price else None,
        }
        for o in pending.orders
    ]


# ── 주문 (가드레일 통과 시에만 실행) ──────────────────────

def _place_order(side: str, symbol: str, qty: int, price: float | None, reason: str) -> dict:
    stock = get_kis().stock(symbol)
    current = float(stock.quote().price)

    try:
        guardrails.check_order(symbol, qty, price, current)
    except guardrails.GuardrailViolation as e:
        journal.append("order_blocked", {"side": side, "symbol": symbol, "qty": qty,
                                         "price": price, "reason": reason, "blocked_by": str(e)})
        return {"status": "blocked", "message": str(e)}

    order = stock.buy(price=price, qty=qty) if side == "buy" else stock.sell(price=price, qty=qty)
    journal.append("order", {"side": side, "symbol": symbol, "name": stock.name, "qty": qty,
                             "price": price or "market", "current_price": current,
                             "order_no": str(order.number), "reason": reason})
    return {
        "status": "submitted",
        "side": side,
        "symbol": symbol,
        "qty": qty,
        "price": price or "market",
        "order_no": str(order.number),
    }


@mcp.tool()
def buy(symbol: str, qty: int, price: float | None = None, reason: str = "") -> dict:
    """국내 주식 매수 주문 (모의투자). price를 생략하면 시장가.
    reason에 이 주문을 내는 근거를 반드시 한 문장으로 적어라 — 일지에 기록된다."""
    return _place_order("buy", symbol, qty, price, reason)


@mcp.tool()
def sell(symbol: str, qty: int, price: float | None = None, reason: str = "") -> dict:
    """국내 주식 매도 주문 (모의투자). price를 생략하면 시장가.
    reason에 이 주문을 내는 근거를 반드시 한 문장으로 적어라 — 일지에 기록된다."""
    return _place_order("sell", symbol, qty, price, reason)


# ── 매매 일지 (세션 간 기억) ──────────────────────────────

@mcp.tool()
def read_journal(n: int = 30) -> list[dict]:
    """최근 매매 일지를 읽는다. 매 사이클 시작 시 가장 먼저 호출해서 과거 판단 맥락을 파악하라."""
    return journal.read_recent(n)


@mcp.tool()
def record_decision(summary: str) -> str:
    """이번 사이클의 판단 요약을 일지에 기록한다. 주문을 안 하기로 한 경우에도 반드시 호출하라."""
    journal.append("decision", {"summary": summary})
    return "recorded"


# ── 글로벌 리서치 (OpenBB, 선택 설치) ─────────────────────

@mcp.tool()
def get_us_quote(ticker: str) -> dict:
    """미국 주식/ETF/지수 시세를 조회한다 (OpenBB + yfinance, 무료).
    예: 'SPY', 'QQQ', 'NVDA'. 글로벌 시장 분위기 파악용."""
    try:
        from openbb import obb
    except ImportError:
        return {"error": "OpenBB가 설치되지 않았습니다. pip install openbb 후 다시 시도하세요."}
    result = obb.equity.price.quote(ticker, provider="yfinance").results[0]
    return {
        "ticker": ticker,
        "price": result.last_price,
        "change_pct": result.change_percent,
        "prev_close": result.prev_close,
    }


@mcp.tool()
def get_company_news(ticker: str, limit: int = 5) -> list[dict]:
    """미국 상장 기업 뉴스 헤드라인을 조회한다 (OpenBB + yfinance, 무료)."""
    try:
        from openbb import obb
    except ImportError:
        return [{"error": "OpenBB가 설치되지 않았습니다. pip install openbb 후 다시 시도하세요."}]
    results = obb.news.company(ticker, provider="yfinance", limit=limit).results
    return [{"date": str(r.date), "title": r.title, "url": r.url} for r in results[:limit]]


if __name__ == "__main__":
    mcp.run()  # stdio transport — Gemini CLI가 이 프로세스를 자식으로 띄운다
