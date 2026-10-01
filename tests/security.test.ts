import { test } from "node:test";
import assert from "node:assert/strict";
import { keyedHash, makeSession, validSession, passwordMatches, sameOrigin, SESSION_SECONDS } from "../lib/security.ts";
import { isUUID, totalVotes, rankedOptions } from "../lib/voting/types.ts";
import { optionNames, settings, optionIds } from "../lib/voting/validation.ts";
import { AdminConfigurationError, readAdminConfig } from "../lib/auth/config.ts";

const secret = "test-secret-longer-than-thirty-two-characters";
const password = "an-event-admin-password";
const now = 1_790_000_000_000;

test("admin configuration accepts existing passwords and rejects invalid setup without leaking secrets", () => {
  for (const value of ["Test!202", "Test!2026", password, "x".repeat(512)]) {
    assert.deepEqual(readAdminConfig({ ADMIN_PASSWORD: value, ADMIN_SESSION_SECRET: secret }), { password: value, secret });
  }
  for (const value of [undefined, "short", " ".repeat(12), "x".repeat(513)]) {
    assert.throws(() => readAdminConfig({ ADMIN_PASSWORD: value, ADMIN_SESSION_SECRET: secret }), (error: unknown) => {
      assert.ok(error instanceof AdminConfigurationError);
      assert.match(error.message, /ADMIN_PASSWORD/);
      assert.ok(!error.message.includes(secret));
      return true;
    });
  }
  for (const value of [undefined, "short-secret", " ".repeat(32)]) {
    assert.throws(() => readAdminConfig({ ADMIN_PASSWORD: password, ADMIN_SESSION_SECRET: value }), (error: unknown) => {
      assert.ok(error instanceof AdminConfigurationError);
      assert.match(error.message, /ADMIN_SESSION_SECRET/);
      assert.ok(!error.message.includes(password));
      return true;
    });
  }
});

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

test("dynamic poll validation and browser identity reject malformed inputs", () => {
  assert.deepEqual(optionNames([" Alpha ", "Phoenix"]), ["Alpha", "Phoenix"]);
  for (const input of [["one"], Array(21).fill("option"), ["Alpha", " alpha "], ["", "two"], [1, "two"]]) assert.throws(() => optionNames(input));
  assert.throws(() => settings({ name: "", question: "Vote" }));
  assert.throws(() => settings({ name: "Event", question: "x".repeat(151) }));
  assert.throws(() => optionIds(["invalid", "invalid"]));
  assert.equal(isUUID("3ea42c49-908e-4e58-a2ac-bf077b9b0a99"), true);
  assert.equal(isUUID("3ea42c49-908e-1e58-a2ac-bf077b9b0a99"), false);
  assert.equal(isUUID("invalid"), false);
  assert.equal(totalVotes(null), 0);
});

test("results rank ties equally and preserve configured order", () => {
  const options = [{ id: "late", name: "Late", display_order: 2, vote_count: 3 }, { id: "first", name: "First", display_order: 1, vote_count: 3 }, { id: "low", name: "Low", display_order: 3, vote_count: 1 }];
  assert.deepEqual(rankedOptions(options).map((o) => [o.id, o.rank]), [["first", 1], ["late", 1], ["low", 3]]);
});
