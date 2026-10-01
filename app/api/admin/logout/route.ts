import { COOKIE_NAME, cookieOptions } from "@/lib/auth/admin";
import { failure, json, readBody } from "@/lib/http";

export async function POST(request: Request) {
  try {
    await readBody(request);
    const response = json({ success: true });
    response.cookies.set(COOKIE_NAME, "", { ...cookieOptions, maxAge: 0 });
    return response;
  } catch (error) { return failure(error); }
}
