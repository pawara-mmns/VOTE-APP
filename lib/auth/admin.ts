import "server-only";
import { cookies } from "next/headers";
import { validSession } from "@/lib/security";
import { readAdminConfig } from "@/lib/auth/config";

export const COOKIE_NAME = "live_vote_admin";
export function adminConfig() {
  const { ADMIN_PASSWORD, ADMIN_SESSION_SECRET } = process.env;
  return readAdminConfig({ ADMIN_PASSWORD, ADMIN_SESSION_SECRET });
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
