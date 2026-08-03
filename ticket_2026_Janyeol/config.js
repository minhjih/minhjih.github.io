// ===================================================================
//  자열 (自熱) 공연 티켓 — 사이트 설정
//  주소: https://minhjih.github.io/ticket_2026_Janyeol/
//  자세한 설치/운영은 SETUP.md 참고.
// ===================================================================
window.JANYEOL_CONFIG = {
  // ----- Supabase (데이터/인증) -----
  SUPABASE_URL: "https://gppwawgyoysctikujmed.supabase.co",
  // anon(public) 키 — 브라우저 노출 OK (RLS로 보호)
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwcHdhd2d5b3lzY3Rpa3VqbWVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NzUyMjQsImV4cCI6MjA5NjU1MTIyNH0.l-MEqQwjCzOnPkmI90-eYydEYgGTdhg_-J5vVX4glXQ",
  // 관리자/확인자 백엔드 (엣지 함수 이름) — 비밀번호는 Supabase DB(tk_config)에만 저장
  DESK_FUNCTION: "janyeol-desk",

  // ----- 공연 정보 -----
  EVENT: {
    title: "자열",
    subtitle: "自熱",
    dateLabel: "8.29 (금) 5:30PM",
    venue: "001 라이브홀",
    address: "서울 마포구 월드컵로 140 지하1층",
    price: 7000,
    maxQuantity: 6, // 1주문 최대 매수
  },

  // ----- 결제 안내 -----
  // 계좌이체
  BANK: {
    bank: "○○은행",
    account: "000-0000-0000-00",
    holder: "예금주명",
  },
  // 카카오페이 송금 (link 를 넣으면 버튼, qrImage 파일이 있으면 QR 이미지로 표시)
  KAKAO: {
    link: "", // 예: https://qr.kakaopay.com/xxxxxxxx
    qrImage: "img/kakaopay.png",
  },

  // ----- 포스터 이미지 (img/ 폴더에 넣기) -----
  POSTER: {
    main: "img/poster-main.jpg", // 메인 포스터
    cue: "img/poster-cue.jpg", // 큐시트(타임테이블) 이미지
  },

  // ----- 큐시트(타임테이블) — 포스터가 안 떠도 보이도록 텍스트로도 표시 -----
  TIMETABLE: [
    {
      time: "17:30",
      band: "RIZZ",
      meta: "8 songs · 1h",
      songs: [
        ["쏜애플", "한낮"],
        ["알라리깡송", "게인주의"],
        ["정우", "클라우드 쿠쿠 랜드"],
        ["신인류", "정면돌파"],
        ["SURL", "DETOX"],
        ["넬", "기생충"],
        ["지소쿠리클럽", "work, shit, sleep"],
        ["유다빈밴드", "축배"],
      ],
    },
    {
      time: "18:30",
      band: "심사숙곰",
      meta: "5 songs · 45m",
      songs: [
        ["브로큰 발렌타인", "알루미늄"],
        ["한로로", "입춘"],
        ["정우", "클라우드 쿠쿠 랜드"],
        ["혁오", "TOMBOY"],
        ["극동아시아타이거즈", "비냄새"],
      ],
    },
    {
      time: "19:15",
      band: "브레멘",
      meta: "10 songs · 1h 15m",
      songs: [
        ["아지캉", "センスレス"],
        ["wave to earth", "bad."],
        ["검정치마", "섬 (Queen of Diamonds)"],
        ["서태지와 아이들", "시대유감"],
        ["ヨルシカ", "春泥棒"],
        ["검정치마", "Antifreeze"],
        ["쏜애플", "아지랑이"],
        ["X JAPAN", "Endless Rain"],
        ["MCR", "The End. + Dead!"],
        ["초록불꽃소년단", "그저 귀여운 츠보미였는걸"],
      ],
    },
  ],
};
