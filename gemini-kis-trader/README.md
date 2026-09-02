# gemini-kis-trader

Gemini CLI(무료) + MCP + 한국투자증권 **모의투자** 자동매매 스켈레톤.
Mac mini에서 tmux로 상시 실행하는 구성이다.

```
tmux (loop.sh, 15분 주기)
 └─ run_cycle.sh
     └─ gemini --yolo -p "매매 사이클 프롬프트"     ← Google 계정 무료 한도
         └─ MCP: server.py
             ├─ python-kis  → KIS 모의투자 (시세·잔고·주문)
             ├─ OpenBB      → 글로벌 리서치 (yfinance, 무료)
             └─ journal     → data/journal.jsonl (세션 간 기억)
```

API 키 과금 없음: Gemini CLI는 Google 계정 로그인 무료 한도로 동작하고,
KIS 모의투자·OpenBB(yfinance)도 무료다.

## 1. 사전 준비 (Mac mini)

```bash
# Python 3.11+ / Node 20+ / tmux
brew install python@3.12 node tmux

# Gemini CLI 설치 후 첫 실행에서 Google 계정 로그인
npm install -g @google/gemini-cli
gemini
```

KIS 쪽 준비 (https://apiportal.koreainvestment.com):

1. 한국투자증권 계좌 개설 후 **모의투자 신청**
2. KIS Developers에서 앱키 발급 — **실전용과 모의투자용 둘 다** 필요하다.
   python-kis는 모의투자 모드에서도 시세 조회는 실전 도메인을 쓰기 때문.

## 2. 설치

```bash
cd gemini-kis-trader
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt   # openbb 포함이라 몇 분 걸림

cp .env.example .env
# .env 열어서 KIS ID/계좌/앱키 채우기 (절대 커밋 금지)
```

MCP 서버를 Gemini CLI에 등록 — 이 폴더 안에 프로젝트 설정으로 만든다:

```bash
mkdir -p .gemini
cp gemini-settings.example.json .gemini/settings.json
# settings.json 열어서 "/절대경로" 두 곳을 실제 경로로 수정
```

동작 확인:

```bash
gemini   # 이 폴더에서 실행
> /mcp                          # kis-trader 서버와 툴 목록이 보이면 성공
> 삼성전자 현재가 알려줘         # get_quote가 호출되면 연동 완료
```

## 3. 실행

```bash
chmod +x run_cycle.sh loop.sh

./run_cycle.sh                  # 1회 사이클 수동 테스트 (logs/ 확인)

tmux new -s trader
caffeinate -i ./loop.sh         # caffeinate: Mac mini 잠자기 방지
# Ctrl+b, d 로 detach / tmux attach -t trader 로 복귀
```

루프는 KST 평일 09:00~15:30에만 사이클을 실행한다.
주기는 `.env`의 `CYCLE_INTERVAL_SEC`(기본 900초)로 조절한다 —
Gemini CLI 무료 한도(일일 요청 제한)가 있으니 너무 짧게 잡지 말 것.

## 4. 안전장치 (중요)

`--yolo`는 Gemini의 툴 호출을 전부 자동 승인한다. 그래서 안전장치는
프롬프트가 아니라 **파이썬 코드에 있다**:

- `guardrails.py` — 1회 주문 금액/수량 상한, 일일 주문 횟수 상한,
  종목 화이트리스트. 위반 주문은 API에 도달하기 전에 차단된다.
- `kis_client.py` — 모의투자 키로만 초기화. 실전 전환은 코드를
  의도적으로 고쳐야만 가능한 구조다.
- `data/journal.jsonl` — 모든 판단·주문·차단 기록. Gemini가 매 사이클
  시작 시 읽는 "기억"이자 사후 감사 로그다.

전략(관심 종목, 원칙)은 `prompts/trade_cycle.md`에서 수정한다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `server.py` | MCP 서버 (툴 정의) |
| `kis_client.py` | python-kis 초기화 (모의투자 고정) |
| `guardrails.py` | 주문 가드레일 |
| `journal.py` | 매매 일지 (JSONL) |
| `config.py` | .env 로드 |
| `prompts/trade_cycle.md` | 매 사이클 프롬프트 (= 전략) |
| `run_cycle.sh` / `loop.sh` | 1회 실행 / tmux 루프 |

## 주의

- 모의투자 검증 없이 실전으로 바꾸지 말 것. 이 스켈레톤은 학습·실험용이다.
- `.env`, `data/`, `logs/`는 gitignore 대상 — 앱키가 공개 레포에 올라가지 않게 유의.
- python-kis 2.1.x 기준으로 작성됨. 라이브러리 업데이트 시 API 변경 확인:
  https://github.com/Soju06/python-kis
