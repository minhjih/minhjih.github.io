// ===================================================================
//  잔열 (殘熱) 티켓 — 예매자 명단 조회(읽기 전용)
//  view_key(명단 보기 비밀번호)로 엣지함수 janyeol-desk 'roster' 호출
//  * 수정/발급 권한 없음 — 목록 조회만 가능
// ===================================================================
const CFG = window.JANYEOL_CONFIG || {};
const FN_URL = `${CFG.SUPABASE_URL}/functions/v1/${CFG.DESK_FUNCTION || "janyeol-desk"}`;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
const fmt = (t) => (t ? new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const channelLabel = (c) => (c === "onsite" ? "현매" : c === "performer" ? "공연자" : "예매");
const channelCls = (c) => (c === "onsite" ? "ch-onsite" : c === "performer" ? "ch-performer" : "ch-presale");
const SLABEL = { pending: ["대기", "status-pending"], confirmed: ["발급", "status-confirmed"], used: ["입장", "status-used"], cancelled: ["취소", "status-cancelled"] };

let KEY = sessionStorage.getItem("janyeol_view_key") || "";
let ROWS = [];
let FILTER = "all";
let Q = "";

function toast(m) {
  const t = $("#toast");
  t.textContent = m; t.classList.add("show");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 1800);
}

async function desk(action, params = {}) {
  const res = await fetch(FN_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      apikey: CFG.SUPABASE_ANON_KEY,
      Authorization: "Bearer " + CFG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ action, key: KEY, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}

// ---------- 로그인(읽기 전용 비밀번호) ----------
async function enter() {
  const pw = $("#pw").value.trim();
  $("#gateErr").textContent = "";
  if (!pw) return;
  KEY = pw;
  try {
    await desk("roster"); // 인증 검증
    sessionStorage.setItem("janyeol_view_key", KEY);
    $("#gate").classList.add("hidden");
    $("#dash").classList.remove("hidden");
    await load();
  } catch (e) {
    KEY = "";
    $("#gateErr").textContent = e.message === "unauthorized" ? "비밀번호가 올바르지 않습니다." : "오류: " + e.message;
  }
}

// ---------- 데이터 ----------
async function load() {
  try {
    const { orders } = await desk("roster");
    ROWS = orders || [];
    renderSummary();
    renderTable();
  } catch (e) {
    toast("불러오기 실패: " + e.message);
  }
}

function summarize() {
  const s = { presale: 0, onsite: 0, performer: 0, pendingOrders: 0, performerPending: 0, totalOrders: 0 };
  for (const o of ROWS) {
    if (o.status === "cancelled") continue;
    s.totalOrders++;
    const active = o.status === "confirmed" || o.status === "used";
    if (o.channel === "performer") {
      if (active) s.performer += o.quantity;
      if (o.status === "pending") { s.performerPending += o.quantity; s.pendingOrders++; }
      continue;
    }
    if (active) {
      if (o.channel === "onsite") s.onsite += o.quantity; else s.presale += o.quantity;
    } else if (o.status === "pending") {
      s.pendingOrders++;
    }
  }
  return s;
}

function renderSummary() {
  const s = summarize();
  const paying = s.presale + s.onsite;
  $("#summary").innerHTML = `
    <div class="stat"><div class="v">${paying}</div><div class="l">확정 입장 인원(유료)</div></div>
    <div class="stat"><div class="v">${s.pendingOrders}</div><div class="l">확인 대기(건)</div></div>
    <div class="stat" style="grid-column:1/-1"><div class="v" style="font-size:16px">예매 ${s.presale}인 · 현매 ${s.onsite}인 · <span style="color:var(--fire)">공연자 ${s.performer}인</span></div><div class="l">확정 인원 구성 · 공연자는 정산(매출) 제외</div></div>`;
}

function matches(o) {
  if (o.status === "cancelled") return false;
  if (FILTER === "confirmed" && !(o.status === "confirmed" || o.status === "used")) return false;
  if (FILTER === "pending" && o.status !== "pending") return false;
  if (FILTER === "performer" && o.channel !== "performer") return false;
  if (Q) {
    const hay = `${o.buyer_name || ""} ${o.depositor_name || ""}`.toLowerCase();
    if (!hay.includes(Q)) return false;
  }
  return true;
}

function renderTable() {
  const list = ROWS.filter(matches);
  if (!list.length) {
    $("#rosterWrap").innerHTML = `<div class="card center hint">해당하는 예매자가 없습니다.</div>`;
    return;
  }
  const rows = list.map((o, i) => {
    const [lbl, cls] = SLABEL[o.status] || ["", ""];
    const isPerf = o.channel === "performer";
    const name = esc(o.buyer_name || "-");
    const extra = isPerf ? `밴드 ${esc(o.depositor_name || "-")}` : (o.depositor_name && o.depositor_name !== o.buyer_name ? `입금 ${esc(o.depositor_name)}` : "");
    return `<tr>
      <td class="idx">${i + 1}</td>
      <td class="nm">${name}${extra ? `<span class="sub">${extra}</span>` : ""}${o.phone ? `<span class="sub">${esc(o.phone)}</span>` : ""}</td>
      <td><span class="ch ${channelCls(o.channel)}">${channelLabel(o.channel)}</span></td>
      <td class="qty">${o.quantity}</td>
      <td><span class="status-pill ${cls}">${lbl}</span></td>
      <td class="tm">${fmt(o.created_at)}</td>
    </tr>`;
  }).join("");
  $("#rosterWrap").innerHTML = `
    <div class="roster-scroll">
      <table class="roster-table">
        <thead><tr><th>#</th><th>이름</th><th>구분</th><th>인원</th><th>상태</th><th>주문시각</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="hint" style="margin-top:10px">표시 ${list.length}명 · 전체 ${ROWS.filter((o) => o.status !== "cancelled").length}건 (읽기 전용)</div>`;
}

// ---------- 이벤트 ----------
$("#enterBtn").onclick = enter;
$("#pw").addEventListener("keydown", (e) => { if (e.key === "Enter") enter(); });
$("#refreshBtn").onclick = load;
$("#logoutBtn").onclick = () => { sessionStorage.removeItem("janyeol_view_key"); location.reload(); };
$("#search").addEventListener("input", (e) => { Q = e.target.value.trim().toLowerCase(); renderTable(); });
$("#tabs").querySelectorAll("button").forEach((b) => {
  b.onclick = () => {
    $("#tabs").querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on"); FILTER = b.dataset.f; renderTable();
  };
});

// 자동 로그인(세션에 키 있으면)
if (KEY) {
  desk("roster").then(() => {
    $("#gate").classList.add("hidden");
    $("#dash").classList.remove("hidden");
    load();
  }).catch(() => { sessionStorage.removeItem("janyeol_view_key"); KEY = ""; });
}
