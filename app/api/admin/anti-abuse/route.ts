import { failure, json } from "@/lib/http";
import { adminBody, checkAdminResult } from "@/lib/voting/admin";
import { serverSupabase } from "@/lib/supabase/server";
import { snapshot } from "@/lib/voting/server";
import { sessionId } from "@/lib/voting/validation";
import { abuseSettings } from "@/lib/voting/abuse";

export async function PATCH(request: Request) {
  try {
    const body = await adminBody(request);
    const { data, error } = await serverSupabase().rpc("configure_voting_protection", { p_session_id: sessionId(body.sessionId), ...abuseSettings(body) });
    checkAdminResult(data, error);
    return json({ success: true, snapshot: await snapshot() });
  } catch (error) { return failure(error); }
}
