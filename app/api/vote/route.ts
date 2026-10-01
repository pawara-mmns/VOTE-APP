import { failure, HttpError, json, readBody } from "@/lib/http";
import { serverSupabase } from "@/lib/supabase/server";
import { enforceRateLimit, voterHash } from "@/lib/voting/server";
import { isUUID } from "@/lib/voting/types";
import { normalizeCode, votingCodeHash } from "@/lib/voting/abuse";
import { ipSecret, requestNetworkHash } from "@/lib/voting/abuse-server";

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    // Transitional support for already-open legacy browser tabs; options are
    // resolved and guarded by the database, never by a hardcoded client enum.
    const legacy = body.optionId === undefined && typeof body.group === "string" && body.group.length <= 80;
    if (!isUUID(body.deviceId) || !isUUID(body.sessionId) || (!legacy &&
      (!isUUID(body.optionId) || !Number.isSafeInteger(body.optionsRevision) || (body.optionsRevision as number) < 0))) {
      throw new HttpError(400, "Choose a valid option and reload the page if the problem continues.", "invalid");
    }
    const hash = voterHash(body.deviceId);
    const secret = ipSecret();
    const ipHash = requestNetworkHash(request, secret);
    const code = body.votingCode === undefined || body.votingCode === "" ? null : normalizeCode(body.votingCode);
    if (body.votingCode !== undefined && body.votingCode !== "" && !code) throw new HttpError(400, "Enter a valid six-character voting code.", "invalid_code");
    await enforceRateLimit(`vote:${hash}`, 15, 60);
    await enforceRateLimit(`vote-network:${ipHash}`, 120, 60);
    const protection = { p_ip_hash: ipHash, p_code_hash: code ? votingCodeHash(code, secret) : null };
    const db = serverSupabase();
    const { data, error } = legacy ? await db.rpc("cast_legacy_option_vote", {
      p_session_id: body.sessionId, p_group_name: body.group, p_voter_hash: hash, ...protection,
    }) : await db.rpc("cast_option_vote", {
      p_session_id: body.sessionId, p_option_id: body.optionId, p_voter_hash: hash, p_options_revision: body.optionsRevision, ...protection,
    });
    if (error?.code === "23505") throw new HttpError(409, "You have already voted in this session.", "duplicate");
    if (error?.code === "PGRST202") throw new HttpError(503, "Voting protection needs a database upgrade. Ask the organizer to apply migration 003 and redeploy.", "migration_required");
    if (error) throw new Error("Vote transaction unavailable");
    const messages: Record<string, [number, string]> = {
      duplicate: [409, "You have already voted in this session."],
      closed: [409, "Voting is currently closed."],
      no_session: [409, "There is no active voting session. Please check with the organizer."],
      session_changed: [409, "A new voting session has started. Review your choice and confirm again."],
      invalid: [400, "Please choose a valid option."],
      invalid_option: [409, "That option is no longer available. Review the updated options and try again."],
      options_changed: [409, "The voting options have changed. Review your choice and confirm again."],
      network_limit: [409, "This network has reached the voting limit for this session."],
      code_required: [400, "Enter your voting code before submitting."],
      invalid_code: [400, "That voting code is not valid for this session."],
      code_used: [409, "This voting code has already been used in this session."],
      upgrade_required: [503, "Voting protection needs a database upgrade. Please contact the organizer."],
    };
    if (data?.status !== "success") {
      const [status, message] = messages[data?.status] ?? [503, "Unable to save your vote. Please try again."];
      throw new HttpError(status, message, data?.status);
    }
    return json({ sessionId: data.session_id, optionId: data.option_id, optionName: data.option_name,
      ...(legacy ? { group: data.group_name } : {}) }, 201);
  } catch (error) { return failure(error); }
}
