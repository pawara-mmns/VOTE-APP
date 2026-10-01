import { failure, HttpError, json, readBody } from "@/lib/http";
import { serverSupabase } from "@/lib/supabase/server";
import { enforceRateLimit, voterHash } from "@/lib/voting/server";
import { isGroup, isUUID } from "@/lib/voting/types";

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    if (!isGroup(body.group) || !isUUID(body.deviceId) || !isUUID(body.sessionId)) {
      throw new HttpError(400, "Choose a valid group and reload the page if the problem continues.", "invalid");
    }
    const hash = voterHash(body.deviceId);
    await enforceRateLimit(`vote:${hash}`, 15, 60);
    const { data, error } = await serverSupabase().rpc("cast_vote", {
      p_session_id: body.sessionId, p_group_name: body.group, p_voter_hash: hash,
    });
    if (error?.code === "23505") throw new HttpError(409, "You have already voted in this session.", "duplicate");
    if (error) throw new Error("Vote transaction unavailable");
    const messages: Record<string, [number, string]> = {
      duplicate: [409, "You have already voted in this session."],
      closed: [409, "Voting is currently closed."],
      no_session: [409, "There is no active voting session. Please check with the organizer."],
      session_changed: [409, "A new voting session has started. Review your choice and confirm again."],
      invalid: [400, "Please choose a valid group."],
    };
    if (data?.status !== "success") {
      const [status, message] = messages[data?.status] ?? [503, "Unable to save your vote. Please try again."];
      throw new HttpError(status, message, data?.status);
    }
    return json({ sessionId: data.session_id, group: data.group_name }, 201);
  } catch (error) { return failure(error); }
}
