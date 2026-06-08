// ===================================================================
//  서울 브레멘 사이트 설정
// ===================================================================
//  자세한 설치 방법은 같은 폴더의 SETUP.md 파일을 읽어주세요.
//
//  연동 방식은 두 가지입니다. 둘 다 서버가 필요 없습니다.
//
//  [A] 앱스 스크립트(추천) — 웹에서 추가/수정/삭제하면 구글 시트에 반영됨
//        SCRIPT_URL 에 배포된 웹앱 주소를 넣으세요.
//        EDIT_KEY 에 편집 비밀번호를 정해 넣으세요(앱스 스크립트와 동일하게).
//
//  [B] 공개 시트 읽기 전용 — 시트를 "웹에 게시"하고 SHEET_ID 만 넣으면
//        보기만 가능(웹에서 편집 불가). SCRIPT_URL 이 비어있을 때 사용됩니다.
//
//  둘 다 비워두면 같은 폴더의 data.json(데모 데이터)로 동작합니다.
// ===================================================================

window.SEOUL_BREMEN_CONFIG = {
  // [A] 앱스 스크립트 웹앱 주소 (예: https://script.google.com/macros/s/AKfy.../exec )
  SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzHKFwEGn7G1NSbgs_QzYP1fVirROFOZ5q8o_KmXViaJe6K65U2JiZUKLpAF7cPxUyppw/exec",

  // [A] 웹에서 편집할 때 입력할 비밀번호 (앱스 스크립트의 EDIT_KEY와 똑같이!)
  EDIT_KEY: "bremen0101",

  // [B] 공개 시트 읽기용 ID (앱스 스크립트를 쓰면 비워둬도 됩니다)
  SHEET_ID: "",

  // 탭(시트) 이름 — 구글 시트의 탭 이름과 똑같이 맞추세요.
  TABS: {
    rehearsals: "rehearsals",
    songs: "songs",
    photos: "photos",
    members: "members",
  },
};
