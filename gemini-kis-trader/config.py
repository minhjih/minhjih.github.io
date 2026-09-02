"""환경변수 로드 + 가드레일 설정.

모든 값은 .env 파일에서 읽는다. .env는 절대 git에 커밋하지 않는다.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

# ── KIS 인증 ──────────────────────────────────────────────
# 실전 앱키도 필요하다: python-kis는 모의투자 모드에서도
# 시세 조회는 실전 도메인을 쓴다 (모의 도메인은 시세 API가 제한적).
KIS_ID = os.environ["KIS_ID"]                      # HTS(한국투자) 로그인 ID
KIS_ACCOUNT = os.environ["KIS_ACCOUNT"]            # 모의투자 계좌번호 "12345678-01"
KIS_APPKEY = os.environ["KIS_APPKEY"]              # 실전 앱키 (시세용)
KIS_SECRETKEY = os.environ["KIS_SECRETKEY"]        # 실전 시크릿
KIS_VIRTUAL_APPKEY = os.environ["KIS_VIRTUAL_APPKEY"]      # 모의투자 앱키 (주문용)
KIS_VIRTUAL_SECRETKEY = os.environ["KIS_VIRTUAL_SECRETKEY"]  # 모의투자 시크릿

# ── 가드레일 (LLM이 아니라 코드 레벨에서 강제) ─────────────
MAX_ORDER_KRW = int(os.environ.get("MAX_ORDER_KRW", "500000"))       # 1회 주문 금액 상한
MAX_QTY_PER_ORDER = int(os.environ.get("MAX_QTY_PER_ORDER", "10"))   # 1회 주문 수량 상한
MAX_ORDERS_PER_DAY = int(os.environ.get("MAX_ORDERS_PER_DAY", "10"))  # 일일 주문 횟수 상한

# 비워두면 전 종목 허용. "005930,000660" 처럼 쉼표로 제한 가능.
SYMBOL_WHITELIST = [
    s.strip() for s in os.environ.get("SYMBOL_WHITELIST", "").split(",") if s.strip()
]

# ── 파일 경로 ─────────────────────────────────────────────
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
JOURNAL_PATH = DATA_DIR / "journal.jsonl"
