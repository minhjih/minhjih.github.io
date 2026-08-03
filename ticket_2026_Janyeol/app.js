// ===================================================================
//  잔열 (殘熱) 티켓 — 구매자 페이지
//  Google 로그인 → 구매 폼(계좌이체/카카오페이) → 입금확인 시 QR 자동 표시(실시간)
// ===================================================================
const CFG = window.JANYEOL_CONFIG || {};
const EV = CFG.EVENT || {};
const PRICE = Number(EV.price || 0);
const MAXQ = Number(EV.maxQuantity || 6);

const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { detectSessionInUrl: true, persistSession: true, flowType: "pkce" },
});

const $ = (s, el = document) => el.querySelector(s);
const won = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";
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

// ---------------- 정적 콘텐츠 ----------------
function renderStatic() {
  $("#bDate").textContent = EV.dateLabel || "";
  $("#bVenue").textContent = EV.venue || "";
  $("#bPrice").textContent = won(PRICE);
  $("#bAddr").textContent = EV.address || "";
  $("#fAddr").textContent = EV.address || "";
  document.title = `${EV.title || "공연"} · 공연 티켓`;

  // 포스터 (없으면 CSS 타이틀 히어로로 폴백)
  const pm = $("#posterMain");
  const src = (CFG.POSTER && CFG.POSTER.main) || "";
  if (src) {
    pm.src = src;
    pm.onerror = () => {
      pm.closest(".poster-frame").classList.add("hidden");
      $("#titleStack").classList.remove("hidden");
    };
  } else {
    pm.closest(".poster-frame").classList.add("hidden");
    $("#titleStack").classList.remove("hidden");
  }
  const pc = $("#posterCue");
  const csrc = (CFG.POSTER && CFG.POSTER.cue) || "";
  if (csrc) { pc.src = csrc; pc.onerror = () => pc.closest(".poster-frame").classList.add("hidden"); }
  else { pc.closest(".poster-frame").classList.add("hidden"); }

  // 큐시트
  const cue = $("#cueList");
  cue.innerHTML = (CFG.TIMETABLE || [])
    .map(
      (set) => `
    <div class="cue-set">
      <div class="cue-head">
        <span class="t">${esc(set.time)}</span>
        <span class="b">${esc(set.band)}</span>
        <span class="m">${esc(set.meta || "")}</span>
      </div>
      <ul class="cue-songs">
        ${set.songs
          .map(
            (s) =>
              `<li><span class="artist">${esc(s[0])}</span><span class="song">${esc(
                s[1]
              )}</span></li>`
          )
          .join("")}
      </ul>
    </div>`
    )
    .join("");
}

// ---------------- 상태 라벨 ----------------
const STATUS_LABEL = {
  pending: ["확인 대기", "status-pending"],
  confirmed: ["발급 완료", "status-confirmed"],
  used: ["입장 완료", "status-used"],
  cancelled: ["취소", "status-cancelled"],
};

// ---------------- 렌더: 로그인 전 ----------------
function renderLoggedOut() {
  $("#ticketArea").innerHTML = `
    <div class="card cta center">
      <div class="kicker" style="text-align:center;color:var(--gold);margin-bottom:8px">Ticket · 티켓 구매</div>
      <div class="buy-price">${won(PRICE)} <small>1인</small></div>
      <p class="hint" style="margin-top:10px">아래 버튼으로 <b>구글 로그인</b>하면 바로 티켓을 예매할 수 있어요.<br/>예매 → 입금 → 확인되면 <b>입장 QR</b>이 이 화면에 자동으로 떠요.</p>
      <button class="btn google" id="loginBtn">
        <svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.1 0 24 0 14.6 0 6.4 5.4 2.6 13.2l7.8 6.1C12.2 13.6 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.5z"/><path fill="#FBBC05" d="M10.4 28.3c-.5-1.4-.8-2.9-.8-4.3s.3-3 .8-4.3l-7.8-6.1C.9 16.7 0 20.2 0 24s.9 7.3 2.6 10.4l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.5l-7.1-5.5c-2 1.3-4.6 2.1-7.9 2.1-6.4 0-11.8-4.1-13.7-9.8l-7.8 6.1C6.4 42.6 14.6 48 24 48z"/></svg>
        구글 로그인하고 티켓 구매
      </button>
      <div class="notice">입금 확인은 <b>수동</b>으로 진행돼요. 확인까지 <b>최대 하루</b> 정도 걸릴 수 있어요. 확인되면 이 화면에 <b>입장 QR</b>이 자동으로 떠요.</div>
      <div class="err" id="authErr"></div>
    </div>`;
  $("#loginBtn").onclick = login;
}

async function login() {
  $("#authErr").textContent = "";
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.href.split("#")[0].split("?")[0] },
  });
  if (error) $("#authErr").textContent = "로그인 오류: " + error.message;
}

// ---------------- 렌더: 로그인 후 ----------------
let CURRENT_USER = null;

async function renderLoggedIn(user) {
  CURRENT_USER = user;
  const { data: orders, error } = await sb
    .from("tk_orders")
    .select("*")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });

  const area = $("#ticketArea");
  const name = user.user_metadata?.full_name || user.email;
  const bar = `<div class="userbar"><span><b>${esc(name)}</b></span>
      <button class="btn ghost small" id="logoutBtn" style="width:auto;margin:0;padding:6px 12px">로그아웃</button></div>`;

  if (error) {
    area.innerHTML = bar + `<div class="card"><div class="err">주문을 불러오지 못했습니다: ${esc(error.message)}</div></div>`;
    wireUserbar();
    return;
  }

  const active = (orders || []).filter((o) => ["pending", "confirmed", "used"].includes(o.status));

  let html = bar;
  if (active.length) {
    html += active.map(renderOrderCard).join("");
    html += `<button class="btn ghost" id="addMore">티켓 추가 구매</button>`;
    html += `<div id="buyMount" class="hidden"></div>`;
  } else {
    html += `<div id="buyMount"></div>`;
  }
  area.innerHTML = html;
  wireUserbar();

  if (active.length) {
    // QR 그리기
    active.forEach((o) => {
      if (o.status === "confirmed" && o.qr_token) drawQR(`qr-${o.id}`, o.qr_token);
    });
    wireOrderActions(active);
    $("#addMore").onclick = () => {
      $("#addMore").classList.add("hidden");
      $("#buyMount").classList.remove("hidden");
      mountBuyForm();
    };
  } else {
    mountBuyForm();
  }
}

function wireUserbar() {
  const b = $("#logoutBtn");
  if (b)
    b.onclick = async () => {
      await sb.auth.signOut();
      location.reload();
    };
}

function renderOrderCard(o) {
  const [label, cls] = STATUS_LABEL[o.status] || ["", ""];
  let body = "";
  if (o.status === "confirmed") {
    body = `
      <div class="qr-wrap">
        <div class="qr-box" id="qr-${o.id}"></div>
        <div class="qr-meta">${esc(o.buyer_name)} · ${o.quantity}인</div>
        <div class="qr-note">입장 시 이 QR을 확인자에게 보여주세요.<br/>확인되면 QR은 자동으로 만료됩니다. (화면 밝기 최대 권장)</div>
      </div>`;
  } else if (o.status === "used") {
    body = `<div class="center" style="padding:18px 0 6px">
        <div class="qr-meta" style="font-size:26px">입장 완료</div>
        <div class="qr-note">ENTERED · ${o.used_at ? new Date(o.used_at).toLocaleString("ko-KR") : ""}</div>
      </div>`;
  } else if (o.paid_at) {
    body = `<div class="pay-box" style="border-color:rgba(74,217,145,.4)">
        <div class="row"><span class="k">입금완료 신고</span><span class="v" style="color:var(--ok)">${new Date(o.paid_at).toLocaleString("ko-KR")}</span></div>
        <div class="row"><span class="k">상태</span><span class="v">관리자 확인 대기중</span></div>
      </div>
      <div class="notice">입금 확인은 <b>수동</b>이라 <b>최대 하루</b> 정도 걸릴 수 있어요. 확인이 끝나면 이 화면에 <b>입장 QR</b>이 자동으로 떠요. 잠시만 기다려 주세요.</div>
      <details style="margin-top:10px"><summary class="hint">입금 정보 다시 보기</summary>${paymentInstructionsHTML(o.method, o.amount)}</details>`;
  } else {
    body = `<p class="hint">아래 안내로 <b>${won(o.amount)}</b> 보낸 뒤 <b>‘입금 완료’</b>를 눌러주세요.<br/>동명이인 구분을 위해 완료 시각이 기록됩니다.</p>
      ${paymentInstructionsHTML(o.method, o.amount)}
      <button class="btn" data-pay="${o.id}">① 입금하기</button>
      <button class="btn ghost" data-paid="${o.id}" id="paidBtn-${o.id}" disabled>② 입금 완료했어요</button>
      <div class="notice">입금 확인은 <b>수동</b>이라 <b>최대 하루</b> 정도 걸릴 수 있어요. 확인되면 <b>입장 QR</b>이 자동으로 떠요.</div>`;
  }
  return `<div class="card">
      <h2>My Ticket · 내 티켓 <span class="status-pill ${cls} pill">${label}</span></h2>
      <div class="pay-box" style="margin-top:0">
        <div class="row"><span class="k">수량</span><span class="v">${o.quantity}인</span></div>
        <div class="row"><span class="k">금액</span><span class="v">${won(o.amount)}</span></div>
        <div class="row"><span class="k">결제</span><span class="v">${o.method === "kakao" ? "카카오페이" : "계좌이체"}</span></div>
      </div>
      ${body}
    </div>`;
}

function drawQR(elId, text) {
  const el = document.getElementById(elId);
  if (!el || !window.QRCode) return;
  el.innerHTML = "";
  new window.QRCode(el, {
    text,
    width: 220,
    height: 220,
    colorDark: "#111111",
    colorLight: "#ffffff",
    correctLevel: window.QRCode.CorrectLevel.M,
  });
}

// ---------------- 입금하기 / 입금완료 신고 ----------------
function wireOrderActions(orders) {
  orders.forEach((o) => {
    if (o.status !== "pending" || o.paid_at) return;
    const payBtn = document.querySelector(`[data-pay="${o.id}"]`);
    const paidBtn = document.getElementById(`paidBtn-${o.id}`);
    if (payBtn)
      payBtn.onclick = () => {
        const K = CFG.KAKAO || {}, B = CFG.BANK || {};
        if (o.method === "kakao" && K.link) {
          window.open(K.link, "_blank", "noopener");
        } else if (o.method === "bank") {
          const acc = (B.account || "").replace(/[^0-9]/g, "");
          if (acc && navigator.clipboard) navigator.clipboard.writeText(acc).catch(() => {});
          toast("계좌번호를 복사했어요");
        }
        if (paidBtn) { paidBtn.disabled = false; paidBtn.classList.remove("ghost"); }
      };
    if (paidBtn)
      paidBtn.onclick = async () => {
        paidBtn.disabled = true;
        paidBtn.textContent = "처리 중…";
        const { error } = await sb.from("tk_orders").update({ paid_at: new Date().toISOString() }).eq("id", o.id);
        if (error) {
          paidBtn.disabled = false;
          paidBtn.textContent = "② 입금 완료했어요";
          toast("실패: " + error.message);
          return;
        }
        toast("입금 완료를 알렸어요");
        await refresh();
      };
  });
}

// ---------------- 결제 안내 ----------------
function paymentInstructionsHTML(method, amount) {
  const B = CFG.BANK || {};
  const K = CFG.KAKAO || {};
  if (method === "kakao") {
    let inner = "";
    if (K.link) {
      inner += `<a class="btn" href="${esc(K.link)}" target="_blank" rel="noopener">카카오페이로 송금하기</a>`;
    }
    inner += `<div class="center"><img src="${esc(K.qrImage || "")}" alt="카카오페이 QR" style="max-width:200px;border-radius:12px;margin-top:10px" onerror="this.style.display='none'"/></div>`;
    inner += `<p class="hint center">위 카카오페이로 <b>${won(amount)}</b> 송금 후, 관리자가 확인하면 입장 QR이 발급됩니다.</p>`;
    return `<div class="pay-box">${inner}</div>`;
  }
  return `<div class="pay-box">
      <div class="row"><span class="k">은행</span><span class="v">${esc(B.bank || "")}</span></div>
      <div class="row"><span class="k">계좌번호</span><span class="v">${esc(B.account || "")}
        <button class="copy" data-copy="${esc((B.account || "").replace(/[^0-9]/g, ""))}">복사</button></span></div>
      <div class="row"><span class="k">예금주</span><span class="v">${esc(B.holder || "")}</span></div>
      <div class="row"><span class="k">보낼 금액</span><span class="v" style="color:var(--gold)">${won(amount)}</span></div>
    </div>
    <p class="hint">입금자명을 정확히 남겨주세요. 대조하여 확인 후 QR이 발급됩니다.</p>`;
}

// ---------------- 구매 폼 ----------------
let FORM = { method: "bank", qty: 1 };

function mountBuyForm() {
  FORM = { method: "bank", qty: 1 };
  const mount = $("#buyMount");
  const prefill = CURRENT_USER?.user_metadata?.full_name || "";
  mount.innerHTML = `
    <div class="card">
      <h2>Reserve · 티켓 예매</h2>
      <label class="fld">받는 분 이름 *</label>
      <input id="fName" placeholder="이름" value="${esc(prefill)}" autocomplete="name" />
      <label class="fld">연락처 *</label>
      <input id="fPhone" placeholder="010-0000-0000" inputmode="tel" autocomplete="tel" />

      <label class="fld">결제 방법 *</label>
      <div class="seg" id="segMethod">
        <button type="button" data-m="bank" class="on">계좌이체</button>
        <button type="button" data-m="kakao">카카오페이</button>
      </div>

      <label class="fld">입금자명 * <span style="font-weight:400;color:var(--dim)">(계좌/카카오에 찍히는 이름)</span></label>
      <input id="fDep" placeholder="입금자 이름" value="${esc(prefill)}" />

      <label class="fld">수량 *</label>
      <div class="qty">
        <button type="button" id="qMinus">−</button>
        <span class="n" id="qN">1</span>
        <button type="button" id="qPlus">+</button>
        <span class="hint" style="margin:0 0 0 6px">최대 ${MAXQ}인</span>
      </div>

      <div id="payArea"></div>

      <div class="total"><span class="lbl">총 금액</span><span class="amt" id="tAmt">${won(PRICE)}</span></div>
      <button class="btn" id="submitBtn">예매하기 · <span id="btnAmt">${won(PRICE)}</span></button>
      <div class="notice">예매 후 입금(송금)하고 <b>‘입금 완료’</b>를 눌러주세요. 입금 확인은 <b>수동</b>이라 <b>최대 하루</b> 정도 걸릴 수 있고, 확인되면 <b>입장 QR</b>이 자동으로 떠요.</div>
      <div class="err" id="formErr"></div>
    </div>`;

  const seg = $("#segMethod");
  seg.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      seg.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      FORM.method = b.dataset.m;
      updatePayArea();
    };
  });
  $("#qMinus").onclick = () => setQty(FORM.qty - 1);
  $("#qPlus").onclick = () => setQty(FORM.qty + 1);
  $("#submitBtn").onclick = submitOrder;
  updatePayArea();
  wireCopy(mount);
}

function setQty(q) {
  FORM.qty = Math.max(1, Math.min(MAXQ, q));
  $("#qN").textContent = FORM.qty;
  const amt = won(PRICE * FORM.qty);
  $("#tAmt").textContent = amt;
  $("#btnAmt").textContent = amt;
  updatePayArea();
}

function updatePayArea() {
  $("#payArea").innerHTML = paymentInstructionsHTML(FORM.method, PRICE * FORM.qty);
  wireCopy($("#payArea"));
}

function wireCopy(root) {
  root.querySelectorAll(".copy").forEach((b) => {
    b.onclick = async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        toast("복사되었습니다");
      } catch {
        toast(b.dataset.copy);
      }
    };
  });
}

async function submitOrder() {
  const name = $("#fName").value.trim();
  const dep = $("#fDep").value.trim();
  const phone = $("#fPhone").value.trim();
  const err = $("#formErr");
  err.textContent = "";
  if (!name) return (err.textContent = "받는 분 이름을 입력해주세요.");
  if (phone.replace(/[^0-9]/g, "").length < 9) return (err.textContent = "연락처를 정확히 입력해주세요.");
  if (!dep) return (err.textContent = "입금자명을 입력해주세요.");

  const btn = $("#submitBtn");
  btn.disabled = true;
  btn.textContent = "예매 중…";

  const { error } = await sb.from("tk_orders").insert({
    email: CURRENT_USER.email,
    buyer_name: name,
    phone: phone,
    depositor_name: dep,
    quantity: FORM.qty,
    method: FORM.method,
    amount: PRICE * FORM.qty,
    status: "pending",
  });

  if (error) {
    btn.disabled = false;
    btn.textContent = "예매하기";
    err.textContent = "예매 실패: " + error.message;
    return;
  }
  toast("예매 완료! 입금 확인을 기다려주세요.");
  await refresh();
}

// ---------------- 실시간 ----------------
let channel = null;
function subscribeRealtime(userId) {
  if (channel) sb.removeChannel(channel);
  channel = sb
    .channel("tk_orders_" + userId)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tk_orders", filter: `user_id=eq.${userId}` },
      () => refresh()
    )
    .subscribe();
}

// ---------------- 부팅 ----------------
async function refresh() {
  const { data } = await sb.auth.getUser();
  if (data?.user) await renderLoggedIn(data.user);
  else renderLoggedOut();
}

async function boot() {
  renderStatic();
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
