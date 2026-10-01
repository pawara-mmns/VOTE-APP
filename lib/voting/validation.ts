import { isUUID, type SessionSettings } from "./types.ts";
export class ValidationError extends Error {}
export function text(value: unknown, label: string, max: number, optional = false) {
  if (optional && (value === null || value === undefined)) return "";
  if (typeof value !== "string") throw new ValidationError(`${label} must be text.`);
  const trimmed = value.trim();
  const length = Array.from(trimmed).length;
  if ((!optional && length === 0) || length > max) throw new ValidationError(`${label} must contain ${optional ? "at most" : "1 to"} ${max} characters.`);
  return trimmed;
}
export function settings(body: Record<string, unknown>): SessionSettings {
  return { name: text(body.name, "Session name", 100), question: text(body.question, "Voting question", 150), description: text(body.description, "Description", 300, true) };
}
export function optionNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 20) throw new ValidationError("A session needs 2 to 20 options.");
  const names = value.map((name) => text(name, "Option name", 80));
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) throw new ValidationError("Option names must be unique.");
  return names;
}
export function sessionId(value: unknown, allowEmpty = false): string | null {
  if (allowEmpty && value === null) return null;
  if (!isUUID(value)) throw new ValidationError("Reload the current session and try again.");
  return value;
}
export function optionId(value: unknown): string {
  if (!isUUID(value)) throw new ValidationError("Choose a valid voting option.");
  return value;
}
export function optionIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 20) throw new ValidationError("A session needs 2 to 20 options.");
  const ids = value.map(optionId);
  if (new Set(ids).size !== ids.length) throw new ValidationError("Each option must appear once in the order.");
  return ids;
}
