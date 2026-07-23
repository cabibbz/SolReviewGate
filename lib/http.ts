import { NextResponse } from "next/server";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function opaqueError(status = 404): NextResponse {
  return json({ error: "unavailable" }, status);
}

export async function readJson<T>(request: Request, maxBytes = 900_000): Promise<T> {
  const length = Number(request.headers.get("content-length") || "0");
  if (length > maxBytes) throw new Error("BODY_TOO_LARGE");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("BODY_TOO_LARGE");
  return JSON.parse(text) as T;
}
