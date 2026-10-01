import { failure, json } from "@/lib/http";
import { snapshot } from "@/lib/voting/server";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const data = await snapshot();
    return data ? json(data) : json({ error: "There is no active voting session. Please check with the organizer." }, 404);
  } catch (error) { return failure(error); }
}
