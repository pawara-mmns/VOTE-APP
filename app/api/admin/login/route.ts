import { NextResponse } from "next/server";
import { adminConfig, COOKIE_NAME, cookieOptions } from "@/lib/auth/admin";
import { failure, HttpError, readBody } from "@/lib/http";
import { keyedHash, makeSession, passwordMatches, SESSION_SECONDS } from "@/lib/security";
import { enforceRateLimit } from "@/lib/voting/server";

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    if (typeof body.password !== "string" || body.password.length > 512) throw new HttpError(400, "Enter your admin password.");
    const { password, secret } = adminConfig();
    // Vercel supplies this trusted proxy header. Local requests share one bucket.
    const address = process.env.VERCEL === "1"
      ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
      : "local";
    await enforceRateLimit(`login:${keyedHash(address, secret)}`, 10, 60);
    await enforceRateLimit("login:global", 200, 60);
    if (!passwordMatches(body.password, password)) throw new HttpError(401, "Incorrect password. Please try again.");
    const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(COOKIE_NAME, makeSession(secret, password), { ...cookieOptions, maxAge: SESSION_SECONDS });
    return response;
  } catch (error) { return failure(error); }
}
