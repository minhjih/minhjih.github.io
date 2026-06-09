# 서울 브레멘 사이트 설정 가이드 🎵

주소: `https://minhjih.github.io/seoulbremen/`

- **데이터**(합주 일정 · 연습곡 · 멤버 · 일정 투표 · 댓글) → **Supabase**(Postgres) 에 저장
- **사진** → **구글 드라이브** 공유 폴더 + 앱스 스크립트
- **편집 보호** → 화면에서 비밀번호 입력(공유 비밀번호 방식)

Supabase 설정 전에는 데모 데이터(`data.json`)로 동작합니다.

---

## 1단계. Supabase 프로젝트 & 테이블 만들기

1. [supabase.com](https://supabase.com) 에서 프로젝트를 만듭니다. (이미 만드셨다면 그대로)
2. 좌측 메뉴 **SQL Editor** → 이 폴더의 **`supabase-setup.sql`** 내용을 전부 붙여넣고 **RUN**.
   - 테이블 6개(`rehearsals`, `songs`, `members`, `poll`, `votes`, `comments`)와
     RLS 정책(익명 키로 읽기/쓰기 허용)이 한 번에 생성됩니다.

> 보안 메모: 지금은 "공유 비밀번호(간단)" 방식이라 익명 키로 누구나 DB에 쓸 수 있고,
> 편집 보호는 사이트의 비밀번호 UI로만 합니다. 더 강한 보안이 필요하면 Supabase Auth
> 로그인 방식으로 정책을 바꿀 수 있어요(말씀해 주세요).

---

## 2단계. 사이트에 Supabase 연결 (`config.js`)

Supabase 대시보드 → **Project Settings → API** 에서:

- **Project URL** → `SUPABASE_URL`
- **Project API keys → `anon` `public`** → `SUPABASE_ANON_KEY`
  - ⚠️ `service_role` 키는 절대 넣지 마세요! (anon 키만)

```js
window.SEOUL_BREMEN_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGci...(anon public 키)",
  EDIT_KEY: "관리자-편집-비밀번호",
  // 사진(구글 드라이브)용 — 아래 3단계
  UPLOAD_KEY: "사진-업로드-비밀번호",
  SCRIPT_URL: "https://script.google.com/macros/s/.../exec",
  DRIVE_FOLDER_ID: "드라이브폴더ID",
};
```

저장하고 깃허브에 푸시(머지)하면 데이터가 Supabase에서 로드됩니다.

---

## 3단계. 사진 (구글 드라이브)

사진은 기존 방식 그대로 구글 드라이브 폴더 + 앱스 스크립트를 씁니다.

1. 드라이브에 사진 폴더 1개 → **"링크 있는 모든 사용자 - 뷰어"** 공유
2. 그 폴더가 있는 계정에서 [확장 프로그램]→[Apps Script]에 **`apps-script.gs`** 붙여넣기
   - 맨 위 `PHOTOS_FOLDER_ID`, `UPLOAD_KEY` 채우기
3. **웹 앱**으로 배포(액세스: 모든 사용자) → `/exec` 주소를 `config.js`의 `SCRIPT_URL`에
4. 폴더 ID는 `DRIVE_FOLDER_ID`에

> 앱스 스크립트는 이제 **사진 목록/업로드/삭제에만** 쓰입니다. (합주/투표 등 데이터는 Supabase)
> 사진이 필요 없으면 `SCRIPT_URL`을 비워도 됩니다(사진 섹션만 비활성).

---

## 사용법

- 우측 상단 **관리** → `EDIT_KEY` 입력 → 합주/연습곡/멤버/투표 후보 추가·수정·삭제
- **일정 투표**: 관리자가 "후보 날짜 편집"으로 달력에서 후보를 고른 뒤 **💾 저장**.
  멤버는 후보 날짜를 눌러 투표(이름은 브라우저에 기억). 특이사항은 댓글로.
- **사진**: "📸 사진 올리기"(업로드 비밀번호) 또는 드라이브 폴더에 직접 업로드

## 자주 묻는 질문

- **데모 데이터만 보여요 / 상단에 빨간 배너** → `SUPABASE_URL`·`SUPABASE_ANON_KEY` 가 맞는지,
  `supabase-setup.sql` 을 실행했는지 확인하세요. 배너에 원인 메시지가 표시됩니다.
- **편집/투표가 저장 안 돼요** → RLS 정책이 적용됐는지(=SQL 실행), anon 키가 맞는지 확인.
- **사진이 안 보여요** → 드라이브 폴더 공유가 "링크 있는 모든 사용자", `SCRIPT_URL`/`PHOTOS_FOLDER_ID` 확인.

---

## 파일 구조

```
seoulbremen/
├─ index.html           사이트 페이지
├─ styles.css           디자인
├─ app.js               데이터 로딩/렌더링/편집 (Supabase + 드라이브 사진)
├─ config.js            ← Supabase URL/키, 비밀번호, 사진 설정
├─ supabase-setup.sql   ← Supabase SQL Editor에 붙여넣을 스키마/권한
├─ apps-script.gs       사진(드라이브)용 백엔드
├─ data.json            데모(기본) 데이터
└─ photos/              (선택) 직접 올릴 사진 폴더
```
