import { sha256, randomToken, safeEqual, serverHmac, verifyP256Signature } from "@/lib/crypto";
import { getStore, type Store } from "@/lib/store";
import type { AdminCredential } from "@/lib/types";

const credentialKey = "sol:admin:credential";
const usedChallengeKey = (nonce: string) => `sol:admin:used-challenge:${sha256(nonce)}`;

export class PairingError extends Error {
  constructor(public readonly code: "ALREADY_PAIRED" | "INVALID_SECRET" | "INVALID_KEY") {
    super(code);
  }
}

export async function getAdminCredential(store: Store = getStore()): Promise<AdminCredential | null> {
  return store.get<AdminCredential>(credentialKey);
}

export async function pairAdmin(secret: string, publicKey: JsonWebKey, store: Store = getStore()): Promise<AdminCredential> {
  if (await getAdminCredential(store)) throw new PairingError("ALREADY_PAIRED");
  const expectedHash = process.env.SOL_BOOTSTRAP_SECRET_HASH || "";
  if (!expectedHash || !safeEqual(sha256(secret.trim()), expectedHash)) throw new PairingError("INVALID_SECRET");
  if (!publicKey.x || !publicKey.y || publicKey.kty !== "EC" || publicKey.crv !== "P-256") throw new PairingError("INVALID_KEY");
  const credential: AdminCredential = { id: randomToken(16), publicKey, createdAt: Date.now() };
  await store.set(credentialKey, credential, 10 * 365 * 24 * 60 * 60);
  return credential;
}

export async function issueChallenge(store: Store = getStore()): Promise<{ nonce: string; credentialId: string | null; expiresAt: number }> {
  const credential = await getAdminCredential(store);
  const expiresAt = Date.now() + 120_000;
  const random = randomToken(24);
  const payload = `${random}.${expiresAt}`;
  const nonce = `${payload}.${serverHmac(payload)}`;
  return { nonce, credentialId: credential?.id || null, expiresAt };
}

function validChallenge(nonce: string): boolean {
  const [random, expiresAt, signature, ...extra] = nonce.split(".");
  if (!random || !expiresAt || !signature || extra.length || Number(expiresAt) < Date.now()) return false;
  return safeEqual(serverHmac(`${random}.${expiresAt}`), signature);
}

export function adminPayload(method: string, path: string, timestamp: string, nonce: string, body: string): string {
  return [method.toUpperCase(), path, timestamp, nonce, sha256(body)].join("\n");
}

export async function verifyAdminRequest(request: Request, body: string, store: Store = getStore()): Promise<boolean> {
  const credential = await getAdminCredential(store);
  const credentialId = request.headers.get("x-sol-credential") || "";
  const timestamp = request.headers.get("x-sol-timestamp") || "";
  const nonce = request.headers.get("x-sol-nonce") || "";
  const signature = request.headers.get("x-sol-signature") || "";
  if (!credential || !safeEqual(credential.id, credentialId)) return false;
  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 120_000) return false;
  if (!validChallenge(nonce)) return false;
  const url = new URL(request.url);
  if (!verifyP256Signature(credential.publicKey, adminPayload(request.method, `${url.pathname}${url.search}`, timestamp, nonce, body), signature)) return false;
  return store.setIfAbsent(usedChallengeKey(nonce), true, 120);
}
