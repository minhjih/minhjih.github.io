import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { PKPass } from "passkit-generator";
import {
  buildPassProps,
  createDownloadToken,
  createTicketSnapshot,
  isAllowedOrigin,
  isValidUuid,
  readDownloadToken,
} from "./_wallet-core.js";

export const runtime = "nodejs";
export const maxDuration = 10;

const DEFAULT_ALLOWED_ORIGINS = [
  "https://minhjih.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
].join(",");
const ORDER_COLUMNS = "id,buyer_name,quantity,status,qr_token";
const PASS_ASSET_NAMES = [
  "icon.png",
  "icon@2x.png",
  "icon@3x.png",
  "artwork.png",
  "artwork@2x.png",
  "artwork@3x.png",
  "background.png",
  "background@2x.png",
  "background@3x.png",
  "thumbnail.png",
  "thumbnail@2x.png",
  "thumbnail@3x.png",
];

let assetBuffersPromise;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function corsHeaders(origin) {
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

function jsonResponse(body, status, origin) {
  return Response.json(body, { status, headers: corsHeaders(origin) });
}

function allowedOrigin(request) {
  const origin = request.headers.get("origin");
  const configured = process.env.WALLET_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS;
  return { origin, allowed: isAllowedOrigin(origin, configured) };
}

async function loadPassAssets() {
  if (!assetBuffersPromise) {
    assetBuffersPromise = Promise.all(
      PASS_ASSET_NAMES.map((name) => readFile(new URL(`./assets/${name}`, import.meta.url))),
    ).then((buffers) => Object.fromEntries(
      PASS_ASSET_NAMES.map((name, index) => [name, buffers[index]]),
    ));
  }
  return assetBuffersPromise;
}

function certificateBuffers() {
  const decode = (name) => Buffer.from(requiredEnv(name), "base64");
  return {
    wwdr: decode("APPLE_WWDR_CERT_BASE64"),
    signerCert: decode("APPLE_SIGNER_CERT_BASE64"),
    signerKey: decode("APPLE_SIGNER_KEY_BASE64"),
    signerKeyPassphrase: process.env.APPLE_SIGNER_KEY_PASSPHRASE || undefined,
  };
}

function passEnvironment() {
  const values = [
    "APPLE_PASS_TYPE_ID",
    "APPLE_TEAM_ID",
    "WALLET_EVENT_TITLE",
    "WALLET_EVENT_DATE_LABEL",
    "WALLET_EVENT_VENUE",
    "WALLET_EVENT_REGION",
    "WALLET_EVENT_ROOM",
    "WALLET_EVENT_PERFORMERS",
    "WALLET_EVENT_ADDRESS",
    "WALLET_EVENT_URL",
    "WALLET_EVENT_RELEVANT_ISO",
    "WALLET_EVENT_EXPIRATION_ISO",
  ];
  return Object.fromEntries(values.map((name) => [name, process.env[name]]));
}

async function buildPass(ticket) {
  requiredEnv("APPLE_PASS_TYPE_ID");
  requiredEnv("APPLE_TEAM_ID");
  const passJson = buildPassProps(ticket, passEnvironment());
  const pass = new PKPass(
    {
      ...await loadPassAssets(),
      "pass.json": Buffer.from(JSON.stringify(passJson), "utf8"),
    },
    certificateBuffers(),
  );
  pass.setBarcodes({
    format: "PKBarcodeFormatQR",
    message: ticket.qr_token,
    messageEncoding: "utf-8",
    altText: ticket.qr_token,
  });
  return pass.getAsBuffer();
}

async function authenticatedOrder(request, orderId) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/+$/u, "");
  const anonKey = requiredEnv("SUPABASE_ANON_KEY");
  const authHeaders = { apikey: anonKey, Authorization: authorization };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: authHeaders, cache: "no-store" });
  if (!userResponse.ok) return null;
  const user = await userResponse.json();
  if (!isValidUuid(user?.id)) return null;

  const ordersUrl = new URL(`${supabaseUrl}/rest/v1/tk_orders`);
  ordersUrl.searchParams.set("select", ORDER_COLUMNS);
  ordersUrl.searchParams.set("id", `eq.${orderId}`);
  ordersUrl.searchParams.set("user_id", `eq.${user.id}`);
  ordersUrl.searchParams.set("limit", "1");
  const orderResponse = await fetch(ordersUrl, { headers: authHeaders, cache: "no-store" });
  if (!orderResponse.ok) return null;
  const orders = await orderResponse.json();
  return Array.isArray(orders) ? orders[0] || null : null;
}

export function OPTIONS(request) {
  const { origin, allowed } = allowedOrigin(request);
  if (!allowed) return jsonResponse({ error: "origin_not_allowed" }, 403, null);
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request) {
  const { origin, allowed } = allowedOrigin(request);
  if (!allowed) return jsonResponse({ error: "origin_not_allowed" }, 403, null);

  try {
    const body = await request.json();
    if (!isValidUuid(body?.order_id)) return jsonResponse({ error: "invalid_order" }, 400, origin);
    const order = await authenticatedOrder(request, body.order_id);
    if (!order) return jsonResponse({ error: "order_not_found" }, 404, origin);

    let ticket;
    try {
      ticket = createTicketSnapshot(order);
    } catch {
      return jsonResponse({ error: "ticket_not_available" }, 409, origin);
    }

    const token = createDownloadToken(ticket, requiredEnv("WALLET_DOWNLOAD_SECRET"));
    const downloadUrl = new URL(request.url);
    downloadUrl.search = new URLSearchParams({ token }).toString();
    return jsonResponse({ download_url: downloadUrl.toString() }, 200, origin);
  } catch (error) {
    console.error("janyeol-wallet POST failed", error instanceof Error ? error.message : error);
    return jsonResponse({ error: "wallet_unavailable" }, 503, origin);
  }
}

export async function GET(request) {
  const { allowed } = allowedOrigin(request);
  if (!allowed) return new Response("Forbidden", { status: 403 });

  try {
    const token = new URL(request.url).searchParams.get("token");
    const ticket = readDownloadToken(token, requiredEnv("WALLET_DOWNLOAD_SECRET"));
    if (!ticket) return new Response("Link expired or invalid", { status: 401 });

    const passBuffer = await buildPass(ticket);
    return new Response(new Uint8Array(passBuffer), {
      status: 200,
      headers: {
        "Cache-Control": "no-store, private",
        "Content-Disposition": `attachment; filename="janyeol-ticket-${ticket.id}.pkpass"`,
        "Content-Security-Policy": "default-src 'none'",
        "Content-Type": "application/vnd.apple.pkpass",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("janyeol-wallet GET failed", error instanceof Error ? error.message : error);
    return new Response("Wallet pass unavailable", { status: 503 });
  }
}
