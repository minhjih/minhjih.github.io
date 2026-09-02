#!/usr/bin/env bash
# tmux 안에서 돌리는 메인 루프.
# 장중(KST 평일 09:00~15:30)에만 사이클을 실행하고, 그 외에는 대기한다.
#
# 실행:  tmux new -s trader
#        caffeinate -i ./loop.sh     # caffeinate: Mac이 잠들지 않게
set -uo pipefail
cd "$(dirname "$0")"

INTERVAL="${CYCLE_INTERVAL_SEC:-900}"   # 기본 15분. Gemini CLI 무료 한도를 고려해 너무 짧게 잡지 말 것.

is_market_open() {
  local dow hm
  dow=$(TZ=Asia/Seoul date +%u)    # 1(월)~7(일)
  hm=$(TZ=Asia/Seoul date +%H%M)
  [[ "$dow" -le 5 && "$hm" -ge 0900 && "$hm" -le 1530 ]]
}

echo "[loop] 시작. 주기: ${INTERVAL}s (Ctrl+C로 종료)"
while true; do
  if is_market_open; then
    echo "[loop] $(TZ=Asia/Seoul date '+%H:%M') 사이클 실행"
    ./run_cycle.sh || echo "[loop] 사이클 실패 (logs/ 확인). 다음 주기에 재시도."
  else
    echo "[loop] $(TZ=Asia/Seoul date '+%m/%d %H:%M') 장 외 시간 — 대기"
  fi
  sleep "$INTERVAL"
done
