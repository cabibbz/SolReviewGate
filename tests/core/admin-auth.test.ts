import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { adminPayload, issueChallenge, pairAdmin, verifyAdminRequest } from "../../lib/admin-auth";
import { sha256 } from "../../lib/crypto";
import { getStore, resetMemoryStoreForTests } from "../../lib/store";

test.beforeEach(() => {
  resetMemoryStoreForTests();
  process.env.SOL_BOOTSTRAP_SECRET_HASH = sha256("bootstrap-test-secret");
});

test("accepts one signed request and rejects nonce replay", async () => {
  const store = getStore();
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credential = await pairAdmin("bootstrap-test-secret", jwk, store);
  const challenge = await issueChallenge(store);
  const method = "POST";
  const path = "/api/admin/jobs/id/decision";
  const body = '{"decision":"approve"}';
  const timestamp = String(Date.now());
  const signature = sign("sha256", Buffer.from(adminPayload(method, path, timestamp, challenge.nonce, body)), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const request = new Request(`https://example.test${path}`, {
    method,
    headers: {
      "x-sol-credential": credential.id,
      "x-sol-timestamp": timestamp,
      "x-sol-nonce": challenge.nonce,
      "x-sol-signature": signature,
    },
  });
  assert.equal(await verifyAdminRequest(request, body, store), true);
  assert.equal(await verifyAdminRequest(request, body, store), false);
});

test("rejects altered bodies and bad bootstrap secrets", async () => {
  const store = getStore();
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  await assert.rejects(() => pairAdmin("wrong", publicKey.export({ format: "jwk" }), store));
});

test("a paired phone key cannot be silently replaced", async () => {
  const store = getStore();
  const first = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const second = generateKeyPairSync("ec", { namedCurve: "P-256" });
  await pairAdmin("bootstrap-test-secret", first.publicKey.export({ format: "jwk" }) as JsonWebKey, store);
  await assert.rejects(
    () => pairAdmin("bootstrap-test-secret", second.publicKey.export({ format: "jwk" }) as JsonWebKey, store),
    /ALREADY_PAIRED/,
  );
});

test("binds the complete query string into signed cursor requests", async () => {
  const store = getStore();
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const credential = await pairAdmin("bootstrap-test-secret", publicKey.export({ format: "jwk" }) as JsonWebKey, store);
  const challenge = await issueChallenge(store);
  const timestamp = String(Date.now());
  const path = "/api/admin/jobs/job-id/events?cursor=12";
  const signature = sign("sha256", Buffer.from(adminPayload("GET", path, timestamp, challenge.nonce, "")), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  const headers = {
    "x-sol-credential": credential.id,
    "x-sol-timestamp": timestamp,
    "x-sol-nonce": challenge.nonce,
    "x-sol-signature": signature,
  };
  const altered = new Request("https://example.test/api/admin/jobs/job-id/events?cursor=13", { headers });
  assert.equal(await verifyAdminRequest(altered, "", store), false);
});
