import { failure, json } from "@/lib/http";
import { snapshot } from "@/lib/voting/server";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const data = await snapshot();
    return data ? json(data) : json({ error: "No active voting session. Create a session from the Admin Dashboard.", code: "no_session" }, 404);
  } catch (error) { return failure(error); }
}
