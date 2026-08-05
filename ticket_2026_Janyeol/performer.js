// ===================================================================
//  잔열 (殘熱) 티켓 — 공연자(밴드) 페이지
//  Google 로그인 → 공연자 신청(이름 + 밴드) → 운영진 승인 시 입장 QR 자동 표시
//  * 지불 없음(무료), 공연 정산(매출·인원)에는 포함되지 않음(channel='performer')
// ===================================================================
const CFG = window.JANYEOL_CONFIG || {};
const EV = CFG.EVENT || {};
const BANDS = (CFG.PERFORMER && CFG.PERFORMER.bands) || ["RIZZ", "심사숙곰", "BREMEN"];
const WALLET = CFG.APPLE_WALLET || {};

const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { detectSessionInUrl: true, persistSession: true, flowType: "pkce" },
});

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 1800);
}

// ---------------- QR 라이브러리 ----------------
let _qrLoad = null;
function ensureQRCode() {
  if (window.QRCode) return Promise.resolve(true);
  if (!_qrLoad) {
    _qrLoad = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
      s.integrity = "sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU";
      s.crossOrigin = "anonymous";
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  return _qrLoad;
}

async function drawQR(elId, text) {
  const ok = await ensureQRCode();
  const el = document.getElementById(elId);
  if (!ok || !el || !window.QRCode) return false;
  el.innerHTML = "";
  new window.QRCode(el, {
    text, width: 180, height: 180,
    colorDark: "#000000", colorLight: "#f4f4f4",
    correctLevel: window.QRCode.CorrectLevel.H,
  });
  return true;
}

// ---------------- 상태 라벨 ----------------
const STATUS_LABEL = {
  pending: ["승인 대기", "status-pending"],
  confirmed: ["발급 완료", "status-confirmed"],
  used: ["입장 완료", "status-used"],
  cancelled: ["취소", "status-cancelled"],
};

// ---------------- 로그인 전 ----------------
function renderLoggedOut() {
  $("#perfArea").innerHTML = `
    <div class="card cta center">
      <div class="kicker" style="text-align:center;color:var(--gold);margin-bottom:8px">Performer · 공연자 티켓</div>
      <div class="buy-price" style="font-size:26px">무료 초대 <small>공연자</small></div>
      <ul class="hint" style="margin-top:14px; text-align:left; padding-left:18px; line-height:1.75; display:flex; flex-direction:column; gap:6px;">
        <li>아래 버튼으로 <b>구글 로그인</b> 후, 이름과 소속 밴드를 선택해 신청하세요.</li>
        <li>공연자 티켓은 <b>지불이 필요 없어요.</b> 운영진이 확인하면 <b>입장 QR</b>이 이 화면에 자동으로 떠요.</li>
        <li>로그인해 두면 언제든 다시 들어와 <b>내 입장 QR</b>을 확인할 수 있어요.</li>
      </ul>
      <div id="gsiWrap" class="center" style="display:flex;justify-content:center;min-height:44px;margin-top:16px"></div>
      <button class="btn google" id="loginBtn" style="display:none">
        <svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.1 0 24 0 14.6 0 6.4 5.4 2.6 13.2l7.8 6.1C12.2 13.6 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.5z"/><path fill="#FBBC05" d="M10.4 28.3c-.5-1.4-.8-2.9-.8-4.3s.3-3 .8-4.3l-7.8-6.1C.9 16.7 0 20.2 0 24s.9 7.3 2.6 10.4l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.5l-7.1-5.5c-2 1.3-4.6 2.1-7.9 2.1-6.4 0-11.8-4.1-13.7-9.8l-7.8 6.1C6.4 42.6 14.6 48 24 48z"/></svg>
        구글 로그인하고 공연자 신청
      </button>
      <div class="err" id="authErr"></div>
    </div>`;
  $("#loginBtn").onclick = login;
  mountGoogle($("#gsiWrap")).then((ok) => {
    if (!ok) $("#loginBtn").style.display = "";
  });
}

async function login() {
  $("#authErr").textContent = "";
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.href.split("#")[0].split("?")[0] },
  });
  if (error) $("#authErr").textContent = "로그인 오류: " + error.message;
}

// 네이티브(GIS + ID 토큰)
async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function mountGoogle(container) {
  const CID = CFG.GOOGLE_CLIENT_ID || "";
  if (!CID || !container) return false;
  let tries = 0;
  while (!(window.google && google.accounts && google.accounts.id) && tries < 30) {
    await new Promise((r) => setTimeout(r, 150));
    tries++;
  }
  if (!(window.google && google.accounts && google.accounts.id)) return false;
  try {
    const rawNonce = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const hashedNonce = await sha256hex(rawNonce);
    google.accounts.id.initialize({
      client_id: CID,
      nonce: hashedNonce,
      auto_select: false,
      use_fedcm_for_prompt: true,
      callback: async (resp) => {
        $("#authErr").textContent = "";
        const { error } = await sb.auth.signInWithIdToken({
          provider: "google",
          token: resp.credential,
          nonce: rawNonce,
        });
        if (error) $("#authErr").textContent = "로그인 오류: " + error.message;
      },
    });
    container.innerHTML = "";
    google.accounts.id.renderButton(container, {
      type: "standard", theme: "filled_blue", size: "large",
      text: "continue_with", shape: "pill", logo_alignment: "center",
    });
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------- 로그인 후 ----------------
let CURRENT_USER = null;

async function renderLoggedIn(user) {
  CURRENT_USER = user;
  const { data: orders, error } = await sb
    .from("tk_orders")
    .select("id,buyer_name,depositor_name,quantity,status,qr_token,used_at,created_at,channel")
    .eq("user_id", user.id)
    .eq("channel", "performer")
    .in("status", ["pending", "confirmed", "used"])
    .order("created_at", { ascending: false });

  const area = $("#perfArea");
  const name = user.user_metadata?.full_name || user.email;
  const bar = `<div class="userbar"><span><b>${esc(name)}</b></span>
      <button class="btn ghost small" id="logoutBtn" style="width:auto;margin:0;padding:6px 12px">로그아웃</button></div>`;

  if (error) {
    area.innerHTML = bar + `<div class="card"><div class="err">신청 내역을 불러오지 못했습니다: ${esc(error.message)}</div></div>`;
    wireUserbar();
    return;
  }

  const active = orders || [];
  let html = bar;
  if (active.length) {
    html += active.map(renderPerfCard).join("");
  } else {
    html += `<div id="applyMount"></div>`;
  }
  area.innerHTML = html;
  wireUserbar();
  wireCopy(area);
  wireWallet(area);

  if (active.length) {
    active.forEach((o) => {
      if (o.status === "confirmed" && o.qr_token) drawQR(`qr-${o.id}`, o.qr_token);
    });
  } else {
    mountApplyForm();
  }
}

function wireUserbar() {
  const b = $("#logoutBtn");
  if (b) b.onclick = async () => { await sb.auth.signOut(); location.reload(); };
}

function wireCopy(root) {
  root.querySelectorAll(".copy").forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.copy || "";
      navigator.clipboard?.writeText(v).then(() => toast("코드를 복사했어요")).catch(() => {});
    };
  });
}

// ---------------- Apple 지갑 ----------------
function appleWalletButtonHTML(orderId) {
  if (!WALLET.enabled || !WALLET.endpoint || !WALLET.badgeImage) return "";
  return `<div class="apple-wallet-action">
    <button type="button" class="apple-wallet-btn" data-wallet-order-id="${esc(orderId)}" aria-label="Apple 지갑에 추가">
      <img src="${esc(WALLET.badgeImage)}" alt="Apple 지갑에 추가" />
    </button>
  </div>`;
}

function wireWallet(root) {
  root.querySelectorAll("[data-wallet-order-id]").forEach((b) => {
    b.onclick = () => addToAppleWallet(b.dataset.walletOrderId, b);
  });
}

async function addToAppleWallet(orderId, button) {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) throw new Error("로그인이 만료되었습니다. 다시 로그인해주세요.");

    const endpoint = new URL(WALLET.endpoint, location.href);
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ order_id: orderId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const messages = {
        order_not_found: "본인 티켓을 확인하지 못했습니다.",
        ticket_not_available: "발급 완료된 티켓만 지갑에 추가할 수 있습니다.",
        wallet_unavailable: "Apple 지갑 발급 서버를 사용할 수 없습니다.",
      };
      throw new Error(messages[result.error] || "Apple 지갑 티켓 발급에 실패했습니다.");
    }

    const downloadUrl = new URL(result.download_url);
    if (downloadUrl.origin !== endpoint.origin) throw new Error("잘못된 지갑 다운로드 주소입니다.");
    location.assign(downloadUrl.href);
  } catch (error) {
    toast(error instanceof Error ? error.message : "Apple 지갑 티켓 발급에 실패했습니다.");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function renderPerfCard(o) {
  const [label, cls] = STATUS_LABEL[o.status] || ["", ""];
  let body = "";
  if (o.status === "confirmed") {
    body = `
      <div class="tech-ticket">
        <div class="tech-ticket-head">
          <div>
            <div class="tech-ticket-title">${esc(EV.title || "JANYEOL")}</div>
            <div class="tech-ticket-sub">${esc(EV.dateLabel || "8.29 SAT 5:30PM")} · ${esc(EV.venue || "001 LIVE HALL")}</div>
          </div>
          <div class="tech-ticket-badge">PERFORMER</div>
        </div>
        <div class="tech-ticket-grid">
          <div class="tech-field"><span class="lbl">NAME</span><span class="val">${esc(o.buyer_name)}</span></div>
          <div class="tech-field"><span class="lbl">BAND</span><span class="val">${esc(o.depositor_name || "-")}</span></div>
          <div class="tech-field"><span class="lbl">TYPE</span><span class="val">공연자 초대</span></div>
          <div class="tech-field"><span class="lbl">STATUS</span><span class="val">VALID PASS</span></div>
        </div>
        <div class="tech-qr-section">
          <div class="tech-qr-box" id="qr-${o.id}"></div>
          <div class="tech-barcode">CODE: ${esc(o.qr_token)}</div>
        </div>
        <div class="tech-ticket-foot"><span>JANYEOL LIVE 2026</span><span>PERFORMER</span></div>
      </div>
      ${appleWalletButtonHTML(o.id)}
      <div class="qr-note" style="margin-top:12px;">입장 시 위 QR을 확인자에게 보여주세요.<br/>확인되면 QR은 자동으로 만료됩니다. (화면 밝기 최대 권장)</div>
      <div class="qr-code">코드 <code>${esc(o.qr_token)}</code> <button class="copy" data-copy="${esc(o.qr_token)}">복사</button></div>`;
  } else if (o.status === "used") {
    body = `<div class="center" style="padding:18px 0 6px">
        <div class="qr-meta" style="font-size:26px">입장 완료</div>
        <div class="qr-note">ENTERED · ${o.used_at ? new Date(o.used_at).toLocaleString("ko-KR") : ""}</div>
      </div>`;
  } else {
    body = `<div class="center" style="padding:6px 0 2px">
        <div class="qr-meta" style="font-size:22px">승인 대기중</div>
        <div class="qr-note">운영진 확인 후 입장 QR이 여기에 자동으로 떠요.</div>
      </div>
      <div class="tech-ticket-grid" style="margin-top:14px">
        <div class="tech-field"><span class="lbl">이름</span><span class="val">${esc(o.buyer_name)}</span></div>
        <div class="tech-field"><span class="lbl">밴드</span><span class="val">${esc(o.depositor_name || "-")}</span></div>
      </div>
      <div class="notice">공연자 확인은 <b>수동</b>이라 시간이 조금 걸릴 수 있어요. 승인되면 이 화면에 <b>입장 QR</b>이 자동으로 떠요.<br/><span style="color:var(--dim)">이 사이트에 <b style="color:var(--muted)">로그인하면 언제든 확인</b>할 수 있어요.</span></div>`;
  }
  return `<div class="card">
      <h2>공연자 티켓 <span class="status-pill ${cls} pill">${label}</span></h2>
      ${body}
    </div>`;
}

// ---------------- 신청 폼 ----------------
function mountApplyForm() {
  const mount = $("#applyMount");
  const prefill = CURRENT_USER?.user_metadata?.full_name || "";
  mount.innerHTML = `
    <div class="card">
      <label class="fld">이름(실명)*</label>
      <input id="pName" type="text" placeholder="예) 홍길동" value="${esc(prefill)}" autocomplete="name" />

      <label class="fld" style="margin-top:14px">소속 밴드*</label>
      <div id="bandSel" class="band-sel">
        ${BANDS.map((b, i) => `<button type="button" class="band-opt${i === 0 ? " on" : ""}" data-band="${esc(b)}">${esc(b)}</button>`).join("")}
      </div>

      <button class="btn" id="applyBtn" style="margin-top:18px">공연자 티켓 신청</button>
      <div class="err" id="applyErr"></div>
      <p class="hint" style="margin-top:10px">신청 후 운영진 확인이 완료되면 입장 QR이 발급됩니다. (지불 없음)</p>
    </div>`;

  let band = BANDS[0];
  mount.querySelectorAll(".band-opt").forEach((b) => {
    b.onclick = () => {
      mount.querySelectorAll(".band-opt").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      band = b.dataset.band;
    };
  });
  $("#applyBtn").onclick = () => submitApplication(() => band);
}

async function submitApplication(getBand) {
  const name = $("#pName").value.trim();
  const band = getBand();
  const err = $("#applyErr");
  err.textContent = "";
  if (!name) return (err.textContent = "이름을 입력해주세요.");
  if (!band) return (err.textContent = "밴드를 선택해주세요.");

  const btn = $("#applyBtn");
  btn.disabled = true;
  btn.textContent = "신청 중…";

  const { error } = await sb.from("tk_orders").insert({
    email: CURRENT_USER.email,
    buyer_name: name,
    depositor_name: band,
    quantity: 1,
    method: "invite",
    amount: 0,
    channel: "performer",
    status: "pending",
  });

  if (error) {
    btn.disabled = false;
    btn.textContent = "공연자 티켓 신청";
    err.textContent = "신청 실패: " + error.message;
    return;
  }
  toast("신청 완료! 운영진 확인을 기다려주세요.");
  await refresh();
}

// ---------------- 실시간 ----------------
let channel = null;
let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh(CURRENT_USER), 150);
}
function subscribeRealtime(userId) {
  if (channel) sb.removeChannel(channel);
  channel = sb
    .channel("tk_perf_" + userId)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "tk_orders", filter: `user_id=eq.${userId}` },
      scheduleRefresh)
    .subscribe();
}

// ---------------- 부팅 ----------------
async function refresh(user = CURRENT_USER) {
  if (user) return renderLoggedIn(user);
  const { data } = await sb.auth.getUser();
  if (data?.user) await renderLoggedIn(data.user);
  else renderLoggedOut();
}

async function boot() {
  const { data } = await sb.auth.getSession();
  if (data?.session?.user) {
    await sb.realtime.setAuth(data.session.access_token);
    subscribeRealtime(data.session.user.id);
    await renderLoggedIn(data.session.user);
  } else {
    renderLoggedOut();
  }

  sb.auth.onAuthStateChange(async (_evt, session) => {
    if (session?.user) {
      await sb.realtime.setAuth(session.access_token);
      subscribeRealtime(session.user.id);
      await renderLoggedIn(session.user);
    } else {
      renderLoggedOut();
    }
  });
}

boot();
