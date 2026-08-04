// ===================================================================
//  잔열 (殘熱) 티켓 — 관리자(입금 확인) 페이지
//  비밀번호(tk_config.admin_key)로 엣지함수 janyeol-desk 호출
// ===================================================================
const CFG = window.JANYEOL_CONFIG || {};
const FN_URL = `${CFG.SUPABASE_URL}/functions/v1/${CFG.DESK_FUNCTION || "janyeol-desk"}`;
const $ = (s, el = document) => el.querySelector(s);
const won = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
const fmt = (t) => (t ? new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const methodLabel = (m) => (m === "qr" ? "뱅킹앱 송금" : m === "cash" ? "현금" : m === "kakao" ? "카카오페이" : "계좌이체");

let KEY = sessionStorage.getItem("janyeol_admin_key") || "";
let FILTER = "pending";
let ORDERS = [];

function toast(m) {
  const t = $("#toast");
  t.textContent = m; t.classList.add("show");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 1800);
}

async function desk(action, params = {}) {
  const res = await fetch(FN_URL, {
    method: "POST",
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

// ---------- 로그인 ----------
async function enter() {
  const pw = $("#pw").value.trim();
  $("#gateErr").textContent = "";
  if (!pw) return;
  KEY = pw;
  try {
    await desk("stats"); // 인증 검증
    sessionStorage.setItem("janyeol_admin_key", KEY);
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
    const [{ stats }, { orders }] = await Promise.all([desk("stats"), desk("list")]);
    ORDERS = orders || [];
    renderStats(stats);
    renderList();
  } catch (e) {
    toast("불러오기 실패: " + e.message);
  }
}

function renderStats(s) {
  s = s || {};
  $("#stats").innerHTML = `
    <div class="stat"><div class="v">${s.pending || 0}</div><div class="l">확인대기</div></div>
    <div class="stat"><div class="v">${(s.confirmed || 0) + (s.used || 0)}</div><div class="l">발급/입장</div></div>
    <div class="stat"><div class="v">${won(s.revenue || 0)}</div><div class="l">확정 매출 · ${s.people || 0}인</div></div>
    <div class="stat" style="grid-column:1/-1"><div class="v" style="font-size:17px">예매 ${s.presale_people || 0}인 · 현매 ${s.onsite_people || 0}인</div><div class="l">입장 확정 인원 구성</div></div>`;
}

function renderList() {
  const list = ORDERS.filter((o) => (FILTER === "all" ? o.status !== "cancelled" : o.status === FILTER));
  if (!list.length) {
    $("#list").innerHTML = `<div class="card center hint">해당 항목이 없습니다.</div>`;
    return;
  }
  $("#list").innerHTML = list.map(card).join("");
  $("#list").querySelectorAll("[data-act]").forEach((b) => {
    b.onclick = () => act(b.dataset.act, b.dataset.id, b);
  });
}

const SLABEL = {
  pending: ["확인대기", "status-pending"],
  confirmed: ["발급완료", "status-confirmed"],
  used: ["입장완료", "status-used"],
  cancelled: ["취소", "status-cancelled"],
};

function card(o) {
  const [lbl, cls] = SLABEL[o.status] || ["", ""];
  let acts = "";
  if (o.status === "pending") {
    acts = `<button class="btn small" data-act="confirm" data-id="${o.id}">입금확인 · QR 발급</button>
            <button class="btn ghost small" data-act="cancel" data-id="${o.id}">취소</button>`;
  } else if (o.status === "confirmed") {
    acts = `<button class="btn ghost small" data-act="reset" data-id="${o.id}">확인 취소(대기로)</button>
            <button class="btn ghost small" data-act="cancel" data-id="${o.id}">주문 취소</button>`;
  } else if (o.status === "used") {
    acts = `<span class="hint">입장: ${fmt(o.used_at)} · ${esc(o.checked_by || "")}</span>
            <button class="btn ghost small" data-act="reset" data-id="${o.id}">되돌리기</button>`;
  }
  return `<div class="order">
      <div class="top">
        <span class="nm">${esc(o.depositor_name || o.buyer_name)} <span style="font-weight:600;color:var(--muted);font-size:13px">· ${o.quantity}인</span></span>
        <span class="status-pill ${cls}">${lbl}</span>
      </div>
      <div class="meta">
        받는분 ${esc(o.buyer_name)}${o.phone ? " · " + esc(o.phone) : ""}<br/>
        <span style="font-weight:700;color:${o.channel === "onsite" ? "var(--gold)" : "var(--muted)"}">${o.channel === "onsite" ? "현매" : "예매"}</span> · <b style="color:var(--gold)">${won(o.amount)}</b> · ${methodLabel(o.method)} · ${fmt(o.created_at)}<br/>
        <span style="color:var(--dim);font-size:12px">${esc(o.email || "")}</span>
      </div>
      <div class="acts">${acts}</div>
    </div>`;
}

async function act(action, id, btn) {
  if (action === "cancel" && !confirm("이 주문을 취소할까요?")) return;
  if (action === "reset" && !confirm("입금확인을 취소하고 대기 상태로 되돌릴까요? (발급된 QR 무효화)")) return;
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = "처리중…";
  try {
    await desk(action, { order_id: id });
    toast(action === "confirm" ? "입금확인 · QR 발급 완료" : "처리되었습니다");
    await load();
  } catch (e) {
    btn.disabled = false; btn.textContent = old;
    toast("실패: " + e.message);
  }
}

// ---------- 명단 CSV 내보내기 ----------
function exportCsv() {
  if (!ORDERS.length) return toast("내보낼 명단이 없어요");
  const STL = { pending: "확인대기", confirmed: "발급완료", used: "입장완료", cancelled: "취소" };
  const cols = [
    ["channel", "구분"], ["status", "상태"], ["buyer_name", "이름"], ["depositor_name", "입금자명"],
    ["phone", "연락처"], ["email", "이메일(구글)"], ["quantity", "수량"], ["amount", "금액"],
    ["method", "결제수단"], ["created_at", "주문시각"],
    ["confirmed_at", "입금확인시각"], ["used_at", "입장시각"], ["checked_by", "확인자"],
  ];
  const cell = (v) => {
    let s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = [cols.map((c) => c[1]).join(",")];
  ORDERS.forEach((o) => {
    rows.push(cols.map(([k]) => {
      if (k === "channel") return cell(o.channel === "onsite" ? "현매" : "예매");
      if (k === "status") return cell(STL[o.status] || o.status);
      if (k === "method") return cell(methodLabel(o.method));
      if (["paid_at", "created_at", "confirmed_at", "used_at"].includes(k)) return cell(fmt(o[k]));
      return cell(o[k]);
    }).join(","));
  });
  const csv = "﻿" + rows.join("\r\n"); // BOM: 엑셀 한글 깨짐 방지
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const today = new Date().toLocaleDateString("sv").replace(/-/g, ""); // YYYYMMDD
  a.href = url;
  a.download = `janyeol_명단_${today}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`${ORDERS.length}건 CSV 내보냄`);
}

// ---------- 비밀번호 변경 ----------
async function changeKeys() {
  const na = prompt("새 관리자 비밀번호 (비우면 유지):", "");
  if (na === null) return;
  const nc = prompt("새 확인자(입구) 비밀번호 (비우면 유지):", "");
  if (nc === null) return;
  try {
    await desk("set_keys", { new_admin_key: na || undefined, new_checkin_key: nc || undefined });
    if (na) { KEY = na; sessionStorage.setItem("janyeol_admin_key", KEY); }
    toast("비밀번호가 변경되었습니다");
  } catch (e) {
    toast("변경 실패: " + e.message);
  }
}

// ---------- 이벤트 ----------
$("#enterBtn").onclick = enter;
$("#pw").addEventListener("keydown", (e) => { if (e.key === "Enter") enter(); });
$("#refreshBtn").onclick = load;
$("#csvBtn").onclick = exportCsv;
$("#keyBtn").onclick = changeKeys;
$("#logoutBtn").onclick = () => { sessionStorage.removeItem("janyeol_admin_key"); location.reload(); };
$("#tabs").querySelectorAll("button").forEach((b) => {
  b.onclick = () => {
    $("#tabs").querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on"); FILTER = b.dataset.f; renderList();
  };
});

// 자동 로그인(세션에 키 있으면)
if (KEY) {
  desk("stats").then(() => {
    $("#gate").classList.add("hidden");
    $("#dash").classList.remove("hidden");
    load();
  }).catch(() => { sessionStorage.removeItem("janyeol_admin_key"); KEY = ""; });
}
