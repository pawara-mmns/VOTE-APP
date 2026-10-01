"use client";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function api<T>(url: string, body?: Record<string, unknown>, method?: "POST" | "PATCH" | "DELETE"): Promise<T> {
  const response = await fetch(url, {
    method: method ?? (body ? "POST" : "GET"),
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  let data;
  try { data = await response.json(); }
  catch { throw new ApiError("Unable to reach the voting service. Please try again.", response.status); }
  if (!response.ok) throw new ApiError(data.error ?? "Something went wrong. Please try again.", response.status, data.code);
  return data as T;
}
export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : "Connection interrupted. Check your internet and try again.";
}
