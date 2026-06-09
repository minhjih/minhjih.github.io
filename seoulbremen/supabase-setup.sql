-- ===================================================================
--  서울 브레멘 - Supabase 스키마 & 권한
--  Supabase 대시보드 → SQL Editor 에 붙여넣고 RUN 하세요. (한 번만)
-- ===================================================================

-- 1) 테이블 (모든 데이터 컬럼은 text 로 단순화 — 앱에서 파싱)
create table if not exists rehearsals (
  id bigint generated always as identity primary key,
  date text, time text, location text, address text,
  songs text, attendees text, cost text, notes text,
  created_at timestamptz default now()
);

create table if not exists songs (
  id bigint generated always as identity primary key,
  title text, artist text, status text, key text, link text, notes text,
  created_at timestamptz default now()
);

create table if not exists members (
  id bigint generated always as identity primary key,
  name text, part text, joined text,
  created_at timestamptz default now()
);

-- 일정 투표 후보 날짜
create table if not exists poll (
  id bigint generated always as identity primary key,
  date text,
  created_at timestamptz default now()
);

-- 투표 기록 (option = 후보 날짜 'YYYY-MM-DD', name = 투표자)
create table if not exists votes (
  id bigint generated always as identity primary key,
  option text, name text,
  created_at timestamptz default now()
);

-- 투표 특이사항 댓글
create table if not exists comments (
  id bigint generated always as identity primary key,
  name text, comment text, time text,
  created_at timestamptz default now()
);

-- 2) RLS (행 수준 보안) 켜기
alter table rehearsals enable row level security;
alter table songs      enable row level security;
alter table members    enable row level security;
alter table poll       enable row level security;
alter table votes      enable row level security;
alter table comments   enable row level security;

-- 3) 정책: '공유 비밀번호(간단)' 방식 — 익명(anon) 키로 읽기/쓰기 모두 허용.
--    (편집 보호는 사이트의 비밀번호 UI로만 처리합니다. 진짜 DB 보안이 필요하면
--     Supabase Auth 로그인 방식으로 정책을 바꾸면 됩니다.)
do $$
declare t text;
begin
  foreach t in array array['rehearsals','songs','members','poll','votes','comments'] loop
    execute format('drop policy if exists "public_all" on public.%I;', t);
    execute format('create policy "public_all" on public.%I for all to anon, authenticated using (true) with check (true);', t);
  end loop;
end $$;
