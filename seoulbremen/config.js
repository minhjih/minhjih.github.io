// ===================================================================
//  서울 브레멘 사이트 설정
// ===================================================================
//  데이터(합주/연습곡/멤버/투표/댓글)는 Supabase(Postgres)에 저장합니다.
//  사진은 구글 드라이브 폴더 + 앱스 스크립트로 처리합니다.
//  자세한 설치 방법은 SETUP.md 참고.
// ===================================================================

window.SEOUL_BREMEN_CONFIG = {
  // ----- Supabase (데이터 저장소) -----
  // 대시보드 → Project Settings → API
  SUPABASE_URL: "https://gppwawgyoysctikujmed.supabase.co",
  //  ↓ "anon" "public" 키를 붙여넣으세요 (브라우저 노출 OK, RLS로 보호).
  //    ⚠️ service_role 키는 절대 넣지 마세요!
  SUPABASE_ANON_KEY: "",

  // 관리자 편집 비밀번호 (합주/연습곡/멤버/후보 추가·수정·삭제 시 화면에서 입력)
  EDIT_KEY: "bremen0101",

  // ----- 사진 (구글 드라이브) -----
  // 사진 업로드 비밀번호 (앱스 스크립트의 UPLOAD_KEY와 동일하게)
  UPLOAD_KEY: "bremen0101",
  // 사진 전용 앱스 스크립트 웹앱 주소 (/exec). 사진 목록/업로드/삭제에만 사용.
  SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwZKbr67XQypZieBQq8K9Ox4Vnfn0JNhiPxSsS-bALJorwqsr-fAuverT9vo58MYYjVVQ/exec",
  // 사진 공유 드라이브 폴더 ID — 갤러리에 "드라이브 폴더" 바로가기 표시용
  DRIVE_FOLDER_ID: "11oWl1JSrWjNeJeUeFvaKu_Q1eG792Vjk",
};
