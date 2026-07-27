const DB_NAME = "sol-gate-device";
const STORE_NAME = "credentials";
export const terminalStates = new Set(["COMPLETE_REVIEW", "COMPLETE_OPAQUE", "REJECTED", "EXPIRED"]);
export const CUSTOM_MODEL = "__custom";

/** Polling every two seconds must not re-render the page when the server returned the same thing. */
export function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function dbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function dbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function bytesToBase64Url(value: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hexDigest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const [privateKey, credentialId] = await Promise.all([dbGet<CryptoKey>("privateKey"), dbGet<string>("credentialId")]);
  if (!privateKey || !credentialId) throw new Error("This phone is not paired.");
  const challengeResponse = await fetch("/api/admin/challenge", { method: "POST", cache: "no-store" });
  if (!challengeResponse.ok) throw new Error("Approval service is unavailable.");
  const challenge = (await challengeResponse.json()) as { nonce: string };
  const method = (init.method || "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : "";
  const timestamp = String(Date.now());
  const payload = [method, path, timestamp, challenge.nonce, await hexDigest(body)].join("\n");
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(payload));
  const headers = new Headers(init.headers);
  headers.set("x-sol-credential", credentialId);
  headers.set("x-sol-timestamp", timestamp);
  headers.set("x-sol-nonce", challenge.nonce);
  headers.set("x-sol-signature", bytesToBase64Url(signature));
  if (body) headers.set("content-type", "application/json");
  return fetch(path, { ...init, headers, cache: "no-store" });
}
