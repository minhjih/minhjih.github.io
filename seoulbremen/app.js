// ===================================================================
//  서울 브레멘 - 데이터 로딩 / 렌더링 / 편집
//  데이터 출처 우선순위:
//   1) SCRIPT_URL  : 앱스 스크립트 (읽기+쓰기)
//   2) SHEET_ID    : 공개 구글 시트 (읽기 전용)
//   3) data.json   : 데모 데이터
// ===================================================================

const CFG = window.SEOUL_BREMEN_CONFIG || {};
const TABS = CFG.TABS || { rehearsals: "rehearsals", songs: "songs", photos: "photos", members: "members" };

const CLUB_DEFAULT = {
  name: "서울 브레멘",
  tagline: "함께 모여 소리를 내는 사람들",
  description:
    "서울 브레멘은 합주를 사랑하는 사람들이 모인 음악 동아리입니다. 매주 모여 함께 연습하고, 무대를 만들고, 그 순간들을 기록합니다.",
};

let STATE = { rehearsals: [], songs: [], photos: [], members: [] };
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

function isUpcoming(dateStr) {
  const dt = new Date(dateStr);
  if (isNaN(dt)) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return dt >= today;
}

// ---------------- 데이터 로드 ----------------

function gvizUrl(tab) {
  return `https://docs.google.com/spreadsheets/d/${CFG.SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
}
function parseGviz(text) {
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const cols = json.table.cols.map((c) => (c.label || "").trim().toLowerCase());
  return (json.table.rows || []).map((row) => {
    const obj = {};
    (row.c || []).forEach((cell, i) => {
      if (!cols[i]) return;
      obj[cols[i]] = cell ? (cell.f != null ? cell.f : cell.v) : "";
    });
    return obj;
  });
}

function normalize(raw) {
  return {
    rehearsals: (raw.rehearsals || []).map((r) => ({
      _row: r._row, date: r.date, time: r.time, location: r.location, address: r.address,
      songs: splitList(r.songs), attendees: splitList(r.attendees),
      cost: parseCost(r.cost), notes: r.notes,
    })),
    songs: (raw.songs || []).map((s) => ({
      _row: s._row, title: s.title, artist: s.artist, status: s.status, key: s.key, link: s.link, notes: s.notes,
    })),
    photos: (raw.photos || []).map((p) => ({
      _row: p._row, id: p.id, link: p.link || p.url || p.src, src: driveImageUrl(p.link || p.url || p.src),
      caption: p.caption, date: p.date,
    })),
    members: (raw.members || []).map((m) => ({ _row: m._row, name: m.name, part: m.part, joined: m.joined })),
  };
}

let LOAD_STATUS = { source: "demo", error: "" };

async function loadData() {
  // 1) 앱스 스크립트
  if (CFG.SCRIPT_URL) {
    try {
      const res = await fetch(CFG.SCRIPT_URL);
      const text = await res.text();
      let raw;
      try {
        raw = JSON.parse(text);
      } catch (e) {
        throw new Error(
          "스크립트가 JSON이 아닌 응답을 보냈습니다. 웹앱 접근 권한이 '모든 사용자'인지, URL이 /exec 로 끝나는지 확인하세요. (응답 앞부분: " +
            text.replace(/\s+/g, " ").slice(0, 60) + " …)"
        );
      }
      LOAD_STATUS = { source: "script", error: raw._error || raw._photoError || "" };
      return normalize(raw);
    } catch (e) {
      LOAD_STATUS = { source: "demo", error: e.message };
      console.error("앱스 스크립트 로딩 실패:", e);
    }
  }
  // 2) 공개 시트
  if (CFG.SHEET_ID) {
    try {
      const [reh, sng, pho, mem] = await Promise.all([
        fetch(gvizUrl(TABS.rehearsals)).then((r) => r.text()).then(parseGviz).catch(() => []),
        fetch(gvizUrl(TABS.songs)).then((r) => r.text()).then(parseGviz).catch(() => []),
        fetch(gvizUrl(TABS.photos)).then((r) => r.text()).then(parseGviz).catch(() => []),
        fetch(gvizUrl(TABS.members)).then((r) => r.text()).then(parseGviz).catch(() => []),
      ]);
      LOAD_STATUS = { source: "sheet", error: "" };
      return normalize({ rehearsals: reh, songs: sng, photos: pho, members: mem });
    } catch (e) {
      LOAD_STATUS = { source: "demo", error: e.message };
      console.error("공개 시트 로딩 실패, data.json으로 대체합니다.", e);
    }
  }
  // 3) 데모
  if (!CFG.SCRIPT_URL && !CFG.SHEET_ID) LOAD_STATUS = { source: "demo", error: "" };
  const data = await fetch("data.json").then((r) => r.json());
  return normalize(data);
}

// 연동을 설정했는데 데모로 떨어졌을 때 화면에 원인을 표시
function showLoadBanner() {
  const old = document.getElementById("load-banner");
  if (old) old.remove();
  const configured = CFG.SCRIPT_URL || CFG.SHEET_ID;
  if (!configured) return;
  if (LOAD_STATUS.source === "demo") {
    const div = document.createElement("div");
    div.id = "load-banner";
    div.className = "load-banner";
    div.innerHTML =
      `⚠️ 구글 시트에 연결하지 못해 <b>데모 데이터</b>를 표시하고 있어요.` +
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

function renderAll() {
  renderRehearsals();
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
};

// 드롭다운(다중 선택) 보기 옵션을 DB(시트)에서 가져오기
function sourceOptions(source) {
  if (source === "members") return STATE.members.map((m) => m.name).filter(Boolean);
  if (source === "songs") return STATE.songs.map((s) => s.title).filter(Boolean);
  return [];
}

let modalCtx = null; // { type, row|null }

const TYPE_KEY = { rehearsal: "rehearsals", song: "songs", member: "members", photo: "photos" };
function findRecord(type, row) {
  return (STATE[TYPE_KEY[type]] || []).find((x) => String(x._row) === String(row));
}

function openModal(type, row) {
  if (!CFG.SCRIPT_URL) {
    alert("편집하려면 config.js 에 SCRIPT_URL(앱스 스크립트 주소)을 설정해야 합니다. SETUP.md 를 참고하세요.");
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
    await postToSheet({
      action: modalCtx.row ? "update" : "add",
      tab: spec.tab,
      row: modalCtx.row || undefined,
      values,
    });
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
    await postToSheet({ action: "delete", tab: spec.tab, row: modalCtx.row });
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
        await postToSheet({ action: "delete", tab: spec.tab, row: b.dataset.row });
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
  if (!CFG.SCRIPT_URL) {
    alert("편집 기능을 쓰려면 먼저 config.js 에 앱스 스크립트(SCRIPT_URL)를 연결하세요. 자세한 내용은 SETUP.md 참고.");
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
  if (CFG.SCRIPT_URL && sessionStorage.getItem("sb_admin") === "1") setAdmin(true);
})();
