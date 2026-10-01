import "server-only";
import { HttpError } from "@/lib/http";
import { requestIP, networkHash } from "@/lib/voting/abuse";

export function ipSecret() {
  const secret = process.env.IP_HASH_SECRET;
  if (!secret || secret.trim().length < 32) throw new HttpError(503, "Voting protection is not configured. Ask the organizer to configure IP_HASH_SECRET and restart or redeploy.", "abuse_configuration");
  return secret;
}
export function requestNetworkHash(request: Request, secret: string) {
  const ip = requestIP(request.headers, process.env.VERCEL === "1", process.env.NODE_ENV !== "production");
  if (!ip) throw new HttpError(503, "Your network could not be verified. Please try again or contact the organizer.", "network_unavailable");
  return networkHash(ip, secret);
}
