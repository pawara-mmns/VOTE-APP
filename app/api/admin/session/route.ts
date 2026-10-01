import { isAdmin } from "@/lib/auth/admin";
import { failure, HttpError, json } from "@/lib/http";
import { adminBody, configure } from "@/lib/voting/admin";
import { snapshot } from "@/lib/voting/server";
import { sessionId, settings } from "@/lib/voting/validation";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    if (!await isAdmin()) throw new HttpError(401, "Please sign in to manage this session.");
    return json(await snapshot());
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    const body = await adminBody(request);
    return json(await configure(sessionId(body.sessionId)!, "settings", settings(body)));
  } catch (error) { return failure(error); }
}
