import { failure, json } from "@/lib/http";
import { adminBody, configure } from "@/lib/voting/admin";
import { sessionId, text } from "@/lib/voting/validation";
export async function POST(request: Request) {
  try {
    const body = await adminBody(request);
    return json(await configure(sessionId(body.sessionId)!, "add", { name: text(body.name, "Option name", 80) }), 201);
  } catch (error) { return failure(error); }
}
