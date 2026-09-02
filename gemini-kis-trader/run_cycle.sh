#!/usr/bin/env bash
# 매매 사이클 1회 실행: Gemini CLI를 비대화형으로 호출한다.
# --yolo: MCP 툴 호출을 자동 승인 (주문 안전장치는 guardrails.py가 담당)
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p logs
LOG="logs/cycle_$(date +%Y%m%d).log"
MODEL="${GEMINI_MODEL:-gemini-2.5-flash}"

{
  echo "===== cycle start: $(date '+%Y-%m-%d %H:%M:%S') (model: $MODEL) ====="
  gemini --yolo -m "$MODEL" -p "$(cat prompts/trade_cycle.md)"
  echo "===== cycle end: $(date '+%Y-%m-%d %H:%M:%S') ====="
} >> "$LOG" 2>&1
