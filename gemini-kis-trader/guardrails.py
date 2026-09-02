"""주문 가드레일 — Gemini 프롬프트가 아니라 파이썬 코드에서 강제한다.

LLM이 무슨 판단을 하든, 여기서 걸리면 주문은 나가지 않는다.
"""

import config
import journal


class GuardrailViolation(Exception):
    pass


def check_order(symbol: str, qty: int, price: float | None, current_price: float) -> None:
    """주문 실행 전 호출. 위반 시 GuardrailViolation을 던진다."""
    if config.SYMBOL_WHITELIST and symbol not in config.SYMBOL_WHITELIST:
        raise GuardrailViolation(
            f"{symbol}은(는) 허용 종목 목록에 없습니다. 허용: {config.SYMBOL_WHITELIST}"
        )

    if qty <= 0:
        raise GuardrailViolation("수량은 1 이상이어야 합니다.")

    if qty > config.MAX_QTY_PER_ORDER:
        raise GuardrailViolation(
            f"1회 주문 수량 한도 초과: {qty} > {config.MAX_QTY_PER_ORDER}"
        )

    est_amount = (price or current_price) * qty
    if est_amount > config.MAX_ORDER_KRW:
        raise GuardrailViolation(
            f"1회 주문 금액 한도 초과: 약 {est_amount:,.0f}원 > {config.MAX_ORDER_KRW:,}원"
        )

    if journal.orders_today() >= config.MAX_ORDERS_PER_DAY:
        raise GuardrailViolation(
            f"일일 주문 횟수 한도({config.MAX_ORDERS_PER_DAY}회)에 도달했습니다. 오늘은 더 주문할 수 없습니다."
        )
