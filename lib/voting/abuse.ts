import { isIP } from "node:net";
import { randomInt } from "node:crypto";
import { keyedHash } from "../security.ts";
import { ValidationError } from "./validation.ts";

export function normalizeIP(value: string): string | null {
  const ip = value.trim().replace(/^\[([^\]]+)\]$/, "$1");
  if (ip.includes("%")) return null;
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6) return null;
  const normalized = new URL(`http://[${ip}]`).hostname.slice(1, -1).toLowerCase();
  // IPv4-mapped IPv6 must share the same quota as its IPv4 representation.
  const mapped = normalized.match(/^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/);
  if (mapped) {
    const a = parseInt(mapped[1], 16), b = parseInt(mapped[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return normalized;
}

export function requestIP(headers: Headers, vercel: boolean, development: boolean): string | null {
  // Only Vercel's edge is trusted to set forwarded headers. Local development
  // deliberately uses one loopback network rather than trusting forged headers.
  if (!vercel) return development ? "127.0.0.1" : null;
  for (const name of ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"]) {
    const value = headers.get(name);
    if (value !== null) return value.length <= 2048 ? normalizeIP(value.split(",")[0]) : null;
  }
  return null;
}

export function networkHash(ip: string, secret: string) { return keyedHash(ip, secret); }
export function normalizeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}
export function votingCodeHash(code: string, secret: string) { return keyedHash(`voting-code:${code}`, secret); }
export function generateCodes(count: number): string[] {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codes = new Set<string>();
  while (codes.size < count) codes.add(Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(""));
  return [...codes];
}
export function abuseSettings(body: Record<string, unknown>) {
  if (typeof body.ipProtectionEnabled !== "boolean" || !Number.isSafeInteger(body.maxVotesPerIp)
    || (body.maxVotesPerIp as number) < 1 || (body.maxVotesPerIp as number) > 100
    || !["standard", "strict_code"].includes(body.votingMode as string)) {
    throw new ValidationError("Choose ON or OFF, a network limit from 1 to 100, and a valid voting mode.");
  }
  return { p_ip_protection_enabled: body.ipProtectionEnabled, p_max_votes_per_ip: body.maxVotesPerIp as number, p_voting_mode: body.votingMode as string };
}
export function codeCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1000) {
    throw new ValidationError("Generate between 1 and 1,000 codes at a time.");
  }
  return value as number;
}
