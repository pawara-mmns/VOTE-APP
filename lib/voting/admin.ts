import "server-only";
import { isAdmin } from "@/lib/auth/admin";
import { HttpError, readBody } from "@/lib/http";
import { serverSupabase } from "@/lib/supabase/server";
import { enforceRateLimit, snapshot } from "@/lib/voting/server";
export async function adminBody(request: Request) {
  const body = await readBody(request);
  if (!await isAdmin()) throw new HttpError(401, "Your admin session has expired. Please sign in again.");
  await enforceRateLimit("admin:actions", 60, 60);
  return body;
}
export function checkAdminResult(data: { status: string } | null, error: unknown) {
  if (error || !data) throw new Error("Admin operation unavailable");
  const messages: Record<string, string> = {
    no_session: "No active voting session. Create a session from the Admin Dashboard.",
    session_changed: "The active session has changed. Reload and try again.",
    options_locked: "This session already contains votes. Start a new voting session to change voting options.",
    voting_open: "Close voting before changing voting options.",
    duplicate_name: "An option with that name already exists.",
    invalid_option: "That option is no longer available. Reload the session.",
    option_bounds: "A session must contain 2 to 20 voting options.",
    invalid: "Please check the session settings and option names.",
    mode_locked: "Close voting and start a new session to change voting mode after votes exist.",
    code_collision: "Unable to generate a unique code batch. Please try again.",
    code_capacity: "This session already has the maximum of 10,000 voting codes.",
  };
  if (data.status !== "success") throw new HttpError(data.status === "invalid" ? 400 : 409, messages[data.status] ?? "Unable to save changes.", data.status);
}
export async function configure(id: string, action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await serverSupabase().rpc("configure_voting_session", { p_session_id: id, p_action: action, p_payload: payload });
  checkAdminResult(data, error);
  return { success: true, snapshot: await snapshot() };
}
