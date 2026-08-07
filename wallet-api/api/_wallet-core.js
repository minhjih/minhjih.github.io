import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export const DOWNLOAD_TOKEN_TTL_SECONDS = 60;

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function encryptionKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("WALLET_DOWNLOAD_SECRET must be at least 32 characters");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function createDownloadToken(snapshot, secret, nowSeconds = Math.floor(Date.now() / 1000), iv = randomBytes(12)) {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    exp: nowSeconds + DOWNLOAD_TOKEN_TTL_SECONDS,
    ticket: snapshot,
  }), "utf8");
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return [base64Url(iv), base64Url(encrypted), base64Url(cipher.getAuthTag())].join(".");
}

export function readDownloadToken(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) return null;

  try {
    const [iv, encrypted, tag] = parts.map((part) => Buffer.from(part, "base64url"));
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
    decipher.setAuthTag(tag);
    const decoded = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    const payload = JSON.parse(decoded);
    if (payload?.v !== 1 || typeof payload.exp !== "number" || payload.exp < nowSeconds) return null;
    if (!isEligibleSnapshot(payload.ticket)) return null;
    return payload.ticket;
  } catch {
    return null;
  }
}

export function isValidUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

export function isAllowedOrigin(origin, configuredOrigins) {
  if (!origin) return true;
  const allowed = configuredOrigins.split(",").map((item) => item.trim()).filter(Boolean);
  return allowed.includes(origin);
}

export function createTicketSnapshot(order) {
  const snapshot = {
    id: order?.id,
    buyer_name: String(order?.buyer_name || "-").slice(0, 80),
    quantity: Number(order?.quantity),
    status: order?.status,
    qr_token: order?.qr_token,
  };
  if (!isEligibleSnapshot(snapshot)) throw new Error("Order is not eligible for Wallet");
  return snapshot;
}

export function buildBarcode(ticket) {
  return {
    format: "PKBarcodeFormatQR",
    message: ticket.qr_token,
    messageEncoding: "utf-8",
  };
}

function isEligibleSnapshot(snapshot) {
  return Boolean(
    snapshot &&
    isValidUuid(snapshot.id) &&
    snapshot.status === "confirmed" &&
    Number.isInteger(snapshot.quantity) &&
    snapshot.quantity > 0 &&
    snapshot.quantity <= 20 &&
    typeof snapshot.buyer_name === "string" &&
    typeof snapshot.qr_token === "string" &&
    snapshot.qr_token.length > 0 &&
    snapshot.qr_token.length <= 512,
  );
}

function validIsoDate(value) {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

export function buildPassProps(ticket, env) {
  const eventTitle = env.WALLET_EVENT_TITLE || "잔열";
  const dateLabel = env.WALLET_EVENT_DATE_LABEL || "8.29 5:30PM";
  const venue = env.WALLET_EVENT_VENUE || "001 라이브홀";
  const venueRegion = env.WALLET_EVENT_REGION || "서울";
  const venueRoom = env.WALLET_EVENT_ROOM || venue;
  const performers = String(env.WALLET_EVENT_PERFORMERS || eventTitle)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const address = env.WALLET_EVENT_ADDRESS || "서울 마포구 월드컵로 140 지하1층";
  const website = env.WALLET_EVENT_URL || "https://minhjih.github.io/ticket_2026_Janyeol/";
  const relevantDate = validIsoDate(env.WALLET_EVENT_RELEVANT_ISO);
  const expirationDate = validIsoDate(env.WALLET_EVENT_EXPIRATION_ISO);

  return {
    formatVersion: 1,
    passTypeIdentifier: env.APPLE_PASS_TYPE_ID,
    teamIdentifier: env.APPLE_TEAM_ID,
    serialNumber: ticket.id,
    organizationName: eventTitle,
    description: `${eventTitle} 공연 입장 티켓`,
    logoText: eventTitle,
    eventLogoText: eventTitle,
    preferredStyleSchemes: ["posterEventTicket", "eventTicket"],
    backgroundColor: "rgb(18, 7, 10)",
    foregroundColor: "rgb(255, 236, 224)",
    labelColor: "rgb(230, 165, 60)",
    footerBackgroundColor: "rgb(18, 7, 10)",
    useAutomaticColors: true,
    sharingProhibited: true,
    ...(relevantDate ? { relevantDate } : {}),
    ...(expirationDate ? { expirationDate } : {}),
    semantics: {
      eventType: "PKEventTypeLivePerformance",
      eventName: eventTitle,
      ...(relevantDate ? { eventStartDate: relevantDate } : {}),
      venueName: venue,
      venueRegionName: venueRegion,
      venueRoom,
      performerNames: performers,
      attendeeName: ticket.buyer_name,
      admissionLevel: `${ticket.quantity}명`,
    },
    eventTicket: {
      headerFields: [{ key: "status", label: "STATUS", value: "CONFIRMED" }],
      primaryFields: [{ key: "event", label: "공연", value: eventTitle }],
      secondaryFields: [
        { key: "date", label: "일시", value: dateLabel },
        { key: "venue", label: "장소", value: venue },
      ],
      auxiliaryFields: [
        { key: "name", label: "예매자", value: ticket.buyer_name },
        { key: "quantity", label: "인원", value: `${ticket.quantity}명` },
      ],
      backFields: [
        { key: "address", label: "주소", value: address },
        { key: "admission", label: "입장 안내", value: "입장 시 이 패스의 QR을 확인자에게 보여주세요. 확인 후 QR은 재사용할 수 없습니다." },
        { key: "website", label: "예매 페이지", value: website },
      ],
    },
  };
}
