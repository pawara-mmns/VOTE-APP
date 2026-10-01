import "server-only";
import { cookies } from "next/headers";
import { validSession } from "@/lib/security";

export const COOKIE_NAME = "live_vote_admin";
export function adminConfig() {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!password || password.length < 12 || !secret || secret.length < 32) {
    throw new Error("Admin requires a 12+ character password and 32+ character session secret");
  }
  return { password, secret };
}
export async function isAdmin() {
  try {
    const { password, secret } = adminConfig();
    return validSession((await cookies()).get(COOKIE_NAME)?.value, secret, password);
  } catch { return false; }
}
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};
