import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GET, OPTIONS, POST } from "../api/janyeol-wallet.js";

const ENDPOINT = "https://wallet.example/api/janyeol-wallet";
const ORDER_ID = "6f6c888e-7d40-4bb4-bc4b-f6008964ea6e";

test("pass background assets cover every Wallet display scale", async () => {
  const expectedSizes = {
    "background.png": [180, 220],
    "background@2x.png": [360, 440],
    "background@3x.png": [540, 660],
  };

  for (const [name, [width, height]] of Object.entries(expectedSizes)) {
    const image = await readFile(new URL(`../api/assets/${name}`, import.meta.url));
    assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(image.readUInt32BE(16), width);
    assert.equal(image.readUInt32BE(20), height);
  }
});

test("preflight allows only configured browser origins", async () => {
  const allowed = await OPTIONS(new Request(ENDPOINT, {
    method: "OPTIONS",
    headers: { Origin: "https://minhjih.github.io" },
  }));
  const denied = await OPTIONS(new Request(ENDPOINT, {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example" },
  }));

  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://minhjih.github.io");
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.has("access-control-allow-origin"), false);
});

test("POST validates input before reading backend configuration", async () => {
  const invalid = await POST(new Request(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://minhjih.github.io" },
    body: JSON.stringify({ order_id: "../../orders" }),
  }));
  const unauthenticated = await POST(new Request(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://minhjih.github.io" },
    body: JSON.stringify({ order_id: ORDER_ID }),
  }));

  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "invalid_order" });
  assert.equal(unauthenticated.status, 404);
  assert.deepEqual(await unauthenticated.json(), { error: "order_not_found" });
});

test("GET rejects malformed or expired encrypted links", async () => {
  const previousSecret = process.env.WALLET_DOWNLOAD_SECRET;
  process.env.WALLET_DOWNLOAD_SECRET = "a-secure-test-secret-that-is-longer-than-32-characters";
  try {
    const response = await GET(new Request(`${ENDPOINT}?token=not-a-token`));
    assert.equal(response.status, 401);
    assert.equal(await response.text(), "Link expired or invalid");
  } finally {
    if (previousSecret === undefined) delete process.env.WALLET_DOWNLOAD_SECRET;
    else process.env.WALLET_DOWNLOAD_SECRET = previousSecret;
  }
});
