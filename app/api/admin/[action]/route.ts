import { isAdmin } from "@/lib/auth/admin";
import { failure, HttpError, json, readBody } from "@/lib/http";
import { serverSupabase } from "@/lib/supabase/server";
import { enforceRateLimit, snapshot } from "@/lib/voting/server";

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    const body = await readBody(request);
    if (!await isAdmin()) throw new HttpError(401, "Your admin session has expired. Please sign in again.");
    const { action } = await context.params;
    if (!["open", "close", "new-session"].includes(action)) throw new HttpError(404, "Unknown admin action.");
    if (action === "new-session" && body.confirm !== true) throw new HttpError(400, "Confirm before starting a new session.");
    await enforceRateLimit("admin:actions", 30, 60);
    const db = serverSupabase();
    const { error } = action === "new-session"
      ? await db.rpc("start_voting_session")
      : await db.rpc("set_voting_open", { p_is_open: action === "open" });
    if (error) throw new Error("Admin operation unavailable");
    return json({ success: true, snapshot: await snapshot() });
  } catch (error) { return failure(error); }
}
