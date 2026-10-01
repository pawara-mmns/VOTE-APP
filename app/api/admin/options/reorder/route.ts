import { failure, json } from "@/lib/http";
import { adminBody, configure } from "@/lib/voting/admin";
import { optionIds, sessionId } from "@/lib/voting/validation";
export async function POST(request: Request) {
  try {
    const body = await adminBody(request);
    return json(await configure(sessionId(body.sessionId)!, "reorder", { optionIds: optionIds(body.optionIds) }));
  } catch (error) { return failure(error); }
}
