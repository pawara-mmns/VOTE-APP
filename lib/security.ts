import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_SECONDS = 8 * 60 * 60;
export function keyedHash(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}
export function passwordMatches(candidate: string, expected: string) {
  const a = createHmac("sha256", "password-comparison").update(candidate).digest();
  const b = createHmac("sha256", "password-comparison").update(expected).digest();
  return timingSafeEqual(a, b);
}
export function makeSession(secret: string, password: string, now = Date.now()) {
  const expires = Math.floor(now / 1000) + SESSION_SECONDS;
  const payload = `${expires}.${randomBytes(24).toString("hex")}`;
  return `${payload}.${keyedHash(`admin:${payload}:${keyedHash(password, secret)}`, secret)}`;
}
export function validSession(token: string | undefined, secret: string, password: string, now = Date.now()) {
  if (!token || token.length > 200) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || !/^\d{10}$/.test(parts[0]) || !/^[a-f0-9]{48}$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return false;
  const expires = Number(parts[0]);
  if (expires <= Math.floor(now / 1000) || expires > Math.floor(now / 1000) + SESSION_SECONDS) return false;
  const expected = keyedHash(`admin:${parts[0]}.${parts[1]}:${keyedHash(password, secret)}`, secret);
  return timingSafeEqual(Buffer.from(parts[2], "hex"), Buffer.from(expected, "hex"));
}
export function sameOrigin(origin: string | null, requestUrl: string, configuredUrl?: string) {
  if (!origin) return false;
  try {
    return origin === new URL(requestUrl).origin || (!!configuredUrl && origin === new URL(configuredUrl).origin);
  } catch { return false; }
}
