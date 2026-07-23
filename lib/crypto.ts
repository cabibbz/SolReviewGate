import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { requireServerSecret } from "@/lib/config";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function serverHmac(value: string): string {
  return createHmac("sha256", masterKey()).update(value).digest("base64url");
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function masterKey(): Buffer {
  const key = Buffer.from(requireServerSecret("SOL_MASTER_KEY_BASE64"), "base64");
  if (key.length !== 32) {
    throw new Error("SOL_MASTER_KEY_BASE64 must decode to exactly 32 bytes");
  }
  return key;
}

export function encryptBuffer(value: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptBuffer(value: string, aad: string): Buffer {
  const parts = value.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted value");
  }
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptText(value: string, aad: string): string {
  return encryptBuffer(Buffer.from(value, "utf8"), aad);
}

export function decryptText(value: string, aad: string): string {
  return decryptBuffer(value, aad).toString("utf8");
}

export function verifyP256Signature(publicKey: JsonWebKey, payload: string, signature: string): boolean {
  try {
    const key = createPublicKey({ key: publicKey as import("node:crypto").JsonWebKey, format: "jwk" });
    return verify("sha256", Buffer.from(payload), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}
