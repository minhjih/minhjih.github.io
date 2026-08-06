// ===================================================================
//  잔열 (殘熱) 티켓 — 구매자 페이지
//  Google 로그인 → 구매 폼(계좌이체/뱅킹앱 송금 QR) → 입금확인 시 QR 자동 표시(실시간)
// ===================================================================
const CFG = window.JANYEOL_CONFIG || {};
const EV = CFG.EVENT || {};
const PRICE = Number(EV.price || 0);
const MAXQ = Number(EV.maxQuantity || 6);
const WALLET = CFG.APPLE_WALLET || {};
const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LOCAL_DEV_PREVIEW =
  LOCAL_DEV_HOSTS.has(window.location.hostname) &&
  new URLSearchParams(window.location.search).has("devtest");
const DEV_MODE = Boolean(CFG.DEV_MODE || LOCAL_DEV_PREVIEW);
const DEV_AUTO_CONFIRM = Boolean(CFG.DEV_AUTO_CONFIRM || LOCAL_DEV_PREVIEW);

const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { detectSessionInUrl: true, persistSession: true, flowType: "pkce" },
});

const $ = (s, el = document) => el.querySelector(s);
const won = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const SCRIPT_LOADS = {};

function loadScriptOnce(key, urls) {
  if (SCRIPT_LOADS[key]) return SCRIPT_LOADS[key];
  SCRIPT_LOADS[key] = new Promise((resolve, reject) => {
    let idx = 0;
    const next = () => {
      const spec = urls[idx++];
      if (!spec) {
        reject(new Error(`${key} 로드 실패`));
        return;
      }
      const src = typeof spec === "string" ? spec : spec.src;
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      if (typeof spec !== "string" && spec.integrity) {
        s.integrity = spec.integrity;
        s.crossOrigin = "anonymous";
      }
      s.onload = resolve;
      s.onerror = next;
      document.head.appendChild(s);
    };
    next();
  });
  return SCRIPT_LOADS[key];
}

async function ensureQRCode() {
  if (window.QRCode) return true;
  await loadScriptOnce("qrcode", [
    {
      src: "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
      integrity: "sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU",
    },
  ]);
  return !!window.QRCode;
}

async function ensureHtml2Canvas() {
  if (window.html2canvas) return true;
  await loadScriptOnce("html2canvas", [
    {
      src: "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
      integrity: "sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H",
    },
  ]);
  return !!window.html2canvas;
}

function setImageWithFallback(img, primary, fallback, onFinalError) {
  if (!img) return;
  const first = primary || fallback || "";
  if (!first) {
    onFinalError?.();
    return;
  }
  let triedFallback = false;
  img.onerror = () => {
    if (!triedFallback && fallback && fallback !== first) {
      triedFallback = true;
      img.src = fallback;
      return;
    }
    onFinalError?.();
  };
  img.src = first;
}

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
  const fallback = (CFG.POSTER && CFG.POSTER.mainFallback) || "";
  if (src || fallback) {
    setImageWithFallback(pm, src, fallback, () => {
      pm.closest(".poster-frame").classList.add("hidden");
      $("#titleStack").classList.remove("hidden");
    });
  } else {
    pm.closest(".poster-frame").classList.add("hidden");
    $("#titleStack").classList.remove("hidden");
  }
  const pc = $("#posterCue");
  const csrc = (CFG.POSTER && CFG.POSTER.cue) || "";
  const cfallback = (CFG.POSTER && CFG.POSTER.cueFallback) || "";
  if (csrc || cfallback) {
    setImageWithFallback(pc, csrc, cfallback, () => pc.closest(".poster-frame").classList.add("hidden"));
  }
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
      <ul class="hint" style="margin-top:14px; text-align:left; padding-left:18px; line-height:1.75; display:flex; flex-direction:column; gap:6px;">
        <li>아래 버튼으로 <b>구글 로그인</b>하면 티켓을 예매할 수 있어요.</li>
        <li>입금이 확인되면 <b>예매하신 이메일로 티켓과 링크</b>를 보내드려요. <b>📩 이메일을 꼭 확인해 주세요.</b></li>
        <li>메일을 못 받아도 걱정 마세요 — <b>이 사이트에 로그인하면 언제든 내 티켓·QR을 확인</b>할 수 있어요.</li>
        <li>로그인 시 화면에도 <b>입장 QR</b>이 자동으로 떠요. 당일 이 QR을 제시하면 입장돼요.</li>
        <li>입금 확인은 <b>수동</b>으로 진행되어, 확인까지 <b>최대 하루</b> 정도 걸릴 수 있어요.</li>
      </ul>
      <div id="gsiWrap" class="center" style="display:flex;justify-content:center;min-height:44px;margin-top:16px"></div>
      <button class="btn google" id="loginBtn" style="display:none">

        <svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.1 0 24 0 14.6 0 6.4 5.4 2.6 13.2l7.8 6.1C12.2 13.6 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.5z"/><path fill="#FBBC05" d="M10.4 28.3c-.5-1.4-.8-2.9-.8-4.3s.3-3 .8-4.3l-7.8-6.1C.9 16.7 0 20.2 0 24s.9 7.3 2.6 10.4l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.5l-7.1-5.5c-2 1.3-4.6 2.1-7.9 2.1-6.4 0-11.8-4.1-13.7-9.8l-7.8 6.1C6.4 42.6 14.6 48 24 48z"/></svg>
        구글 로그인하고 티켓 구매
      </button>
      <div class="err" id="authErr"></div>
    </div>`;
  $("#loginBtn").onclick = login;
  // 구글 Client ID가 있으면 네이티브(GIS) 버튼, 없으면 리다이렉트 버튼으로 폴백
  mountGoogle($("#gsiWrap")).then((ok) => {
    if (!ok) $("#loginBtn").style.display = "";
  });
}

// 리다이렉트 방식(폴백): supabase.co 화면을 거침
async function login() {
  $("#authErr").textContent = "";
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.href.split("#")[0].split("?")[0] },
  });
  if (error) $("#authErr").textContent = "로그인 오류: " + error.message;
}

// 네이티브 방식(GIS + ID 토큰): 우리 사이트에서 바로 구글 계정 선택 (supabase.co 노출 X)
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

// ---------------- 렌더: 로그인 후 ----------------
let CURRENT_USER = null;

async function renderLoggedIn(user) {
  CURRENT_USER = user;
  const { data: orders, error } = await sb
    .from("tk_orders")
    .select("id,buyer_name,quantity,amount,method,status,qr_token,used_at,created_at")
    .eq("user_id", user.id)
    .in("status", ["pending", "confirmed", "used"])
    .order("created_at", { ascending: false });

  const area = $("#ticketArea");
  const name = user.user_metadata?.full_name || user.email;
  const bar = `<div class="userbar"><span><b>${esc(name)}</b></span>
      <button class="btn ghost small" id="logoutBtn" style="width:auto;margin:0;padding:6px 12px">로그아웃</button></div>`;

  if (error && !DEV_MODE) {
    area.innerHTML = bar + `<div class="card"><div class="err">주문을 불러오지 못했습니다: ${esc(error.message)}</div></div>`;
    wireUserbar();
    return;
  }

  let active = orders || [];

  if (DEV_MODE && DEV_AUTO_CONFIRM && !active.length) {
    active = [
      {
        id: "mock-dev-ticket",
        buyer_name: user.user_metadata?.full_name || "테스트 사용자",
        quantity: 1,
        amount: PRICE,
        method: "bank",
        status: "confirmed",
        qr_token: "MOCK-DEV-QR-TOKEN-2026",
      },
    ];
  }

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
  wireCopy(area);
  wireTicketActions(area);

  if (active.length) {
    // QR 그리기
    active.forEach((o) => {
      if (o.status === "confirmed" && o.qr_token) {
        drawQR(`qr-${o.id}`, o.qr_token).then((ok) => {
          if (!ok) {
            setPassActionPending(`pass-${o.id}`, false);
            return;
          }
          // 저장용 이미지는 QR이 그려진 뒤 준비한다.
          void preparePass(`pass-${o.id}`);
        });
        // 공유 카드는 QR이 없으므로 먼저 준비해 공유 제스처를 보존한다.
        void preparePass(`share-${o.id}`);
      }
    });
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
      <div class="tech-ticket" id="pass-${o.id}">
        <div class="tech-ticket-head">
          <div>
            <div class="tech-ticket-title">${esc(EV.title || "JANYEOL")}</div>
            <div class="tech-ticket-sub">${esc(EV.dateLabel || "8.29 SAT 5:30PM")} · ${esc(EV.venue || "001 LIVE HALL")}</div>
          </div>
          <div class="tech-ticket-badge">CONFIRMED</div>
        </div>
        <div class="tech-ticket-grid">
          <div class="tech-field">
            <span class="lbl">NAME</span>
            <span class="val">${esc(o.buyer_name)}</span>
          </div>
          <div class="tech-field">
            <span class="lbl">QTY / PRICE</span>
            <span class="val">${o.quantity}인 (${won(o.amount)})</span>
          </div>
          <div class="tech-field">
            <span class="lbl">VENUE</span>
            <span class="val">${esc(EV.venue || "001 HALL")}</span>
          </div>
          <div class="tech-field">
            <span class="lbl">STATUS</span>
            <span class="val">VALID PASS</span>
          </div>
        </div>
        <div class="tech-qr-section">
          <div class="tech-qr-box" id="qr-${o.id}"></div>
          <div class="tech-barcode">CODE: ${esc(o.qr_token)}</div>
        </div>
        <div class="tech-ticket-foot">
          <span>JANYEOL LIVE 2026</span>
        </div>
      </div>
      
      <div class="ticket-btns">
        <button type="button" class="save-ticket-btn" data-save-pass="${esc(`pass-${o.id}`)}" data-buyer-name="${esc(o.buyer_name)}" disabled aria-busy="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          티켓 저장
        </button>
        <button type="button" class="share-ticket-btn" data-share-pass="${esc(`share-${o.id}`)}" data-buyer-name="${esc(o.buyer_name)}" disabled aria-busy="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>
          인스타 공유
        </button>
      </div>
      ${appleWalletButtonHTML(o.id)}

      <div class="qr-note" style="margin-top:12px;">입장 시 위 티켓 QR을 확인자에게 보여주세요.<br/>확인되면 QR은 자동으로 만료됩니다. (화면 밝기 최대 권장)</div>
      <div class="qr-code">코드 <code>${esc(o.qr_token)}</code> <button class="copy" data-copy="${esc(o.qr_token)}">복사</button></div>
      ${shareCardHTML(o)}`;
  } else if (o.status === "used") {
    body = `<div class="center" style="padding:18px 0 6px">
        <div class="qr-meta" style="font-size:26px">입장 완료</div>
        <div class="qr-note">ENTERED · ${o.used_at ? new Date(o.used_at).toLocaleString("ko-KR") : ""}</div>
      </div>`;
  } else {
    body = `<div class="center" style="padding:6px 0 2px">
        <div class="kicker" style="color:var(--gold)">STEP 2 · 입금</div>
        <div class="qr-meta" style="font-size:22px">여기로 입금해 주세요</div>
        <div class="qr-note">예매가 <b>접수</b>됐어요. 입금이 확인되면 이 화면에 <b>입장 QR</b>이 자동으로 떠요.</div>
      </div>
      ${paymentInstructionsHTML(o.method, o.amount)}
      <div class="notice">입금 확인은 <b>수동</b>이라 <b>최대 하루</b> 정도 걸릴 수 있어요. 확인되면 <b>예매하신 이메일로 티켓과 링크</b>를 보내드리고, 이 화면에도 <b>입장 QR</b>이 자동으로 떠요. <b>📩 이메일을 확인해 주세요.</b><br/><span style="color:var(--dim)">메일을 못 받아도 이 사이트에 <b style="color:var(--muted)">로그인하면 언제든 확인</b>할 수 있어요.</span></div>`;
  }
  return `<div class="card">
      <h2>My Ticket · 내 티켓 <span class="status-pill ${cls} pill">${label}</span></h2>
      ${body}
    </div>`;
}

function appleWalletButtonHTML(orderId) {
  if (!WALLET.enabled || !WALLET.endpoint || !WALLET.badgeImage) return "";
  return `<div class="apple-wallet-action">
    <button type="button" class="apple-wallet-btn" data-wallet-order-id="${esc(orderId)}" aria-label="Apple 지갑에 추가">
      <img src="${esc(WALLET.badgeImage)}" alt="Apple 지갑에 추가" />
    </button>
  </div>`;
}

// 인스타 공유용 카드(오프스크린): 티켓 모양 그대로, QR 자리에 "이미 크롭된" 티켓 이미지 배치(QR 없음).
// object-fit로 잘라넣지 않고, 준비된 이미지를 자연 비율(width 100%)로 그대로 → html2canvas 왜곡 없음.
function shareCardHTML(o) {
  const poster = (CFG.POSTER && (CFG.POSTER.ticket || CFG.POSTER.main)) || "";
  const fallback = (CFG.POSTER && (CFG.POSTER.ticketFallback || CFG.POSTER.mainFallback)) || "";
  return `
    <div style="position:fixed;left:-10000px;top:0;width:340px;pointer-events:none;" aria-hidden="true">
      <div class="tech-ticket" id="share-${o.id}">
        <div class="tech-ticket-head">
          <div>
            <div class="tech-ticket-title">${esc(EV.title || "JANYEOL")}</div>
            <div class="tech-ticket-sub">${esc(EV.dateLabel || "8.29 SAT 5:30PM")} · ${esc(EV.venue || "001 LIVE HALL")}</div>
          </div>
          <div class="tech-ticket-badge">SECURED</div>
        </div>
        <div class="tech-ticket-grid">
          <div class="tech-field"><span class="lbl">NAME</span><span class="val">${esc(o.buyer_name)}</span></div>
          <div class="tech-field"><span class="lbl">QTY</span><span class="val">${o.quantity}인</span></div>
          <div class="tech-field"><span class="lbl">DATE</span><span class="val">8.29 SAT</span></div>
          <div class="tech-field"><span class="lbl">VENUE</span><span class="val">${esc(EV.venue || "001 HALL")}</span></div>
        </div>
        <div class="share-poster">
          ${poster || fallback ? `<img class="share-poster-img" src="${esc(poster || fallback)}" alt="" crossorigin="anonymous" onerror="this.onerror=null;this.src='${esc(fallback)}'" />` : ""}
        </div>
        <div class="tech-ticket-foot"><span>JANYEOL LIVE 2026</span><span>ADMIT ${o.quantity}</span></div>
      </div>
    </div>`;
}

// 인스타 공유(=OS 공유 시트). QR 없는 포스터 카드라 공개해도 안전. 공유 카드는 JPEG.
async function shareTicketImage(shareElementId, buyerName) {
  const fileName = `잔열티켓_${buyerName || "잔열"}.jpg`;
  try {
    const ready = PASS_BLOBS[shareElementId];
    if (!ready) {
      toast("공유 이미지 준비 중…");
      const prepared = await preparePass(shareElementId);
      if (!prepared) throw new Error("이미지 변환 실패");
      toast("공유 이미지가 준비됐어요. 다시 눌러주세요");
      return;
    }

    if (navigator.share && navigator.canShare) {
      const blob = ready;
      const file = new File([blob], fileName, { type: "image/jpeg" });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            text: "잔열 8.29 (토) 5:30PM · 001 라이브홀 🎫 #잔열",
          });
          return;
        } catch (err) {
          if (err && err.name === "AbortError") return;
          console.warn("공유 시트를 열지 못해 이미지 저장으로 전환:", err);
        }
      }
    }

    if (isIOS() || !("download" in document.createElement("a"))) {
      showImagePreview(
        ready,
        "잔열 인스타 공유 이미지",
        "이미지를 길게 눌러 사진에 저장한 뒤 인스타 스토리에 올려주세요."
      );
    } else {
      downloadBlob(ready, fileName);
      toast("이미지를 저장했어요! 인스타 스토리에 올려보세요");
    }
  } catch (e) {
    console.error("공유 실패:", e);
    toast("공유 준비 실패: 다시 시도해주세요");
  }
}

async function drawQR(elId, text) {
  const el = document.getElementById(elId);
  if (!el) return false;
  try {
    const ready = await ensureQRCode();
    if (!ready) throw new Error("QRCode 전역 객체 없음");
  } catch (e) {
    console.error("QR 라이브러리 로드 실패:", e);
    el.innerHTML = `<div class="err">QR 생성 준비 실패</div>`;
    return false;
  }
  el.innerHTML = "";
  new window.QRCode(el, {
    text,
    width: 180,
    height: 180,
    colorDark: "#000000",
    colorLight: "#f4f4f4",
    correctLevel: window.QRCode.CorrectLevel.H,
  });
  return true;
}

const PASS_BLOBS = {};
const PASS_PREPARATIONS = {};

async function waitForRenderableAssets(el) {
  try { await document.fonts?.ready; } catch (_) {}
  const imgs = [...el.querySelectorAll("img")];
  await Promise.all(
    imgs.map((img) => {
      if (img.complete && img.naturalWidth) return Promise.resolve();
      if (img.decode) return img.decode().catch(() => {});
      return new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      });
    })
  );
}

async function renderPassBlob(passElementId, mime) {
  const passEl = document.getElementById(passElementId);
  if (!passEl) return null;
  try {
    const ready = await ensureHtml2Canvas();
    if (!ready) throw new Error("html2canvas 전역 객체 없음");
    await waitForRenderableAssets(passEl);
  } catch (e) {
    console.error("티켓 캡처 준비 실패:", e);
    return null;
  }
  const canvas = await window.html2canvas(passEl, {
    scale: 3, // 고해상도 저장
    backgroundColor: "#f4f4f4",
    useCORS: true,
    logging: false,
  });
  // 인스타는 PNG 업로드가 막혀 있어 공유 카드는 JPEG로 내보냄
  const type = mime || "image/png";
  return await new Promise((res) => canvas.toBlob(res, type, type === "image/jpeg" ? 0.95 : undefined));
}

// 공유 카드(share-*)는 JPEG, 티켓 저장(pass-*)은 PNG
const blobMime = (id) => (id.startsWith("share-") ? "image/jpeg" : "image/png");

function setPassActionPending(passElementId, pending) {
  const attr = passElementId.startsWith("share-") ? "data-share-pass" : "data-save-pass";
  const button = [...document.querySelectorAll(`[${attr}]`)]
    .find((candidate) => candidate.getAttribute(attr) === passElementId);
  if (!button) return;
  button.disabled = pending;
  if (pending) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
}

// 티켓 이미지를 미리 만들어 둠(공유 제스처 보존용)
async function preparePass(passElementId) {
  if (PASS_BLOBS[passElementId]) {
    setPassActionPending(passElementId, false);
    return PASS_BLOBS[passElementId];
  }
  if (!PASS_PREPARATIONS[passElementId]) {
    setPassActionPending(passElementId, true);
    PASS_PREPARATIONS[passElementId] = renderPassBlob(passElementId, blobMime(passElementId))
      .then((blob) => {
        if (blob) PASS_BLOBS[passElementId] = blob;
        return blob;
      })
      .catch((error) => {
        console.error("티켓 이미지 준비 실패:", error);
        return null;
      })
      .finally(() => {
        setPassActionPending(passElementId, false);
        delete PASS_PREPARATIONS[passElementId];
      });
  }
  return PASS_PREPARATIONS[passElementId];
}

const isIOS = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 6000);
}

let imagePreviewUrl = "";
let imagePreviewLastFocus = null;

function closeImagePreview() {
  const overlay = document.getElementById("imageSaveOverlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  document.body.classList.remove("image-preview-open");
  const image = overlay.querySelector("img");
  if (image) image.removeAttribute("src");
  if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  imagePreviewUrl = "";
  imagePreviewLastFocus?.focus?.();
  imagePreviewLastFocus = null;
}

function ensureImagePreview() {
  let overlay = document.getElementById("imageSaveOverlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "imageSaveOverlay";
  overlay.className = "image-save-overlay hidden";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "imageSaveHint");
  overlay.innerHTML = `
    <div class="image-save-sheet">
      <button type="button" class="image-save-close" aria-label="닫기">×</button>
      <img class="image-save-preview" alt="" />
      <p class="image-save-hint" id="imageSaveHint"></p>
    </div>`;
  overlay.querySelector(".image-save-close").onclick = closeImagePreview;
  overlay.onclick = (event) => {
    if (event.target === overlay) closeImagePreview();
  };
  overlay.onkeydown = (event) => {
    if (event.key === "Escape") closeImagePreview();
  };
  document.body.appendChild(overlay);
  return overlay;
}

function showImagePreview(blob, alt, message) {
  const overlay = ensureImagePreview();
  if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  imagePreviewUrl = URL.createObjectURL(blob);
  imagePreviewLastFocus = document.activeElement;
  const image = overlay.querySelector("img");
  image.src = imagePreviewUrl;
  image.alt = alt;
  overlay.querySelector(".image-save-hint").textContent = message;
  overlay.classList.remove("hidden");
  document.body.classList.add("image-preview-open");
  overlay.querySelector(".image-save-close").focus();
}

async function saveTicketImage(passElementId, buyerName) {
  const fileName = `티켓_${buyerName || "잔열"}.png`;
  try {
    let blob = PASS_BLOBS[passElementId];
    if (!blob) {
      toast("티켓 이미지 생성 중…");
      blob = await preparePass(passElementId);
    }
    if (!blob) throw new Error("이미지 변환 실패");

    // 저장 버튼은 공유 시트를 사용하지 않는다. iOS는 사진 저장 미리보기를 제공한다.
    if (isIOS() || !("download" in document.createElement("a"))) {
      showImagePreview(
        blob,
        "잔열 입장 티켓",
        "이미지를 길게 눌러 ‘사진에 저장’을 선택하세요."
      );
      return;
    }

    downloadBlob(blob, fileName);
    toast("티켓 사진이 저장되었습니다!");
  } catch (e) {
    console.error("티켓 저장 실패:", e);
    toast("저장 실패: 다시 시도해주세요");
  }
}

// ---------------- 결제 안내 ----------------
const methodLabel = (m) => (m === "qr" ? "뱅킹앱 송금" : m === "cash" ? "현금" : "계좌이체");

// 계좌 정보만 (QR/버튼 없이) — 대기 카드에서 사용
function accountBoxHTML(amount) {
  const B = CFG.BANK || {};
  const acct = (B.account || "").replace(/[^0-9]/g, "");
  return `<div class="pay-box">
      <div class="row"><span class="k">은행</span><span class="v">${esc(B.bank || "")}</span></div>
      <div class="row"><span class="k">계좌번호</span><span class="v">${esc(B.account || "")}
        <button class="copy" data-copy="${esc(acct)}">복사</button></span></div>
      ${B.holder ? `<div class="row"><span class="k">예금주</span><span class="v">${esc(B.holder)}</span></div>` : ""}
      <div class="row"><span class="k">보낼 금액</span><span class="v" style="color:var(--gold)">${won(amount)}</span></div>
    </div>`;
}

function paymentInstructionsHTML(method, amount) {
  const B = CFG.BANK || {};
  const T = CFG.TRANSFER || {};
  const acct = (B.account || "").replace(/[^0-9]/g, "");
  const tossBankCode = B.tossBankCode || "TOSS";
  const tossDeepLink = `supertoss://send?bank=${encodeURIComponent(tossBankCode)}&accountNo=${encodeURIComponent(acct)}&amount=${amount}`;

  const acctRows = `
      <div class="row"><span class="k">은행</span><span class="v">${esc(B.bank || "")}</span></div>
      <div class="row"><span class="k">계좌번호</span><span class="v">${esc(B.account || "")}
        <button class="copy" data-copy="${esc(acct)}">복사</button></span></div>
      ${B.holder ? `<div class="row"><span class="k">예금주</span><span class="v">${esc(B.holder)}</span></div>` : ""}
      <div class="row"><span class="k">보낼 금액</span><span class="v" style="color:var(--gold)">${won(amount)}</span></div>`;
  const depositHint = `<p class="hint">입금자명을 정확히 남겨주세요. 대조하여 확인 후 QR이 발급됩니다.</p>`;

  if (method === "qr") {
    // 뱅킹앱 QR: 카메라 스캔 + 'QR 링크로 이동하기' 버튼 (토스 버튼 없음)
    return `<div class="pay-box">
      ${T.qrImage ? `<div class="center"><img src="${esc(T.qrImage)}" alt="송금 QR" style="max-width:230px;border-radius:12px" onerror="this.parentNode.style.display='none'"/></div>
      <p class="hint center"><b>휴대폰 카메라로 이 송금용 QR을 스캔</b>해 송금하세요.<br/><span style="color:var(--dim)">(공연 입장용 <b style="color:var(--muted)">티켓 QR</b>은 이 QR과 달라요. 입금 확인 후 로그인 화면에 따로 떠요.)</span></p>` : ""}
      ${T.link ? `<p class="hint center" style="margin-top:2px">혹은 아래 버튼을 눌러 <b>뱅킹앱에서 바로 송금</b>할 수 있어요.</p>
      <a class="linkout-btn" href="${esc(T.link)}" target="_blank" rel="noopener"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>QR 링크로 이동하기</a>` : ""}
      ${acctRows}
    </div>
    ${depositHint}`;
  }

  // 계좌번호: 계좌 복사가 기본, 아래에 '또는 간편하게' 구분 + 토스 버튼(분리)
  const tossBtn = acct
    ? `<button type="button" class="toss-btn" onclick="window.location.href='${tossDeepLink}'">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
        토스앱으로 간편하게 입금하기
      </button>`
    : "";
  return `<div class="pay-box">${acctRows}
    </div>
    ${tossBtn ? `<div class="pay-or">또는 간편하게</div>${tossBtn}` : ""}
    ${depositHint}`;
}

// ---------------- 구매 폼 ----------------
let FORM = { method: "bank", qty: 1 };

function mountBuyForm() {
  FORM = { method: "bank", qty: 1 };
  const mount = $("#buyMount");
  const prefill = CURRENT_USER?.user_metadata?.full_name || "";
  mount.innerHTML = `
    <div class="card">
      <div class="kicker" style="color:var(--gold);margin-bottom:6px">STEP 1 · 예매 접수</div>
      <label class="fld">예매자 실명*</label>
      <input id="fName" placeholder="이름" value="${esc(prefill)}" autocomplete="name" />

      <label class="fld">연락처 *</label>
      <input id="fPhone" placeholder="010-0000-0000" inputmode="tel" autocomplete="tel" />

      <label class="fld">결제 방법 *</label>
      <div class="seg" id="segMethod">
        <button type="button" data-m="bank" class="on">계좌번호</button>
        <button type="button" data-m="qr">뱅킹앱 QR</button>
      </div>

      <label class="fld">입금자명 *</label>
      <input id="fDep" placeholder="입금자 이름" value="${esc(prefill)}" />

      <label class="fld">수량 *</label>
      <div class="qty">
        <button type="button" id="qMinus">−</button>
        <span class="n" id="qN">1</span>
        <button type="button" id="qPlus">+</button>
        <span class="hint" style="margin:0 0 0 6px">최대 ${MAXQ}인</span>
      </div>

      <div class="total"><span class="lbl">총 금액</span><span class="amt" id="tAmt">${won(PRICE)}</span></div>
      <button class="btn" id="submitBtn">입금 단계로 넘어가기 · <span id="btnAmt">${won(PRICE)}</span></button>
      <div class="notice">먼저 예매자 정보를 <b>접수</b>하면, 다음 화면에서 <b>입금 방법(계좌·송금 QR)</b>을 안내해 드려요. <b>지금 접수해두면 기록이 남아</b> 혹시 입금 확인이 늦어도 안전하게 처리돼요.<br/><span style="color:var(--dim)">아직 송금하지 않아도 괜찮아요 — 접수 후 안내대로 입금하시면 됩니다.</span></div>
      <div class="notice">현장 예매도 가능합니다.</div>
      <div class="err" id="formErr"></div>
    </div>`;

  const seg = $("#segMethod");
  seg.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      seg.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      FORM.method = b.dataset.m;
    };
  });
  $("#qMinus").onclick = () => setQty(FORM.qty - 1);
  $("#qPlus").onclick = () => setQty(FORM.qty + 1);
  $("#submitBtn").onclick = submitOrder;
}

function setQty(q) {
  FORM.qty = Math.max(1, Math.min(MAXQ, q));
  $("#qN").textContent = FORM.qty;
  const amt = won(PRICE * FORM.qty);
  $("#tAmt").textContent = amt;
  $("#btnAmt").textContent = amt;
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

function wireTicketActions(root) {
  root.querySelectorAll("[data-save-pass]").forEach((b) => {
    b.onclick = () => saveTicketImage(b.dataset.savePass, b.dataset.buyerName || "");
  });
  root.querySelectorAll("[data-share-pass]").forEach((b) => {
    b.onclick = () => shareTicketImage(b.dataset.sharePass, b.dataset.buyerName || "");
  });
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
  btn.textContent = "접수 중…";

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
    btn.textContent = "입금 단계로 넘어가기";
    err.textContent = "접수 실패: " + error.message;
    return;
  }
  toast("접수 완료! 아래 안내대로 입금해 주세요.");
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
    .channel("tk_orders_" + userId)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tk_orders", filter: `user_id=eq.${userId}` },
      scheduleRefresh
    )
    .subscribe();
}

// ---------------- 부팅 ----------------
const MOCK_DEV_USER = {
  id: "dev-local-user",
  email: "dev@local.test",
  user_metadata: { full_name: "테스트 사용자 (DEV)" },
};

async function refresh(user = CURRENT_USER) {
  if (user) {
    await renderLoggedIn(user);
    return;
  }
  const { data } = await sb.auth.getUser();
  if (data?.user) {
    await renderLoggedIn(data.user);
  } else if (DEV_MODE) {
    await renderLoggedIn(MOCK_DEV_USER);
  } else {
    renderLoggedOut();
  }
}

async function boot() {
  renderStatic();
  const { data } = await sb.auth.getSession();
  if (data?.session?.user) {
    await sb.realtime.setAuth(data.session.access_token);
    subscribeRealtime(data.session.user.id);
    await renderLoggedIn(data.session.user);
  } else if (DEV_MODE) {
    await renderLoggedIn(MOCK_DEV_USER);
  } else {
    renderLoggedOut();
  }

  sb.auth.onAuthStateChange(async (_evt, session) => {
    if (session?.user) {
      await sb.realtime.setAuth(session.access_token);
      subscribeRealtime(session.user.id);
      await renderLoggedIn(session.user);
    } else if (DEV_MODE) {
      await renderLoggedIn(MOCK_DEV_USER);
    } else {
      renderLoggedOut();
    }
  });
}

boot();
