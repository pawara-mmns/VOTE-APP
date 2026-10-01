import "server-only";
import { serverSupabase } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http";
import { keyedHash } from "@/lib/security";
import type { Snapshot } from "@/lib/voting/types";

export function voterHash(deviceId: string) {
  const secret = process.env.VOTER_HASH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Voter hash secret must contain 32+ characters");
  return keyedHash(deviceId.toLowerCase(), secret);
}
export async function snapshot(): Promise<Snapshot | null> {
  const { data, error } = await serverSupabase().rpc("get_voting_snapshot");
  if (error) throw new Error("Snapshot unavailable");
  return data as Snapshot | null;
}
export async function enforceRateLimit(key: string, limit: number, seconds: number) {
  const { data, error } = await serverSupabase().rpc("consume_request_limit", {
    p_key: key, p_limit: limit, p_window_seconds: seconds,
  });
  if (error) throw new Error("Rate limiter unavailable");
  if (!data) throw new HttpError(429, "Too many attempts. Please wait a minute before trying again.", "rate_limited");
}
