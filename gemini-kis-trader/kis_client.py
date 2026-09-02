"""python-kis 클라이언트 (모의투자 전용).

virtual_appkey/virtual_secretkey를 넘기면 PyKis가 모의투자 모드로 동작한다.
주문은 모의 도메인으로, 시세 조회는 실전 도메인으로 나간다.
실전투자로 바꾸려면 이 파일을 의도적으로 고쳐야 하는 구조다 — 그게 의도다.
"""

from functools import lru_cache

from pykis import PyKis

import config


@lru_cache(maxsize=1)
def get_kis() -> PyKis:
    return PyKis(
        id=config.KIS_ID,
        account=config.KIS_ACCOUNT,
        appkey=config.KIS_APPKEY,
        secretkey=config.KIS_SECRETKEY,
        virtual_id=config.KIS_ID,
        virtual_appkey=config.KIS_VIRTUAL_APPKEY,
        virtual_secretkey=config.KIS_VIRTUAL_SECRETKEY,
        keep_token=True,  # 접근토큰(24h)을 파일로 캐시해 재발급 낭비 방지
    )
