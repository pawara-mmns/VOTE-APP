import { failure, HttpError, json } from "@/lib/http";
import { adminBody, configure } from "@/lib/voting/admin";
import { optionId, sessionId, text } from "@/lib/voting/validation";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    const body = await adminBody(request);
    const { id } = await context.params;
    return json(await configure(sessionId(body.sessionId)!, "rename", { optionId: optionId(id), name: text(body.name, "Option name", 80) }));
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const body = await adminBody(request);
    if (body.confirm !== true) throw new HttpError(400, "Confirm before deleting this option.");
    const { id } = await context.params;
    return json(await configure(sessionId(body.sessionId)!, "delete", { optionId: optionId(id) }));
  } catch (error) { return failure(error); }
}
