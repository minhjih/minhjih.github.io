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
  return String(str).split(/[;,\n]/).map((s) => s.trim()).filter(Boolean);
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
      _row: p._row, link: p.link || p.url || p.src, src: driveImageUrl(p.link || p.url || p.src),
      caption: p.caption, date: p.date,
    })),
    members: (raw.members || []).map((m) => ({ _row: m._row, name: m.name, part: m.part, joined: m.joined })),
  };
}

async function loadData() {
  // 1) 앱스 스크립트
  if (CFG.SCRIPT_URL) {
    try {
      const res = await fetch(CFG.SCRIPT_URL);
      const raw = await res.json();
      return normalize(raw);
    } catch (e) { console.error("앱스 스크립트 로딩 실패, 다음 방법으로 시도합니다.", e); }
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
      return normalize({ rehearsals: reh, songs: sng, photos: pho, members: mem });
    } catch (e) { console.error("공개 시트 로딩 실패, data.json으로 대체합니다.", e); }
  }
  // 3) 데모
  const data = await fetch("data.json").then((r) => r.json());
  return normalize(data);
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
            ${r.time ? `<span>🕒 ${escapeHtml(r.time)}</span>` : ""}
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
      ${IS_ADMIN && p._row ? `<div class="photo-ctrls">
        <button class="ic-btn" data-edit="photo" data-row="${p._row}">✏️</button>
        <button class="ic-btn danger" data-del="photo" data-row="${p._row}">🗑️</button>
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

function renderAll() {
  renderRehearsals();
  renderSongs();
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
      { name: "time", label: "시간", type: "text", placeholder: "예: 14:00 - 18:00" },
      { name: "location", label: "장소", type: "text", placeholder: "예: 낙원상가 합주실 A룸" },
      { name: "address", label: "주소", type: "text", placeholder: "지도 검색용 (선택)" },
      { name: "songs", label: "연습곡", type: "text", placeholder: "세미콜론(;)으로 구분", list: true },
      { name: "attendees", label: "참석자", type: "text", placeholder: "세미콜론(;)으로 구분", list: true },
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
  photo: {
    title: "활동 사진",
    tab: TABS.photos,
    fields: [
      { name: "link", label: "구글 드라이브 공유 링크", type: "text", required: true,
        placeholder: "drive.google.com/file/d/... 형태" },
      { name: "caption", label: "설명", type: "text" },
      { name: "date", label: "날짜", type: "date" },
    ],
  },
};

let modalCtx = null; // { type, row|null }

function findRecord(type, row) {
  const key = type === "rehearsal" ? "rehearsals" : type === "song" ? "songs" : "photos";
  return STATE[key].find((x) => String(x._row) === String(row));
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
    if (f.list && Array.isArray(val)) val = val.join("; ");
    val = val == null ? "" : String(val);
    const ev = escapeHtml(val);
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
    values[f.name] = (form.elements[f.name].value || "").trim();
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
  await refresh();
  // 세션에 관리자 기록이 있으면 복원
  if (CFG.SCRIPT_URL && sessionStorage.getItem("sb_admin") === "1") setAdmin(true);
})();
