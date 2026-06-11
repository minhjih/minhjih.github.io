// ===================================================================
//  서울 브레멘 - 데이터 로딩 / 렌더링 / 편집
//  데이터: Supabase(Postgres REST) — 합주/연습곡/멤버/투표/댓글
//  사진:   구글 드라이브 + 앱스 스크립트(SCRIPT_URL)
//  Supabase 미설정 시 data.json(데모)로 동작
// ===================================================================

const CFG = window.SEOUL_BREMEN_CONFIG || {};
const TABS = { rehearsals: "rehearsals", songs: "songs", photos: "photos", members: "members" };
const SB = { url: (CFG.SUPABASE_URL || "").replace(/\/$/, ""), key: CFG.SUPABASE_ANON_KEY || "" };
const SB_READY = !!(SB.url && SB.key);

const CLUB_DEFAULT = {
  name: "서울 브레멘",
  tagline: "함께 모여 소리를 내는 사람들",
  description:
    "서울 브레멘은 합주를 사랑하는 사람들이 모인 음악 동아리입니다. 매주 모여 함께 연습하고, 무대를 만들고, 그 순간들을 기록합니다.",
};

let STATE = { rehearsals: [], songs: [], photos: [], members: [], poll: [], votes: [], comments: [] };
let IS_ADMIN = false;

// ---------------- 유틸 ----------------

function splitList(str) {
  if (!str) return [];
  return String(str).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

function driveImageUrl(link, size = "w1200") {
  if (!link) return "";
  const s = String(link).trim();
  let id = "";
  let m = s.match(/\/file\/d\/([^/]+)/);
  if (m) id = m[1];
  if (!id) { m = s.match(/[?&]id=([^&]+)/); if (m) id = m[1]; }
  if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=${size}`;
  return s;
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function initials(name) { return name ? name.trim().slice(-2) : "?"; }

// "40,000원", "40000", 40000 → 숫자 40000 (없으면 0)
function parseCost(v) {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

function won(n) {
  return Math.round(n).toLocaleString("ko-KR") + "원";
}

// 선택 가능한 1시간 단위 시간대 (09:00 ~ 24:00)
const TIME_SLOTS = (() => {
  const pad = (h) => String(h).padStart(2, "0");
  const arr = [];
  for (let h = 9; h <= 23; h++) arr.push(`${pad(h)}:00-${pad(h + 1)}:00`);
  return arr;
})();

// 저장된 시간 문자열 → 슬롯 배열
function parseSlots(str) {
  if (!str) return [];
  return String(str)
    .split(",")
    .map((s) => s.replace(/\s/g, ""))
    .filter(Boolean);
}

// 연속된 슬롯을 범위로 합쳐서 보기 좋게 ("14:00-15:00,15:00-16:00" → "14:00 - 16:00")
function formatTime(str) {
  const slots = parseSlots(str)
    .map((s) => {
      const m = s.match(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
      return m ? { start: m[1], end: m[2] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!slots.length) return str || "";
  const ranges = [];
  let cur = { ...slots[0] };
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].start === cur.end) cur.end = slots[i].end;
    else { ranges.push(cur); cur = { ...slots[i] }; }
  }
  ranges.push(cur);
  return ranges.map((r) => `${r.start} - ${r.end}`).join(", ");
}

function fmtDate(dateStr) {
  if (!dateStr) return { d: "?", m: "" };
  const dt = new Date(dateStr);
  if (isNaN(dt)) return { d: String(dateStr), m: "" };
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return { d: String(dt.getDate()), m: `${months[dt.getMonth()]} ${dt.getFullYear()}` };
}

// 어떤 날짜 표현이든 'YYYY-MM-DD' 로 정규화 (달력 키와 매칭용)
function ymd(v) {
  if (!v) return "";
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const dt = new Date(s);
  if (!isNaN(dt)) {
    const p = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  }
  return s;
}

function isUpcoming(dateStr) {
  const dt = new Date(dateStr);
  if (isNaN(dt)) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return dt >= today;
}

// ---------------- Supabase REST 헬퍼 ----------------

function sbHeaders(extra) {
  return Object.assign(
    { apikey: SB.key, Authorization: "Bearer " + SB.key, "Content-Type": "application/json" },
    extra || {}
  );
}
async function sbErr(res) {
  try { const j = await res.json(); return j.message || j.hint || j.error || ("HTTP " + res.status); }
  catch (e) { return "HTTP " + res.status; }
}
async function sbSelect(table) {
  const res = await fetch(`${SB.url}/rest/v1/${table}?select=*`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`${table} 읽기 실패: ${await sbErr(res)}`);
  return res.json();
}
async function sbInsert(table, body) {
  const res = await fetch(`${SB.url}/rest/v1/${table}`, {
    method: "POST", headers: sbHeaders({ Prefer: "return=minimal" }), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await sbErr(res));
}
async function sbUpdate(table, id, body) {
  const res = await fetch(`${SB.url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", headers: sbHeaders({ Prefer: "return=minimal" }), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await sbErr(res));
}
async function sbDelete(table, id) {
  const res = await fetch(`${SB.url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE", headers: sbHeaders(),
  });
  if (!res.ok) throw new Error(await sbErr(res));
}
async function sbDeleteWhere(table, query) {
  const res = await fetch(`${SB.url}/rest/v1/${table}?${query}`, { method: "DELETE", headers: sbHeaders() });
  if (!res.ok) throw new Error(await sbErr(res));
}

// ---------------- 데이터 로드 ----------------

function normalize(raw) {
  return {
    rehearsals: (raw.rehearsals || []).map((r) => ({
      _row: r.id, date: r.date, time: r.time, location: r.location, address: r.address,
      songs: splitList(r.songs), attendees: splitList(r.attendees),
      cost: parseCost(r.cost), notes: r.notes,
    })),
    songs: (raw.songs || []).map((s) => ({
      _row: s.id, title: s.title, artist: s.artist, status: s.status, key: s.key, link: s.link, notes: s.notes,
    })),
    photos: (raw.photos || []).map((p) => ({
      _row: p._row, id: p.id, link: p.link || p.url || p.src, src: driveImageUrl(p.link || p.url || p.src),
      caption: p.caption, date: p.date,
    })),
    members: (raw.members || []).map((m) => ({ _row: m.id, name: m.name, part: m.part, joined: m.joined })),
    poll: (raw.poll || []).map((p) => ({ _row: p.id, date: p.date })),
    votes: (raw.votes || []).map((v) => ({ _row: v.id, option: v.option, name: v.name })),
    comments: (raw.comments || []).map((c) => ({ _row: c.id, name: c.name, comment: c.comment, time: c.time })),
  };
}

let LOAD_STATUS = { source: "demo", error: "" };

// 사진은 구글 드라이브(앱스 스크립트)에서 가져옴
async function loadPhotos() {
  if (!CFG.SCRIPT_URL) return [];
  try {
    const res = await fetch(CFG.SCRIPT_URL);
    const j = await res.json();
    return j.photos || [];
  } catch (e) {
    console.error("사진(드라이브) 로딩 실패:", e);
    return [];
  }
}

async function loadData() {
  if (SB_READY) {
    try {
      const [reh, sng, mem, poll, votes, comments, photos] = await Promise.all([
        sbSelect("rehearsals"), sbSelect("songs"), sbSelect("members"),
        sbSelect("poll"), sbSelect("votes"), sbSelect("comments"),
        loadPhotos(),
      ]);
      LOAD_STATUS = { source: "supabase", error: "" };
      return normalize({ rehearsals: reh, songs: sng, members: mem, poll, votes, comments, photos });
    } catch (e) {
      LOAD_STATUS = { source: "demo", error: e.message };
      console.error("Supabase 로딩 실패, data.json으로 대체합니다.", e);
    }
  } else {
    LOAD_STATUS = { source: "demo", error: "" };
  }
  // 데모 (Supabase 미설정 또는 실패 시)
  const data = await fetch("data.json").then((r) => r.json());
  // 데모 데이터에는 id가 없으므로 인덱스로 _row 부여 (편집은 비활성)
  return normalize(data);
}

// 연동을 설정했는데 데모로 떨어졌을 때 화면에 원인을 표시
function showLoadBanner() {
  const old = document.getElementById("load-banner");
  if (old) old.remove();
  if (!SB_READY) return;
  if (LOAD_STATUS.source === "demo") {
    const div = document.createElement("div");
    div.id = "load-banner";
    div.className = "load-banner";
    div.innerHTML =
      `⚠️ Supabase에 연결하지 못해 <b>데모 데이터</b>를 표시하고 있어요.` +
      (LOAD_STATUS.error ? `<br><small>${escapeHtml(LOAD_STATUS.error)}</small>` : "");
    document.body.prepend(div);
  } else if (LOAD_STATUS.error) {
    // 연결은 됐지만 스크립트 내부에서 일부 오류가 난 경우
    const div = document.createElement("div");
    div.id = "load-banner";
    div.className = "load-banner";
    div.innerHTML = `⚠️ 일부 데이터를 불러오지 못했어요.<br><small>${escapeHtml(LOAD_STATUS.error)}</small>`;
    document.body.prepend(div);
  }
}

// ---------------- 쓰기 (앱스 스크립트) ----------------

async function postToSheet(payload) {
  if (!CFG.SCRIPT_URL) throw new Error("SCRIPT_URL이 설정되지 않았습니다.");
  // text/plain 으로 보내 CORS preflight를 피함 (서버는 본문을 JSON으로 파싱)
  const res = await fetch(CFG.SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ key: CFG.EDIT_KEY, ...payload }),
  });
  const out = await res.json();
  if (!out.ok) throw new Error(out.error || "저장에 실패했습니다.");
  return out;
}

// 사진을 적당한 크기로 줄여 base64(JPEG)로 변환 — 업로드 용량/속도 개선
function resizeImage(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("파일을 읽을 수 없습니다."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("이미지를 열 수 없습니다."));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// 업로드 비밀번호 얻기 (관리자면 그대로, 아니면 한 번 입력받아 세션에 저장)
function getUploadKey() {
  if (IS_ADMIN && CFG.EDIT_KEY) return CFG.EDIT_KEY;
  let k = sessionStorage.getItem("sb_upload_key");
  if (k) return k;
  k = prompt("사진 업로드 비밀번호를 입력하세요:");
  if (k == null) return null;
  if (CFG.UPLOAD_KEY && k !== CFG.UPLOAD_KEY) {
    alert("업로드 비밀번호가 올바르지 않습니다.");
    return null;
  }
  sessionStorage.setItem("sb_upload_key", k);
  return k;
}

async function uploadPhotos(files) {
  if (!CFG.SCRIPT_URL) {
    alert("사진 업로드 기능을 쓰려면 config.js 에 SCRIPT_URL(앱스 스크립트)을 연결해야 합니다. SETUP.md 참고.");
    return;
  }
  const uploadKey = getUploadKey();
  if (uploadKey == null) return;
  const btn = document.getElementById("photo-upload-btn");
  const orig = btn.textContent;
  let done = 0;
  try {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      done++;
      btn.textContent = `업로드 중... (${done}/${files.length})`;
      const caption = files.length === 1
        ? (prompt("사진 설명(선택):", file.name.replace(/\.[^.]+$/, "")) || "")
        : file.name.replace(/\.[^.]+$/, "");
      const { base64, mimeType } = await resizeImage(file);
      await postToSheet({ action: "uploadPhoto", key: uploadKey, fileData: base64, mimeType, caption });
    }
    btn.textContent = "✅ 완료!";
    await refresh();
  } catch (err) {
    if (/비밀번호/.test(err.message)) sessionStorage.removeItem("sb_upload_key");
    alert("업로드 실패: " + err.message);
  } finally {
    setTimeout(() => (btn.textContent = orig), 1200);
  }
}

// ---------------- 렌더링 ----------------

function renderHero(club, stats) {
  document.getElementById("club-name").innerHTML = club.name
    ? escapeHtml(club.name).replace(/(\S+)$/, '<span class="accent">$1</span>')
    : "서울 <span class='accent'>브레멘</span>";
  document.getElementById("tagline").textContent = club.tagline || "";
  document.getElementById("desc").textContent = club.description || "";
  document.getElementById("stat-rehearsals").textContent = stats.rehearsals;
  document.getElementById("stat-songs").textContent = stats.songs;
  document.getElementById("stat-photos").textContent = stats.photos;
}

function adminCtrls(type, row) {
  if (!IS_ADMIN || !row) return "";
  return `<div class="item-ctrls">
    <button class="ic-btn" data-edit="${type}" data-row="${row}">✏️ 수정</button>
    <button class="ic-btn danger" data-del="${type}" data-row="${row}">🗑️ 삭제</button>
  </div>`;
}

function costBlock(r) {
  const cost = parseCost(r.cost);
  if (!cost) return "";
  const n = (r.attendees || []).length;
  const per = n > 0 ? cost / n : cost;
  return `<div class="cost">
    <div class="cost-total">💰 합주실 비용 <b>${won(cost)}</b></div>
    <div class="cost-split">${n > 0 ? `${n}명 · 1인당 <b>${won(per)}</b>` : "참석자를 입력하면 1/N 정산"}</div>
  </div>`;
}

// 합주 일정 → 구글 캘린더 추가 링크
function calendarUrl(r) {
  const ymd = (r.date || "").replace(/-/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(ymd)) return "";

  const dtStr = (baseYmd, minutes) => {
    const dt = new Date(+baseYmd.slice(0, 4), +baseYmd.slice(4, 6) - 1, +baseYmd.slice(6, 8));
    dt.setMinutes(minutes);
    const p = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}${p(dt.getMonth() + 1)}${p(dt.getDate())}T${p(dt.getHours())}${p(dt.getMinutes())}00`;
  };

  const slots = parseSlots(r.time)
    .map((s) => s.match(/(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/))
    .filter(Boolean);

  let dates;
  if (slots.length) {
    let minStart = Infinity, maxEnd = -Infinity;
    slots.forEach((m) => {
      const s = +m[1] * 60 + +m[2];
      const e = +m[3] * 60 + +m[4];
      if (s < minStart) minStart = s;
      if (e > maxEnd) maxEnd = e;
    });
    dates = `${dtStr(ymd, minStart)}/${dtStr(ymd, maxEnd)}`;
  } else {
    // 시간 미정 → 종일 일정 (종료일은 다음 날, 종료일 제외 규칙)
    const next = dtStr(ymd, 24 * 60).slice(0, 8);
    dates = `${ymd}/${next}`;
  }

  const details = [];
  if ((r.songs || []).length) details.push("🎵 연습곡: " + r.songs.join(", "));
  if ((r.attendees || []).length) details.push("👥 참석: " + r.attendees.join(", "));
  const cost = parseCost(r.cost);
  if (cost) {
    const n = (r.attendees || []).length;
    details.push("💰 비용: " + won(cost) + (n ? ` (1인당 ${won(cost / n)})` : ""));
  }
  if (r.notes) details.push(r.notes);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "서울 브레멘 합주" + (r.location ? ` @ ${r.location}` : ""),
    dates,
    details: details.join("\n"),
    location: r.address || r.location || "",
    ctz: "Asia/Seoul",
  });
  return "https://calendar.google.com/calendar/render?" + params.toString();
}

function renderRehearsals() {
  const el = document.getElementById("rehearsals");
  const list = STATE.rehearsals;
  if (!list.length) {
    el.innerHTML = `<div class="empty">아직 등록된 합주 일정이 없습니다.${IS_ADMIN ? " 위의 <b>+ 추가</b> 버튼으로 등록해보세요!" : ""}</div>`;
    return;
  }
  const sorted = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
  const upcoming = sorted.filter((r) => isUpcoming(r.date));
  const nextDate = upcoming.length ? upcoming[upcoming.length - 1].date : null;

  el.innerHTML = sorted.map((r) => {
    const dd = fmtDate(r.date);
    const isNext = r.date === nextDate;
    const songs = (r.songs || []).map((s) => `<span class="chip">🎵 ${escapeHtml(s)}</span>`).join("");
    const attendees = (r.attendees || []).map((a) =>
      `<span class="avatar"><span class="dot">${escapeHtml(initials(a))}</span>${escapeHtml(a)}</span>`).join("");
    const addr = r.address
      ? `<a href="https://map.naver.com/v5/search/${encodeURIComponent(r.address)}" target="_blank" rel="noopener">📍 ${escapeHtml(r.location || r.address)}</a>`
      : r.location ? `📍 ${escapeHtml(r.location)}` : "";
    return `<div class="rehearsal ${isNext ? "next" : ""}">
      <div class="rehearsal-top">
        <div class="date-badge"><span class="d">${dd.d}</span><span class="m">${dd.m}</span></div>
        <div class="info">
          <h3>${escapeHtml(r.location || "합주")} ${isNext ? '<span class="tag-next">다음 합주</span>' : ""}</h3>
          <div class="meta-row">
            ${r.time ? `<span>🕒 ${escapeHtml(formatTime(r.time))}</span>` : ""}
            ${addr ? `<span>${addr}</span>` : ""}
          </div>
          ${songs ? `<div class="songs-line">${songs}</div>` : ""}
          ${attendees ? `<div class="attendees"><div class="label">참석 (${r.attendees.length}명)</div>${attendees}</div>` : ""}
          ${costBlock(r)}
          ${r.notes ? `<div class="notes">${escapeHtml(r.notes)}</div>` : ""}
          ${calendarUrl(r) ? `<div class="cal-row"><a class="cal-btn" href="${escapeHtml(calendarUrl(r))}" target="_blank" rel="noopener">📅 캘린더에 추가</a></div>` : ""}
          ${adminCtrls("rehearsal", r._row)}
        </div>
      </div>
    </div>`;
  }).join("");
}

function renderSongs() {
  const el = document.getElementById("songs");
  const list = STATE.songs;
  if (!list.length) {
    el.innerHTML = `<div class="empty">아직 등록된 연습곡이 없습니다.${IS_ADMIN ? " 위의 <b>+ 추가</b> 버튼으로 등록해보세요!" : ""}</div>`;
    return;
  }
  el.innerHTML = list.map((s) => {
    const status = (s.status || "후보").trim();
    const statusClass = ["연습중", "완성", "후보"].includes(status) ? status : "후보";
    return `<div class="song">
      <div class="song-head">
        <div><h3>${escapeHtml(s.title || "제목 없음")}</h3><div class="artist">${escapeHtml(s.artist || "")}</div></div>
        <span class="status ${statusClass}">${escapeHtml(status)}</span>
      </div>
      ${s.key ? `<div class="song-meta">Key: <span class="key">${escapeHtml(s.key)}</span></div>` : ""}
      ${s.notes ? `<div class="song-notes">${escapeHtml(s.notes)}</div>` : ""}
      ${s.link ? `<a class="listen" href="${escapeHtml(s.link)}" target="_blank" rel="noopener">▶ 들어보기</a>` : ""}
      ${adminCtrls("song", s._row)}
    </div>`;
  }).join("");
}

function renderPhotos() {
  const el = document.getElementById("gallery");
  const valid = STATE.photos.filter((p) => p.src);
  if (!valid.length) {
    el.innerHTML = `<div class="empty">아직 사진이 없습니다.${IS_ADMIN ? " 구글 드라이브 공유 링크를 <b>+ 추가</b> 로 등록해보세요!" : ""}</div>`;
    return;
  }
  el.innerHTML = valid.map((p, i) => `
    <div class="photo" data-index="${i}">
      <img src="${escapeHtml(p.src)}" alt="${escapeHtml(p.caption || "활동 사진")}" loading="lazy" onerror="this.parentElement.classList.add('broken')">
      <div class="cap">
        ${p.date ? `<div class="pdate">${escapeHtml(p.date)}</div>` : ""}
        ${escapeHtml(p.caption || "")}
      </div>
      ${IS_ADMIN && p.id ? `<div class="photo-ctrls">
        <button class="ic-btn danger" data-delphoto="${escapeHtml(p.id)}">🗑️</button>
      </div>` : ""}
    </div>`).join("");

  const lb = document.getElementById("lightbox");
  const lbImg = document.getElementById("lb-img");
  const lbCap = document.getElementById("lb-cap");
  el.querySelectorAll(".photo").forEach((node) => {
    node.addEventListener("click", (e) => {
      if (e.target.closest(".photo-ctrls")) return;
      const p = valid[Number(node.dataset.index)];
      lbImg.src = p.src;
      lbCap.textContent = [p.date, p.caption].filter(Boolean).join(" · ");
      lb.classList.add("open");
    });
  });
}

function renderMembers() {
  const el = document.getElementById("members");
  const list = STATE.members;
  if (!list.length) {
    el.innerHTML = `<div class="empty">아직 등록된 멤버가 없습니다.${IS_ADMIN ? " 위의 <b>+ 추가</b> 버튼으로 등록해보세요!" : ""}</div>`;
    return;
  }
  el.innerHTML = list.map((m) => `
    <div class="member">
      <div class="member-dot">${escapeHtml(initials(m.name))}</div>
      <div class="member-info">
        <div class="member-name">${escapeHtml(m.name || "")}</div>
        ${m.part ? `<div class="member-part">${escapeHtml(m.part)}</div>` : ""}
      </div>
      ${IS_ADMIN && m._row ? `<div class="item-ctrls">
        <button class="ic-btn" data-edit="member" data-row="${m._row}">✏️</button>
        <button class="ic-btn danger" data-del="member" data-row="${m._row}">🗑️</button>
      </div>` : ""}
    </div>`).join("");
}

// ---- 투표 (날짜 달력) ----
let POLL_VIEW = (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; })();
let POLL_EDIT = false; // 관리자: 후보 날짜 편집 모드
let POLL_DRAFT = null;  // 편집 중인 후보 날짜 (저장 전까지 로컬에만 보관)
let VOTE_DRAFT = null;  // 멤버 본인 투표 선택 (저장 전까지 로컬에만 보관)

function getVoterName() {
  let n = localStorage.getItem("sb_voter");
  if (n) return n;
  n = (prompt("투표에 사용할 이름을 입력하세요:") || "").trim();
  if (n) localStorage.setItem("sb_voter", n);
  return n;
}

// 후보 날짜 목록 / 날짜→poll행 매핑
function candidateRows() {
  const map = {};
  STATE.poll.forEach((p) => { const d = ymd(p.date); if (d) map[d] = p._row; });
  return map;
}

// 내가 지금 '저장된' 상태로 투표한 후보 날짜들
function myVotedActualSet() {
  const myName = localStorage.getItem("sb_voter");
  const s = new Set();
  if (!myName) return s;
  STATE.poll.forEach((p) => {
    const d = ymd(p.date);
    if (d && votersFor(d).includes(myName)) s.add(d);
  });
  return s;
}
// 화면에 표시할 내 선택 (드래프트 중이면 드래프트, 아니면 저장된 값)
function effectiveMineSet() {
  return VOTE_DRAFT !== null ? VOTE_DRAFT : myVotedActualSet();
}

// 날짜 클릭 → 내 투표 선택 토글 (네트워크 없이 로컬)
function toggleMyVote(ds) {
  if (!SB_READY) { alert("투표하려면 Supabase 연결이 필요합니다."); return; }
  const name = getVoterName();
  if (!name) return;
  if (VOTE_DRAFT === null) VOTE_DRAFT = myVotedActualSet();
  if (VOTE_DRAFT.has(ds)) VOTE_DRAFT.delete(ds);
  else VOTE_DRAFT.add(ds);
  renderPoll();
}

function cancelMyVotes() {
  VOTE_DRAFT = null;
  renderPoll();
}

// 저장: 선택한 날짜와 저장된 투표의 차이만 한 번에 반영
async function saveMyVotes() {
  if (!SB_READY) { alert("투표하려면 Supabase 연결이 필요합니다."); return; }
  const name = localStorage.getItem("sb_voter");
  if (!name || VOTE_DRAFT === null) return;
  const actual = myVotedActualSet();
  const draft = VOTE_DRAFT;
  const toAdd = [...draft].filter((d) => !actual.has(d));
  const toRemove = [...actual].filter((d) => !draft.has(d));
  const btn = document.getElementById("myvote-save");
  if (btn) { btn.textContent = "저장 중..."; btn.disabled = true; }
  try {
    const jobs = [];
    if (toAdd.length) jobs.push(sbInsert("votes", toAdd.map((d) => ({ option: d, name }))));
    if (toRemove.length) {
      const list = toRemove.map(encodeURIComponent).join(",");
      jobs.push(sbDeleteWhere("votes", `name=eq.${encodeURIComponent(name)}&option=in.(${list})`));
    }
    await Promise.all(jobs);
    VOTE_DRAFT = null;
    await refresh();
  } catch (e) {
    alert("투표 저장 실패: " + e.message);
    if (btn) { btn.textContent = "💾 투표 저장"; btn.disabled = false; }
  }
}

// 후보 편집 시작: 현재 후보를 드래프트로 복사 (이후엔 로컬에서만 토글)
function enterPollEdit() {
  POLL_DRAFT = new Set(Object.keys(candidateRows()));
  POLL_EDIT = true;
  renderPoll();
}
function cancelPollEdit() {
  POLL_EDIT = false;
  POLL_DRAFT = null;
  renderPoll();
}
// 날짜 토글 — 네트워크 없이 즉시 반영
function toggleDraftDate(dateStr) {
  if (!POLL_DRAFT) return;
  if (POLL_DRAFT.has(dateStr)) POLL_DRAFT.delete(dateStr);
  else POLL_DRAFT.add(dateStr);
  renderPoll();
}
// 저장: 후보 전체를 한 번의 요청으로 전송
async function savePollEdit() {
  if (!SB_READY) { alert("후보를 저장하려면 Supabase 연결이 필요합니다."); return; }
  const dates = Array.from(POLL_DRAFT || []).sort();
  const btn = document.getElementById("poll-save");
  if (btn) { btn.textContent = "저장 중..."; btn.disabled = true; }
  try {
    await sbDeleteWhere("poll", "id=gte.0");          // 기존 후보 전체 삭제
    if (dates.length) await sbInsert("poll", dates.map((d) => ({ date: d }))); // 새 후보 일괄 삽입
    POLL_EDIT = false;
    POLL_DRAFT = null;
    await refresh();
  } catch (e) {
    alert("후보 저장 실패: " + e.message);
    if (btn) { btn.textContent = "💾 저장"; btn.disabled = false; }
  }
}

function renderVoterBar() {
  const el = document.getElementById("poll-voter");
  const name = localStorage.getItem("sb_voter");
  let editBtn = "";
  if (IS_ADMIN && SB_READY) {
    editBtn = POLL_EDIT
      ? `<button class="link-btn on" id="poll-save">💾 저장</button> <button class="link-btn" id="poll-cancel">취소</button>`
      : `<button class="link-btn" id="poll-edit-toggle">✏️ 후보 날짜 편집</button>`;
  }
  const namePart = name
    ? `투표 이름: <b>${escapeHtml(name)}</b> <button class="link-btn" id="voter-change">변경</button>`
    : `<button class="link-btn" id="voter-set">투표할 이름 설정</button>`;
  el.innerHTML = `<div>${namePart}</div><div>${editBtn}</div>`;

  const set = document.getElementById("voter-set");
  if (set) set.addEventListener("click", () => { getVoterName(); renderPoll(); });
  const ch = document.getElementById("voter-change");
  if (ch) ch.addEventListener("click", () => {
    const n = (prompt("투표에 사용할 이름:", name) || "").trim();
    if (n) { localStorage.setItem("sb_voter", n); renderPoll(); }
  });
  const et = document.getElementById("poll-edit-toggle");
  if (et) et.addEventListener("click", enterPollEdit);
  const sv = document.getElementById("poll-save");
  if (sv) sv.addEventListener("click", savePollEdit);
  const cc = document.getElementById("poll-cancel");
  if (cc) cc.addEventListener("click", cancelPollEdit);
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function renderPoll() {
  renderVoterBar();
  const el = document.getElementById("poll");
  const myName = localStorage.getItem("sb_voter");
  const cands = candidateRows();
  const candSet = POLL_EDIT && POLL_DRAFT ? POLL_DRAFT : new Set(Object.keys(cands));
  const mineSet = effectiveMineSet();
  const y = POLL_VIEW.getFullYear(), mo = POLL_VIEW.getMonth();
  const pad = (n) => String(n).padStart(2, "0");
  const startDow = new Date(y, mo, 1).getDay();
  const daysIn = new Date(y, mo + 1, 0).getDate();

  let cells = "";
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= daysIn; d++) {
    const ds = `${y}-${pad(mo + 1)}-${pad(d)}`;
    const dow = new Date(y, mo, d).getDay();
    const isCand = candSet.has(ds);
    const cnt = votersFor(ds).length;
    const mine = mineSet.has(ds);
    let cls = `cal-cell dow${dow}`;
    let attr = "";
    if (POLL_EDIT) {
      cls += " editable" + (isCand ? " cand" : "");
      attr = `data-canddate="${ds}"`;
    } else if (isCand) {
      cls += " cand votable" + (mine ? " mine" : "");
      attr = `data-votedate="${ds}"`;
    } else {
      cls += " disabled";
    }
    cells += `<button class="${cls}" ${attr} ${attr ? "" : "disabled"}>
      <span class="cal-d">${d}</span>
      ${!POLL_EDIT && isCand ? `<span class="cal-cnt">${cnt}</span>` : ""}
      ${POLL_EDIT && isCand ? `<span class="cal-cand-dot">●</span>` : ""}
    </button>`;
  }

  const dirty = VOTE_DRAFT !== null;
  const hint = POLL_EDIT
    ? `<div class="cal-hint">📌 후보 날짜를 눌러 선택하세요(여러 개 가능). 다 고른 뒤 위의 <b>💾 저장</b>을 누르면 한 번에 반영됩니다.</div>`
    : (candSet.size ? `<div class="cal-hint">가능한 날짜를 모두 눌러 선택한 뒤 <b>💾 투표 저장</b>을 누르세요.</div>`
                    : `<div class="cal-hint">아직 후보 날짜가 없어요.${IS_ADMIN ? " ‘후보 날짜 편집’으로 날짜를 올려보세요." : " 관리자가 후보를 올리면 투표할 수 있어요."}</div>`);
  const saveBar = (!POLL_EDIT && candSet.size)
    ? `<div class="vote-save-bar">
         <span>${dirty ? "선택을 저장하면 반영됩니다." : "가능한 날짜를 누른 뒤 저장하세요."}</span>
         <span class="vsb-actions">
           ${dirty ? `<button class="link-btn" id="myvote-cancel">취소</button>` : ""}
           <button class="btn btn-primary" id="myvote-save" ${dirty ? "" : "disabled"}>💾 투표 저장</button>
         </span>
       </div>`
    : "";

  el.innerHTML = `
    <div class="cal-nav">
      <button class="link-btn" id="cal-prev">‹</button>
      <div class="cal-title">${y}년 ${mo + 1}월</div>
      <button class="link-btn" id="cal-next">›</button>
    </div>
    <div class="cal-grid">
      ${DOW.map((w, i) => `<div class="cal-dow ${i === 0 ? "s" : i === 6 ? "t" : ""}">${w}</div>`).join("")}
      ${cells}
    </div>
    ${hint}
    ${saveBar}
    ${POLL_EDIT ? "" : renderPollSummary(candSet, mineSet)}
  `;

  document.getElementById("cal-prev").onclick = () => { POLL_VIEW = new Date(y, mo - 1, 1); renderPoll(); };
  document.getElementById("cal-next").onclick = () => { POLL_VIEW = new Date(y, mo + 1, 1); renderPoll(); };
  el.querySelectorAll("[data-votedate]").forEach((b) =>
    b.addEventListener("click", () => toggleMyVote(b.dataset.votedate)));
  el.querySelectorAll("[data-canddate]").forEach((b) =>
    b.addEventListener("click", () => toggleDraftDate(b.dataset.canddate)));
  const ms = document.getElementById("myvote-save");
  if (ms) ms.addEventListener("click", saveMyVotes);
  const mc = document.getElementById("myvote-cancel");
  if (mc) mc.addEventListener("click", cancelMyVotes);
}

// 후보 날짜별 득표 요약 (최다 강조)
function renderPollSummary(candSet, mineSet) {
  const dates = [...candSet];
  if (!dates.length) return "";
  const counts = dates.map((d) => votersFor(d).length);
  const max = Math.max(0, ...counts);
  const sorted = dates.sort((a, b) => votersFor(b).length - votersFor(a).length || a.localeCompare(b));
  const rows = sorted.map((ds) => {
    const voters = votersFor(ds);
    const isTop = voters.length > 0 && voters.length === max;
    const dt = new Date(ds);
    const label = isNaN(dt) ? ds : `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DOW[dt.getDay()]})`;
    const voted = mineSet.has(ds);
    const chips = voters.map((v) => `<span class="avatar"><span class="dot">${escapeHtml(initials(v))}</span>${escapeHtml(v)}</span>`).join("");
    return `<div class="poll-opt ${isTop ? "top" : ""}">
      <div class="poll-opt-head">
        <div class="poll-opt-info">
          <h3>${escapeHtml(label)} ${isTop ? '<span class="tag-next">최다</span>' : ""}</h3>
        </div>
        <div class="poll-count"><b>${voters.length}</b><span>표</span></div>
        ${voted
          ? `<span class="vote-badge">✓ 투표함</span>`
          : `<button class="vote-btn" data-votedate="${escapeHtml(ds)}">🙋 가능</button>`}
      </div>
      ${chips ? `<div class="poll-voters">${chips}</div>` : ``}
    </div>`;
  }).join("");
  return `<div class="poll-summary"><div class="poll-summary-title">📊 후보별 현황</div>${rows}</div>`;
}

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function submitComment() {
  if (!SB_READY) { alert("댓글을 남기려면 Supabase 연결이 필요합니다."); return; }
  const input = document.getElementById("comment-input");
  const text = (input.value || "").trim();
  if (!text) return;
  const name = getVoterName();
  if (!name) return;
  const btn = document.getElementById("comment-submit");
  btn.disabled = true;
  try {
    await sbInsert("comments", { name, comment: text, time: nowStr() });
    input.value = "";
    await refresh();
  } catch (e) { alert("댓글 등록 실패: " + e.message); }
  finally { btn.disabled = false; }
}

function renderComments() {
  const el = document.getElementById("poll-comments");
  if (!el) return;
  const list = [...STATE.comments].reverse(); // 최신순
  const items = list.length
    ? list.map((c) => `
      <div class="comment">
        <div class="comment-head">
          <span class="comment-name">${escapeHtml(c.name || "익명")}</span>
          ${c.time ? `<span class="comment-time">${escapeHtml(c.time)}</span>` : ""}
        </div>
        <div class="comment-body">${escapeHtml(c.comment || "")}</div>
        ${IS_ADMIN && c._row ? `<button class="ic-btn danger" data-delcomment="${c._row}">🗑️</button>` : ""}
      </div>`).join("")
    : `<div class="comment-empty">아직 댓글이 없어요. 투표하면서 특이사항을 남겨주세요!</div>`;

  el.innerHTML = `
    <div class="comments-title">💬 특이사항 / 댓글</div>
    <div class="comment-form">
      <textarea id="comment-input" rows="2" placeholder="특이사항을 남겨주세요 (예: 주말만 가능, 시험기간이라 저녁만 돼요)"></textarea>
      <button class="btn btn-primary" id="comment-submit">남기기</button>
    </div>
    <div class="comment-list">${items}</div>`;

  document.getElementById("comment-submit").addEventListener("click", submitComment);
  el.querySelectorAll("[data-delcomment]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("이 댓글을 삭제할까요?")) return;
      try {
        await sbDelete("comments", b.dataset.delcomment);
        await refresh();
      } catch (e) { alert("삭제 실패: " + e.message); }
    }));
}

function renderAll() {
  renderRehearsals();
  renderPoll();
  renderComments();
  renderSongs();
  renderMembers();
  renderPhotos();
  document.getElementById("stat-rehearsals").textContent = STATE.rehearsals.length;
  document.getElementById("stat-songs").textContent = STATE.songs.length;
  document.getElementById("stat-photos").textContent = STATE.photos.filter((p) => p.src).length;
  bindItemControls();
}

// ---------------- 편집 모달 ----------------

const FORMS = {
  rehearsal: {
    title: "합주 일정",
    tab: TABS.rehearsals,
    fields: [
      { name: "date", label: "날짜", type: "date", required: true },
      { name: "time", label: "시간 (1시간 단위, 여러 개 선택 가능)", type: "timeslots" },
      { name: "location", label: "장소", type: "text", placeholder: "예: 낙원상가 합주실 A룸" },
      { name: "address", label: "주소", type: "text", placeholder: "지도 검색용 (선택)" },
      { name: "songs", label: "연습곡", type: "multiselect", source: "songs", extra: true, list: true },
      { name: "attendees", label: "참석자", type: "multiselect", source: "members", extra: true, list: true },
      { name: "cost", label: "합주실 비용 (원)", type: "number", placeholder: "예: 40000 → 참석자 수로 1/N 자동 계산" },
      { name: "notes", label: "메모", type: "textarea" },
    ],
  },
  song: {
    title: "연습곡",
    tab: TABS.songs,
    fields: [
      { name: "title", label: "곡 제목", type: "text", required: true },
      { name: "artist", label: "아티스트", type: "text" },
      { name: "status", label: "상태", type: "select", options: ["후보", "연습중", "완성"] },
      { name: "key", label: "Key", type: "text", placeholder: "예: C, Am" },
      { name: "link", label: "링크", type: "text", placeholder: "유튜브/음원 링크 (선택)" },
      { name: "notes", label: "메모", type: "textarea" },
    ],
  },
  member: {
    title: "멤버",
    tab: TABS.members,
    fields: [
      { name: "name", label: "이름", type: "text", required: true },
      { name: "part", label: "파트/역할", type: "text", placeholder: "예: 기타, 보컬, 드럼" },
      { name: "joined", label: "가입", type: "text", placeholder: "예: 2026" },
    ],
  },
  poll: {
    title: "투표 후보 일정",
    tab: "poll",
    fields: [
      { name: "date", label: "날짜", type: "date", required: true },
      { name: "time", label: "시간 (1시간 단위, 여러 개 선택 가능)", type: "timeslots" },
      { name: "note", label: "메모", type: "text", placeholder: "예: 낙원상가 / 미정" },
    ],
  },
};

// 투표 후보의 고유 키 (날짜+시간 조합)
function pollKey(o) {
  return `${(o.date || "").trim()}|${(o.time || "").trim()}`;
}
function votersFor(key) {
  return STATE.votes.filter((v) => v.option === key).map((v) => v.name).filter(Boolean);
}

// 드롭다운(다중 선택) 보기 옵션을 DB(시트)에서 가져오기
function sourceOptions(source) {
  if (source === "members") return STATE.members.map((m) => m.name).filter(Boolean);
  if (source === "songs") return STATE.songs.map((s) => s.title).filter(Boolean);
  return [];
}

let modalCtx = null; // { type, row|null }

const TYPE_KEY = { rehearsal: "rehearsals", song: "songs", member: "members", photo: "photos", poll: "poll" };
function findRecord(type, row) {
  return (STATE[TYPE_KEY[type]] || []).find((x) => String(x._row) === String(row));
}

function openModal(type, row) {
  if (!SB_READY) {
    alert("편집하려면 config.js 에 SUPABASE_URL / SUPABASE_ANON_KEY 를 설정해야 합니다. SETUP.md 를 참고하세요.");
    return;
  }
  const spec = FORMS[type];
  modalCtx = { type, row: row || null };
  const existing = row ? findRecord(type, row) : null;

  document.getElementById("modal-title").textContent =
    (row ? "수정 · " : "추가 · ") + spec.title;

  const form = document.getElementById("modal-form");
  form.innerHTML = spec.fields.map((f) => {
    let val = existing ? existing[f.name] : "";
    if (f.list && Array.isArray(val)) val = val.join(", ");
    val = val == null ? "" : String(val);
    const ev = escapeHtml(val);
    if (f.type === "multiselect") {
      const cur = existing ? (Array.isArray(existing[f.name]) ? existing[f.name] : splitList(existing[f.name])) : [];
      const opts = sourceOptions(f.source);
      const selected = new Set(cur);
      const known = new Set(opts);
      const extras = cur.filter((v) => !known.has(v)); // 목록에 없는 직접 입력 값
      const boxes = opts.length
        ? opts.map((o) => {
            const on = selected.has(o);
            return `<label class="slot ${on ? "on" : ""}"><input type="checkbox" name="${f.name}" value="${escapeHtml(o)}" ${on ? "checked" : ""}>${escapeHtml(o)}</label>`;
          }).join("")
        : `<div class="ms-empty">아직 ${f.source === "members" ? "멤버" : "곡"}가 없어요. 아래에 직접 입력하거나, 먼저 ${f.source === "members" ? "멤버" : "연습곡"}를 추가하세요.</div>`;
      const extraInput = f.extra
        ? `<input type="text" name="${f.name}__extra" class="ms-extra" placeholder="직접 추가 (쉼표로 구분)" value="${escapeHtml(extras.join(", "))}">`
        : "";
      return `<div class="fld"><span>${f.label}</span><div class="slot-grid ms-grid">${boxes}</div>${extraInput}</div>`;
    }
    if (f.type === "timeslots") {
      const selected = new Set(parseSlots(val));
      const boxes = TIME_SLOTS.map((slot) => {
        const on = selected.has(slot);
        const lbl = slot.replace("-", " - ");
        return `<label class="slot ${on ? "on" : ""}"><input type="checkbox" name="${f.name}" value="${slot}" ${on ? "checked" : ""}>${lbl}</label>`;
      }).join("");
      return `<div class="fld"><span>${f.label}</span><div class="slot-grid">${boxes}</div></div>`;
    }
    if (f.type === "textarea") {
      return `<label class="fld"><span>${f.label}</span><textarea name="${f.name}" rows="2" placeholder="${f.placeholder || ""}">${ev}</textarea></label>`;
    }
    if (f.type === "select") {
      const opts = f.options.map((o) => `<option ${o === val ? "selected" : ""}>${o}</option>`).join("");
      return `<label class="fld"><span>${f.label}</span><select name="${f.name}">${opts}</select></label>`;
    }
    return `<label class="fld"><span>${f.label}${f.required ? " *" : ""}</span><input type="${f.type}" name="${f.name}" value="${ev}" placeholder="${f.placeholder || ""}" ${f.required ? "required" : ""}></label>`;
  }).join("");

  document.getElementById("modal-delete").hidden = !row;
  document.getElementById("modal-status").textContent = "";
  document.getElementById("modal").classList.add("open");
}

function closeModal() {
  document.getElementById("modal").classList.remove("open");
  modalCtx = null;
}

async function saveModal(e) {
  e.preventDefault();
  if (!modalCtx) return;
  const spec = FORMS[modalCtx.type];
  const form = document.getElementById("modal-form");
  const values = {};
  spec.fields.forEach((f) => {
    if (f.type === "timeslots") {
      const checked = Array.from(form.querySelectorAll(`input[name="${f.name}"]:checked`)).map((c) => c.value);
      values[f.name] = checked.join(", ");
    } else if (f.type === "multiselect") {
      const checked = Array.from(form.querySelectorAll(`input[type="checkbox"][name="${f.name}"]:checked`)).map((c) => c.value);
      const extraEl = form.elements[`${f.name}__extra`];
      const extras = extraEl ? splitList(extraEl.value) : [];
      values[f.name] = [...checked, ...extras].join(", ");
    } else {
      values[f.name] = (form.elements[f.name].value || "").trim();
    }
  });
  const statusEl = document.getElementById("modal-status");
  statusEl.textContent = "저장 중...";
  try {
    if (modalCtx.row) await sbUpdate(spec.tab, modalCtx.row, values);
    else await sbInsert(spec.tab, values);
    statusEl.textContent = "✅ 저장되었습니다!";
    await refresh();
    setTimeout(closeModal, 500);
  } catch (err) {
    statusEl.textContent = "❌ " + err.message;
  }
}

async function deleteItem() {
  if (!modalCtx || !modalCtx.row) return;
  if (!confirm("정말 삭제할까요?")) return;
  const spec = FORMS[modalCtx.type];
  const statusEl = document.getElementById("modal-status");
  statusEl.textContent = "삭제 중...";
  try {
    await sbDelete(spec.tab, modalCtx.row);
    statusEl.textContent = "🗑️ 삭제되었습니다.";
    await refresh();
    setTimeout(closeModal, 500);
  } catch (err) {
    statusEl.textContent = "❌ " + err.message;
  }
}

function bindItemControls() {
  document.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); openModal(b.dataset.edit, b.dataset.row); }));
  document.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("정말 삭제할까요?")) return;
      const type = b.dataset.del;
      const spec = FORMS[type];
      try {
        await sbDelete(spec.tab, b.dataset.row);
        await refresh();
      } catch (err) { alert("삭제 실패: " + err.message); }
    }));
  document.querySelectorAll("[data-delphoto]").forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("이 사진을 삭제할까요? (드라이브에서도 휴지통으로 이동)")) return;
      try {
        await postToSheet({ action: "deletePhoto", id: b.dataset.delphoto });
        await refresh();
      } catch (err) { alert("삭제 실패: " + err.message); }
    }));
}

// ---------------- 관리자 모드 ----------------

function setAdmin(on) {
  IS_ADMIN = on;
  document.body.classList.toggle("admin", on);
  document.querySelectorAll(".add-btn").forEach((b) => (b.hidden = !on));
  document.getElementById("admin-toggle").textContent = on ? "관리 ✓" : "관리";
  renderAll();
}

function toggleAdmin(e) {
  e.preventDefault();
  if (IS_ADMIN) { setAdmin(false); sessionStorage.removeItem("sb_admin"); return; }
  if (!SB_READY) {
    alert("편집 기능을 쓰려면 먼저 config.js 에 Supabase(SUPABASE_URL / SUPABASE_ANON_KEY)를 연결하세요. 자세한 내용은 SETUP.md 참고.");
    return;
  }
  const pw = prompt("편집 비밀번호를 입력하세요:");
  if (pw == null) return;
  if (pw === CFG.EDIT_KEY) {
    sessionStorage.setItem("sb_admin", "1");
    setAdmin(true);
  } else {
    alert("비밀번호가 올바르지 않습니다.");
  }
}

// ---------------- 새로고침 ----------------

async function refresh() {
  STATE = await loadData();
  renderAll();
  showLoadBanner();
}

// ---------------- 초기화 ----------------

function setupStatic() {
  // 라이트박스 닫기
  const lb = document.getElementById("lightbox");
  lb.addEventListener("click", (e) => { if (e.target.id !== "lb-img") lb.classList.remove("open"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { lb.classList.remove("open"); closeModal(); } });

  // 관리자 토글
  document.getElementById("admin-toggle").addEventListener("click", toggleAdmin);

  // 추가 버튼
  document.querySelectorAll(".add-btn").forEach((b) =>
    b.addEventListener("click", () => openModal(b.dataset.add, null)));

  // 사진 업로드
  const fileInput = document.getElementById("photo-file");
  document.getElementById("photo-upload-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // 같은 파일 다시 선택 가능하도록 초기화
    if (files.length) await uploadPhotos(files);
  });

  // 모달
  document.getElementById("modal-form").addEventListener("submit", saveModal);
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-delete").addEventListener("click", deleteItem);
  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") closeModal();
  });
}

(async function init() {
  setupStatic();
  renderHero(CLUB_DEFAULT, { rehearsals: 0, songs: 0, photos: 0 });

  // 사진 올리기 버튼: 앱스 스크립트가 연결돼 있으면 누구나 사용 가능
  if (CFG.SCRIPT_URL) document.getElementById("photo-upload-btn").hidden = false;
  // 드라이브 폴더 바로가기 링크
  if (CFG.DRIVE_FOLDER_ID) {
    const fl = document.getElementById("folder-link");
    fl.href = `https://drive.google.com/drive/folders/${CFG.DRIVE_FOLDER_ID}`;
    fl.hidden = false;
  }

  await refresh();
  // 세션에 관리자 기록이 있으면 복원
  if (SB_READY && sessionStorage.getItem("sb_admin") === "1") setAdmin(true);
})();
