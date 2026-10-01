import "server-only";
import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/security";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function failure(error: unknown) {
  if (error instanceof HttpError) {
    const response = json({ error: error.message, code: error.code }, error.status);
    if (error.status === 429) response.headers.set("Retry-After", "60");
    return response;
  }
  // Log only a classification, never credentials, identifiers or database details.
  console.error("Voting service request failed", error instanceof Error ? error.name : "UnknownError");
  return json({ error: "The voting service is temporarily unavailable. Please try again shortly." }, 503);
}
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!sameOrigin(request.headers.get("origin"), request.url, process.env.NEXT_PUBLIC_APP_URL)) {
    throw new HttpError(403, "This request could not be verified. Reload the page and try again.");
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new HttpError(415, "Please send a JSON request.");
  }
  if (Number(request.headers.get("content-length")) > 4096) throw new HttpError(413, "Request is too large.");
  // Bound streamed requests too, even when no Content-Length is supplied.
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) {
      await reader.cancel();
      throw new HttpError(413, "Request is too large.");
    }
    chunks.push(value);
  }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new HttpError(400, "Invalid request. Reload the page and try again."); }
}
