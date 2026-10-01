import { isAdmin } from "@/lib/auth/admin";
import { failure, HttpError, json } from "@/lib/http";
import { adminBody, checkAdminResult } from "@/lib/voting/admin";
import { serverSupabase } from "@/lib/supabase/server";
import { sessionId } from "@/lib/voting/validation";
import { codeCount, generateCodes, votingCodeHash } from "@/lib/voting/abuse";
import { ipSecret } from "@/lib/voting/abuse-server";

export async function GET(request: Request) {
  try {
    if (!await isAdmin()) throw new HttpError(401, "Please sign in to manage voting codes.");
    const { data, error } = await serverSupabase().rpc("get_voter_code_stats", { p_session_id: sessionId(new URL(request.url).searchParams.get("sessionId")) });
    checkAdminResult(data, error);
    return json({ stats: data.stats });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const body = await adminBody(request);
    const id = sessionId(body.sessionId);
    const count = codeCount(body.count);
    const secret = ipSecret();
    const codes = generateCodes(count);
    const { data, error } = await serverSupabase().rpc("generate_voter_codes", { p_session_id: id, p_code_hashes: codes.map((code) => votingCodeHash(code, secret)) });
    checkAdminResult(data, error);
    return json({ codes, stats: data.stats }, 201);
  } catch (error) { return failure(error); }
}
