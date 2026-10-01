// Runs real Next.js HTTP handlers against the real migration in local PostgreSQL.
// This tiny PostgREST adapter is test-only; no hosted credentials are needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

// Regression: an existing nine-character password must not produce a 503.
const adminPassword = "Test!2026";

test("HTTP event flow: auth, open, vote, duplicate, close, rollover and logout", { timeout: 60_000 }, async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(await readFile(new URL("../../supabase/migrations/001_live_voting.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/002_configurable_voting.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/003_vote_protection.sql", import.meta.url), "utf8"));
  const rpcArgs: Record<string, string[]> = {
    get_voting_snapshot: [],
    cast_option_vote: ["p_session_id", "p_option_id", "p_voter_hash", "p_options_revision", "p_ip_hash", "p_code_hash"],
    cast_legacy_option_vote: ["p_session_id", "p_group_name", "p_voter_hash", "p_ip_hash", "p_code_hash"],
    consume_request_limit: ["p_key", "p_limit", "p_window_seconds"],
    set_voting_open: ["p_is_open"],
    start_voting_session: [],
    create_voting_session: ["p_name", "p_question", "p_description", "p_options", "p_expected_session_id"],
    configure_voting_session: ["p_session_id", "p_action", "p_payload"],
    configure_voting_protection: ["p_session_id", "p_ip_protection_enabled", "p_max_votes_per_ip", "p_voting_mode"],
    generate_voter_codes: ["p_session_id", "p_code_hashes"],
    get_voter_code_stats: ["p_session_id"],
  };
  const adapter = createServer(async (req, res) => {
    if (req.headers.apikey !== "local-test-service-key") { res.writeHead(401); res.end(); return; }
    const fn = req.url?.split("/").pop() ?? "";
    if (!Object.hasOwn(rpcArgs, fn)) { res.writeHead(404); res.end(); return; }
    try {
      let text = "";
      for await (const chunk of req) text += chunk;
      const body = text ? JSON.parse(text) : {};
      const args = rpcArgs[fn];
      const placeholders = args.map((_, i) => `$${i + 1}`).join(",");
      const data = await db.transaction(async (tx) => {
        await tx.exec("set local role service_role");
        const result = await tx.query<{ data: unknown }>(`select public.${fn}(${placeholders}) data`, args.map((arg) => body[arg]));
        return result.rows[0].data;
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ message: "Local test database failure" })); }
  });
  adapter.listen(0, "127.0.0.1");
  await once(adapter, "listening");
  t.after(() => new Promise<void>((resolve) => adapter.close(() => resolve())));
  const address = adapter.address();
  assert.ok(address && typeof address !== "string");
  const reserve = createServer();
  reserve.listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const appAddress = reserve.address();
  assert.ok(appAddress && typeof appAddress !== "string");
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  const base = `http://127.0.0.1:${appAddress.port}`;
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(appAddress.port)], {
    cwd: process.cwd(), windowsHide: true,
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${address.port}`, SUPABASE_SERVICE_ROLE_KEY: "local-test-service-key", NEXT_PUBLIC_APP_URL: base, ADMIN_PASSWORD: adminPassword, ADMIN_SESSION_SECRET: "local-test-session-secret-at-least-32-chars", VOTER_HASH_SECRET: "local-test-voter-secret-at-least-32-chars", IP_HASH_SECRET: "local-test-ip-secret-at-least-32-chars", VERCEL: "1", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  app.stdout.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-3000); });
  app.stderr.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-3000); });
  t.after(() => { app.kill(); });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (app.exitCode !== null) throw new Error(`Next server exited: ${logs}`);
    try { const r = await fetch(`${base}/api/session`); if (r.ok) { ready = true; break; } } catch { /* Waiting for the local server. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Next server did not become ready: ${logs}`);
  let cookie = "";
  async function post(path: string, body: Record<string, unknown>, origin = base, authenticated = true, method = "POST", extraHeaders: Record<string, string> = {}) {
    return fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", Origin: origin, "x-vercel-forwarded-for": "203.0.113.10", ...(authenticated && cookie ? { Cookie: cookie } : {}), ...extraHeaders }, body: JSON.stringify(body) });
  }
  for (const route of ["/", "/vote", "/results", "/admin"]) assert.equal((await fetch(`${base}${route}`)).status, 200);
  assert.equal((await post("/api/admin/open", {})).status, 401);
  assert.equal((await post("/api/admin/anti-abuse", {}, base, false, "PATCH")).status, 401);
  assert.equal((await post("/api/admin/codes", {}, base, false)).status, 401);
  assert.equal((await fetch(`${base}/api/admin/codes?sessionId=${randomUUID()}`)).status, 401);
  assert.equal((await post("/api/admin/login", { password: "incorrect" })).status, 401);
  assert.equal((await post("/api/admin/login", { password: adminPassword }, "https://evil.example")).status, 403);
  const login = await post("/api/admin/login", { password: adminPassword });
  assert.equal(login.status, 200);
  const header = login.headers.get("set-cookie");
  assert.ok(header);
  assert.ok(header.includes("HttpOnly") && header.includes("Secure") && header.includes("SameSite=strict"));
  cookie = header.split(";")[0];
  const adminHtml = await (await fetch(`${base}/admin`, { headers: { Cookie: cookie } })).text();
  assert.match(adminHtml, /You run the moment/);
  assert.ok(!adminHtml.includes(adminPassword));
  assert.equal((await fetch(`${base}/api/admin/session`)).status, 401);
  const initial = await (await fetch(`${base}/api/session`)).json();
  assert.equal((await post("/api/admin/open", { sessionId: initial.session.id })).status, 200);
  const legacyDevice = randomUUID();
  const legacyVote = await post("/api/vote", { sessionId: initial.session.id, deviceId: legacyDevice, group: "A" });
  assert.equal(legacyVote.status, 201);
  assert.equal((await legacyVote.json()).group, "A");
  assert.equal((await post("/api/vote", { sessionId: initial.session.id, deviceId: legacyDevice, group: "D" })).status, 409);
  assert.equal((await post("/api/admin/new-session", { sessionId: initial.session.id, name: "Round 1", question: "Vote Your Team", description: "Choose one", options: ["Team A", "Team B", "Team C", "Team D"], confirm: true })).status, 200);
  let session = await (await fetch(`${base}/api/session`)).json();
  const currentId = session.session.id;
  assert.equal((await post("/api/admin/options", { sessionId: currentId, name: " Team E " })).status, 201);
  session = await (await fetch(`${base}/api/session`)).json();
  const extra = session.options.find((o: { name: string }) => o.name === "Team E");
  assert.equal((await post(`/api/admin/options/${extra.id}`, { sessionId: currentId, confirm: true }, base, true, "DELETE")).status, 200);
  assert.equal((await post("/api/admin/open", { sessionId: currentId })).status, 200);
  session = await (await fetch(`${base}/api/session`)).json();
  const device = randomUUID();
  const vote = { sessionId: currentId, deviceId: device, optionId: session.options[0].id, optionsRevision: session.session.options_revision };
  assert.equal((await post("/api/vote", { ...vote, optionId: "invalid" })).status, 400);
  assert.equal((await post("/api/vote", vote, "https://evil.example")).status, 403);
  const burst = await Promise.all(Array.from({ length: 8 }, () => post("/api/vote", vote)));
  assert.equal(burst.filter((r) => r.status === 201).length, 1);
  assert.equal(burst.filter((r) => r.status === 409).length, 7);
  const totals = await (await fetch(`${base}/api/session`)).json();
  assert.equal(totals.options[0].vote_count, 1);
  assert.equal((await post("/api/vote", { ...vote, deviceId: randomUUID(), optionId: session.options[3].id })).status, 201);
  const tie = await (await fetch(`${base}/api/session`)).json();
  assert.equal(tie.options[0].vote_count, 1);
  assert.equal(tie.options[3].vote_count, 1);
  assert.equal((await post("/api/admin/close", { sessionId: currentId })).status, 400);
  assert.equal((await post("/api/admin/close", { sessionId: currentId, confirm: true })).status, 200);
  const closed = await post("/api/vote", { ...vote, deviceId: randomUUID() });
  assert.equal(closed.status, 409);
  assert.equal((await closed.json()).code, "closed");
  assert.equal((await post(`/api/admin/options/${session.options[0].id}`, { sessionId: currentId, name: "Unsafe" }, base, true, "PATCH")).status, 409);
  assert.equal((await post("/api/admin/session", { sessionId: currentId, name: "Round 1 Updated", question: "Updated question", description: "" }, base, true, "PATCH")).status, 200);
  assert.equal((await post("/api/admin/new-session", {})).status, 400);
  assert.equal((await post("/api/admin/new-session", { sessionId: currentId, name: "Round 2", question: "Pick your favourite", description: "", options: ["Alpha", "Phoenix", "Galaxy", "Nova", "Orion"], confirm: true })).status, 200);
  let fresh = await (await fetch(`${base}/api/session`)).json();
  assert.notEqual(fresh.session.id, session.session.id);
  assert.equal(fresh.session.is_open, false);
  assert.equal(fresh.options.length, 5);
  assert.ok(fresh.options.every((o: { vote_count: number }) => o.vote_count === 0));
  assert.equal((await post(`/api/admin/options/${fresh.options[1].id}`, { sessionId: fresh.session.id, name: "Phoenix Team" }, base, true, "PATCH")).status, 200);
  assert.equal((await post("/api/admin/options/reorder", { sessionId: fresh.session.id, optionIds: [...fresh.options].reverse().map((o: { id: string }) => o.id) })).status, 200);
  fresh = await (await fetch(`${base}/api/session`)).json();
  assert.equal(fresh.options[3].name, "Phoenix Team");
  const stale = await post("/api/vote", vote);
  assert.equal((await stale.json()).code, "session_changed");
  assert.equal((await post("/api/admin/open", { sessionId: fresh.session.id })).status, 200);
  assert.equal((await post("/api/vote", { ...vote, sessionId: fresh.session.id, optionId: fresh.options[3].id, optionsRevision: fresh.session.options_revision })).status, 201);
  assert.equal((await post("/api/vote", { ...vote, sessionId: fresh.session.id, optionId: fresh.options[2].id, optionsRevision: fresh.session.options_revision })).status, 409);
  const tenNames = Array.from({ length: 10 }, (_, i) => `Project ${i + 1}`);
  assert.equal((await post("/api/admin/new-session", { sessionId: fresh.session.id, name: "Ten projects", question: "Which project?", options: tenNames, confirm: true })).status, 200);
  const ten = await (await fetch(`${base}/api/session`)).json();
  assert.deepEqual(ten.options.map((o: { name: string }) => o.name), tenNames);
  assert.equal((await post("/api/admin/open", { sessionId: ten.session.id })).status, 200);
  assert.equal((await post("/api/vote", { ...vote, sessionId: ten.session.id, optionId: ten.options[9].id, optionsRevision: ten.session.options_revision })).status, 201);
  const networkVote = { sessionId: ten.session.id, optionId: ten.options[9].id, optionsRevision: ten.session.options_revision };
  for (let i = 0; i < 4; i++) assert.equal((await post("/api/vote", { ...networkVote, deviceId: randomUUID() })).status, 201);
  const blockedDevice = randomUUID();
  const blocked = await post("/api/vote", { ...networkVote, deviceId: blockedDevice, ip: "198.51.100.1", ip_hash: "f".repeat(64) });
  assert.equal(blocked.status, 409); assert.equal((await blocked.json()).code, "network_limit");
  assert.equal((await post("/api/admin/anti-abuse", { sessionId: ten.session.id, ipProtectionEnabled: true, maxVotesPerIp: 101, votingMode: "standard" }, base, true, "PATCH")).status, 400);
  assert.equal((await post("/api/admin/anti-abuse", { sessionId: ten.session.id, ipProtectionEnabled: true, maxVotesPerIp: 20, votingMode: "standard" }, "https://evil.example", true, "PATCH")).status, 403);
  assert.equal((await post("/api/admin/anti-abuse", { sessionId: ten.session.id, ipProtectionEnabled: true, maxVotesPerIp: 20, votingMode: "standard" }, base, true, "PATCH")).status, 200);
  const allowed = await post("/api/vote", { ...networkVote, deviceId: blockedDevice }); assert.equal(allowed.status, 201);
  assert.doesNotMatch(JSON.stringify(await allowed.json()), /ip_hash|203\.0\.113|voter_hash/);
  assert.equal((await post("/api/admin/new-session", { sessionId: ten.session.id, name: "Strict Round", question: "Choose once", options: ["Alpha", "Phoenix"], confirm: true })).status, 200);
  const strict = await (await fetch(`${base}/api/session`)).json();
  assert.equal((await post("/api/admin/anti-abuse", { sessionId: strict.session.id, ipProtectionEnabled: true, maxVotesPerIp: 5, votingMode: "strict_code" }, base, true, "PATCH")).status, 200);
  assert.equal((await post("/api/admin/codes", { sessionId: strict.session.id, count: 1001 })).status, 400);
  const generated = await post("/api/admin/codes", { sessionId: strict.session.id, count: 3 }); assert.equal(generated.status, 201);
  const batch = await generated.json(); assert.equal(batch.codes.length, 3);
  assert.ok(batch.codes.every((code: string) => /^[A-Z2-9]{6}$/.test(code)));
  const storedCodes = await db.query<{ code_hash: string }>("select code_hash from public.voter_codes");
  assert.equal(storedCodes.rows.length, 3);
  assert.ok(storedCodes.rows.every((row) => /^[a-f0-9]{64}$/.test(row.code_hash)));
  assert.ok(batch.codes.every((code: string) => !JSON.stringify(storedCodes.rows).includes(code)));
  assert.equal((await post("/api/admin/open", { sessionId: strict.session.id })).status, 200);
  const voteHtml = await (await fetch(`${base}/vote`)).text(); assert.ok(!voteHtml.includes(batch.codes[0]));
  const strictVote = { sessionId: strict.session.id, optionId: strict.options[0].id, optionsRevision: strict.session.options_revision };
  const firstDevice = randomUUID();
  const codeMissing = await post("/api/vote", { ...strictVote, deviceId: firstDevice }); assert.equal((await codeMissing.json()).code, "code_required");
  const badCode = await post("/api/vote", { ...strictVote, deviceId: firstDevice, votingCode: "BADBAD" }); assert.equal((await badCode.json()).code, "invalid_code");
  assert.equal((await post("/api/vote", { ...strictVote, deviceId: firstDevice, votingCode: batch.codes[0].toLowerCase() })).status, 201);
  const reused = await post("/api/vote", { ...strictVote, deviceId: randomUUID(), votingCode: batch.codes[0] }, base, false, "POST", { "x-vercel-forwarded-for": "2001:db8::9" });
  assert.equal(reused.status, 409); assert.equal((await reused.json()).code, "code_used");
  const duplicateDevice = await post("/api/vote", { ...strictVote, deviceId: firstDevice, votingCode: batch.codes[1] }); assert.equal((await duplicateDevice.json()).code, "duplicate");
  assert.equal((await post("/api/vote", { ...strictVote, deviceId: randomUUID(), votingCode: batch.codes[1] }, base, false, "POST", { "x-vercel-forwarded-for": "::ffff:203.0.113.11" })).status, 201);
  const codeRace = await Promise.all(Array.from({ length: 8 }, (_, i) => post("/api/vote", { ...strictVote, deviceId: randomUUID(), votingCode: batch.codes[2] }, base, false, "POST", { "x-vercel-forwarded-for": `2001:db8::${i + 10}` })));
  assert.equal(codeRace.filter((r) => r.status === 201).length, 1);
  assert.equal(codeRace.filter((r) => r.status === 409).length, 7);
  const stats = await (await fetch(`${base}/api/admin/codes?sessionId=${strict.session.id}`, { headers: { Cookie: cookie } })).json(); assert.equal(stats.stats.used, 3);
  const publicData = JSON.stringify(await (await fetch(`${base}/api/session`)).json());
  assert.doesNotMatch(publicData, /ip_hash|voter_hash|code_hash|voter_code_id/);
  assert.ok(batch.codes.every((code: string) => !publicData.includes(code)));
  const ips = (await db.query<{ ip_hash: string }>("select distinct ip_hash from public.votes")).rows;
  assert.ok(ips.every((row) => /^[a-f0-9]{64}$/.test(row.ip_hash)));
  const logout = await post("/api/admin/logout", {});
  assert.equal(logout.status, 200);
  assert.ok(logout.headers.get("set-cookie")?.includes("Max-Age=0"));
  cookie = "";
  assert.equal((await post("/api/admin/close", {})).status, 401);
  const attempts = [];
  for (let i = 0; i < 11; i++) attempts.push(await post("/api/admin/login", { password: "incorrect" }));
  assert.ok(attempts.some((response) => response.status === 401));
  assert.equal(attempts.at(-1)?.status, 429);
  assert.equal(attempts.at(-1)?.headers.get("Retry-After"), "60");
  assert.ok(attempts.every((response) => !response.headers.has("set-cookie")));
  const hashes = await db.query<{ voter_hash: string }>("select voter_hash from public.votes");
  assert.equal(hashes.rows.length, 13);
  assert.match(hashes.rows[0].voter_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hashes.rows[0].voter_hash, device);
});
