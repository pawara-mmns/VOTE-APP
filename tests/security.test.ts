import { test } from "node:test";
import assert from "node:assert/strict";
import { keyedHash, makeSession, validSession, passwordMatches, sameOrigin, SESSION_SECONDS } from "../lib/security.ts";
import { isGroup, isUUID, totalVotes } from "../lib/voting/types.ts";

const secret = "test-secret-longer-than-thirty-two-characters";
const password = "an-event-admin-password";
const now = 1_790_000_000_000;

test("admin session verifies signature, expiry, password rotation, and secret rotation", () => {
  const token = makeSession(secret, password, now);
  assert.equal(validSession(token, secret, password, now), true);
  assert.equal(validSession(token, secret, password, now + SESSION_SECONDS * 1000), false);
  assert.equal(validSession(token, secret, "new-password", now), false);
  assert.equal(validSession(token, "new-secret", password, now), false);
  assert.equal(validSession(token.slice(0, -1) + (token.endsWith("0") ? "1" : "0"), secret, password, now), false);
  assert.equal(validSession("malformed", secret, password, now), false);
  assert.equal(validSession(undefined, secret, password, now), false);
  assert.notEqual(makeSession(secret, password, now), token);
});

test("password comparisons and voter hashes are deterministic without storing identifiers", () => {
  assert.equal(passwordMatches(password, password), true);
  assert.equal(passwordMatches("incorrect", password), false);
  const identifier = "3ea42c49-908e-4e58-a2ac-bf077b9b0a99";
  assert.match(keyedHash(identifier, secret), /^[a-f0-9]{64}$/);
  assert.notEqual(keyedHash(identifier, secret), keyedHash(identifier, "another-secret"));
});

test("mutations only accept same-origin requests", () => {
  assert.equal(sameOrigin("https://event.example", "https://event.example/api/vote"), true);
  assert.equal(sameOrigin("https://event.example", "https://preview.example/api/vote", "https://event.example"), true);
  assert.equal(sameOrigin("https://evil.example", "https://event.example/api/vote"), false);
  assert.equal(sameOrigin(null, "https://event.example/api/vote"), false);
  assert.equal(sameOrigin("https://event.example.evil.test", "https://event.example/api/vote"), false);
});

test("group and browser identity validation rejects malformed inputs", () => {
  for (const group of ["A", "B", "C", "D"]) assert.equal(isGroup(group), true);
  for (const group of ["E", "a", null, ["A"], 1, "A;delete"]) assert.equal(isGroup(group), false);
  assert.equal(isUUID("3ea42c49-908e-4e58-a2ac-bf077b9b0a99"), true);
  assert.equal(isUUID("3ea42c49-908e-1e58-a2ac-bf077b9b0a99"), false);
  assert.equal(isUUID("invalid"), false);
  assert.equal(totalVotes(null), 0);
});
