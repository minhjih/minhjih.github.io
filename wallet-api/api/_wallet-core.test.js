import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPassProps,
  createDownloadToken,
  createTicketSnapshot,
  isAllowedOrigin,
  isValidUuid,
  readDownloadToken,
} from "./_wallet-core.js";

const SECRET = "a-secure-test-secret-that-is-longer-than-32-characters";
const ORDER_ID = "6f6c888e-7d40-4bb4-bc4b-f6008964ea6e";
const SNAPSHOT = {
  id: ORDER_ID,
  buyer_name: "테스트 예매자",
  quantity: 2,
  status: "confirmed",
  qr_token: "test-qr-token",
};

test("download token encrypts the QR payload and expires", () => {
  const token = createDownloadToken(SNAPSHOT, SECRET, 1_000, Buffer.alloc(12, 7));

  assert.equal(token.includes(SNAPSHOT.qr_token), false);
  assert.deepEqual(readDownloadToken(token, SECRET, 1_059), SNAPSHOT);
  assert.equal(readDownloadToken(token, SECRET, 1_061), null);
});

test("download token rejects tampering and the wrong secret", () => {
  const token = createDownloadToken(SNAPSHOT, SECRET, 1_000, Buffer.alloc(12, 9));
  const tampered = `${token.slice(0, -1)}A`;

  assert.equal(readDownloadToken(tampered, SECRET, 1_001), null);
  assert.equal(readDownloadToken(token, `${SECRET}-wrong`, 1_001), null);
});

test("request boundaries accept only known origins and UUID order ids", () => {
  const origins = "https://minhjih.github.io,http://localhost:8765";

  assert.equal(isAllowedOrigin("https://minhjih.github.io", origins), true);
  assert.equal(isAllowedOrigin("https://evil.example", origins), false);
  assert.equal(isAllowedOrigin(null, origins), true);
  assert.equal(isValidUuid(ORDER_ID), true);
  assert.equal(isValidUuid("../../orders"), false);
});

test("ticket snapshot accepts only confirmed orders with QR tokens", () => {
  assert.deepEqual(createTicketSnapshot(SNAPSHOT), SNAPSHOT);
  assert.throws(() => createTicketSnapshot({ ...SNAPSHOT, status: "used" }));
  assert.throws(() => createTicketSnapshot({ ...SNAPSHOT, qr_token: "" }));
});

test("pass contents retain order identity and disable sharing", () => {
  const props = buildPassProps(SNAPSHOT, {
    APPLE_PASS_TYPE_ID: "pass.com.example.janyeol",
    APPLE_TEAM_ID: "ABCDE12345",
    WALLET_EVENT_RELEVANT_ISO: "2026-08-29T17:30:00+09:00",
  });

  assert.equal(props.serialNumber, ORDER_ID);
  assert.equal(props.sharingProhibited, true);
  assert.equal(props.eventTicket.auxiliaryFields[1].value, "2명");
  assert.equal(props.relevantDate, "2026-08-29T08:30:00.000Z");
});
