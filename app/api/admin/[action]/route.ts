import { failure, HttpError, json } from "@/lib/http";
import { serverSupabase } from "@/lib/supabase/server";
import { snapshot } from "@/lib/voting/server";
import { adminBody, checkAdminResult, configure } from "@/lib/voting/admin";
import { optionNames, sessionId, settings } from "@/lib/voting/validation";

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    const body = await adminBody(request);
    const { action } = await context.params;
    if (!["open", "close", "new-session"].includes(action)) throw new HttpError(404, "Unknown admin action.");
    if (action === "new-session" && body.confirm !== true) throw new HttpError(400, "Confirm before starting a new session.");
    if (action !== "new-session") {
      if (action === "close" && body.confirm !== true) throw new HttpError(400, "Confirm before closing voting.");
      return json(await configure(sessionId(body.sessionId)!, action));
    }
    const input = settings(body);
    const { data, error } = await serverSupabase().rpc("create_voting_session", {
      p_name: input.name, p_question: input.question, p_description: input.description,
      p_options: optionNames(body.options), p_expected_session_id: sessionId(body.sessionId, true),
    });
    checkAdminResult(data, error);
    return json({ success: true, snapshot: await snapshot() });
  } catch (error) { return failure(error); }
}
