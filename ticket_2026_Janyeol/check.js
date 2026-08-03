// ===================================================================
//  자열 (自熱) 티켓 — 확인자(입구) 페이지
//  QR 스캔 → janyeol-desk 'checkin' → confirmed 면 소비(만료), used 면 이미 사용됨
// ===================================================================
const CFG = window.JANYEOL_CONFIG || {};
const FN_URL = `${CFG.SUPABASE_URL}/functions/v1/${CFG.DESK_FUNCTION || "janyeol-desk"}`;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
const fmt = (t) => (t ? new Date(t).toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");

let KEY = sessionStorage.getItem("janyeol_checkin_key") || "";
let WHO = sessionStorage.getItem("janyeol_checkin_who") || "";
let scanner = null;
let cameras = [];
let camIdx = 0;
let busy = false;
let paused = false;
let lastToken = "";

function toast(m) {
  const t = $("#toast");
  t.textContent = m; t.classList.add("show");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 1600);
}
function beep(ok) {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.06;
    o.start(); setTimeout(() => { o.stop(); ac.close(); }, ok ? 120 : 260);
  } catch {}
}
if (navigator.vibrate === undefined) navigator.vibrate = () => {};

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

const RESULT = {
  ok: (o) => ({ cls: "ok", big: "✅ 입장", who: `${esc(o.buyer_name)} · ${o.quantity}인`, sub: `${esc(o.email || "")}` }),
  already_used: (o) => ({ cls: "used", big: "⚠️ 이미 사용됨", who: `${esc(o.buyer_name)} · ${o.quantity}인`, sub: `사용시각 ${fmt(o.used_at)} · ${esc(o.checked_by || "")}` }),
  pending: () => ({ cls: "used", big: "⏳ 입금 미확인", who: "아직 발급되지 않은 티켓", sub: "관리자 입금확인 후 입장 가능" }),
  cancelled: () => ({ cls: "bad", big: "🚫 취소된 티켓", who: "", sub: "" }),
  invalid: () => ({ cls: "bad", big: "❌ 유효하지 않은 QR", who: "", sub: "우리 공연 티켓이 아닙니다" }),
};

function showResult(r) {
  const spec = (RESULT[r.result] || RESULT.invalid)(r.order || {});
  $("#result").innerHTML = `<div class="result ${spec.cls}">
      <p class="big">${spec.big}</p>
      ${spec.who ? `<div class="who">${spec.who}</div>` : ""}
      ${spec.sub ? `<div class="sub">${spec.sub}</div>` : ""}
    </div>`;
  const good = r.result === "ok";
  beep(good);
  navigator.vibrate(good ? 120 : [80, 60, 80]);
}

async function handleToken(token) {
  if (busy || paused) return;
  token = (token || "").trim();
  if (!token || token === lastToken) return;
  busy = true; paused = true; lastToken = token;
  $("#result").innerHTML = `<div class="result used"><p class="big">확인 중…</p></div>`;
  try {
    const r = await desk("checkin", { token, by: WHO || "확인자" });
    showResult(r);
  } catch (e) {
    $("#result").innerHTML = `<div class="result bad"><p class="big">오류</p><div class="sub">${esc(e.message)}</div></div>`;
  }
  busy = false;
  // 3초 뒤 자동 재개
  clearTimeout(handleToken._t);
  handleToken._t = setTimeout(nextScan, 3000);
}

function nextScan() {
  paused = false; lastToken = "";
  $("#result").innerHTML = `<div class="hint center" style="padding:8px">QR을 카메라에 비춰주세요…</div>`;
}

// ---------- 스캐너 ----------
async function startScanner() {
  if (scanner) return;
  scanner = new Html5Qrcode("reader", { verbose: false });
  try {
    cameras = await Html5Qrcode.getCameras();
  } catch { cameras = []; }
  // 후면 카메라 우선
  let camId = { facingMode: "environment" };
  if (cameras.length) {
    const back = cameras.findIndex((c) => /back|rear|environment|후면/i.test(c.label));
    camIdx = back >= 0 ? back : cameras.length - 1;
    camId = cameras[camIdx].id;
  }
  await scanner
    .start(camId, { fps: 10, qrbox: { width: 240, height: 240 } }, (txt) => handleToken(txt), () => {})
    .catch((e) => {
      $("#result").innerHTML = `<div class="result bad"><p class="big">카메라 오류</p><div class="sub">${esc(e.message || e)}<br/>브라우저 카메라 권한을 허용해주세요.</div></div>`;
    });
  nextScan();
}

async function switchCamera() {
  if (!cameras.length || !scanner) return toast("전환할 카메라가 없습니다");
  camIdx = (camIdx + 1) % cameras.length;
  try {
    await scanner.stop();
    await scanner.start(cameras[camIdx].id, { fps: 10, qrbox: { width: 240, height: 240 } }, (txt) => handleToken(txt), () => {});
    nextScan();
  } catch (e) { toast("전환 실패: " + e.message); }
}

// ---------- 로그인 ----------
async function enter() {
  const pw = $("#pw").value.trim();
  WHO = $("#who").value.trim();
  $("#gateErr").textContent = "";
  if (!pw) return;
  KEY = pw;
  try {
    await desk("peek", { token: "00000000-0000-0000-0000-000000000000" }); // 인증만 검증(invalid 반환돼도 200)
    sessionStorage.setItem("janyeol_checkin_key", KEY);
    sessionStorage.setItem("janyeol_checkin_who", WHO);
    $("#gate").classList.add("hidden");
    $("#scan").classList.remove("hidden");
    startScanner();
  } catch (e) {
    KEY = "";
    $("#gateErr").textContent = e.message === "unauthorized" ? "비밀번호가 올바르지 않습니다." : "오류: " + e.message;
  }
}

// ---------- 이벤트 ----------
$("#enterBtn").onclick = enter;
$("#pw").addEventListener("keydown", (e) => { if (e.key === "Enter") enter(); });
$("#nextBtn").onclick = nextScan;
$("#camBtn").onclick = switchCamera;
$("#manualBtn").onclick = () => { paused = false; lastToken = ""; handleToken($("#manual").value); };
$("#logoutBtn").onclick = async () => {
  if (scanner) { try { await scanner.stop(); } catch {} }
  sessionStorage.removeItem("janyeol_checkin_key");
  location.reload();
};

// 자동 시작(세션 키 있으면)
if (KEY) {
  desk("peek", { token: "00000000-0000-0000-0000-000000000000" })
    .then(() => {
      $("#who").value = WHO;
      $("#gate").classList.add("hidden");
      $("#scan").classList.remove("hidden");
      startScanner();
    })
    .catch(() => { sessionStorage.removeItem("janyeol_checkin_key"); KEY = ""; });
}
