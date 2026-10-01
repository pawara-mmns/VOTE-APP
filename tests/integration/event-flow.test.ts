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

test("HTTP event flow: auth, open, vote, duplicate, close, rollover and logout", { timeout: 60_000 }, async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(await readFile(new URL("../../supabase/migrations/001_live_voting.sql", import.meta.url), "utf8"));
  const rpcArgs: Record<string, string[]> = {
    get_voting_snapshot: [],
    cast_vote: ["p_session_id", "p_group_name", "p_voter_hash"],
    consume_request_limit: ["p_key", "p_limit", "p_window_seconds"],
    set_voting_open: ["p_is_open"],
    start_voting_session: [],
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
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${address.port}`, SUPABASE_SERVICE_ROLE_KEY: "local-test-service-key", NEXT_PUBLIC_APP_URL: base, ADMIN_PASSWORD: "local-test-admin-password", ADMIN_SESSION_SECRET: "local-test-session-secret-at-least-32-chars", VOTER_HASH_SECRET: "local-test-voter-secret-at-least-32-chars", NODE_ENV: "production" },
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
  async function post(path: string, body: Record<string, unknown>, origin = base, authenticated = true) {
    return fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(authenticated && cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  }
  for (const route of ["/", "/vote", "/results", "/admin"]) assert.equal((await fetch(`${base}${route}`)).status, 200);
  assert.equal((await post("/api/admin/open", {})).status, 401);
  assert.equal((await post("/api/admin/login", { password: "incorrect" })).status, 401);
  assert.equal((await post("/api/admin/login", { password: "local-test-admin-password" }, "https://evil.example")).status, 403);
  const login = await post("/api/admin/login", { password: "local-test-admin-password" });
  assert.equal(login.status, 200);
  const header = login.headers.get("set-cookie");
  assert.ok(header);
  assert.ok(header.includes("HttpOnly") && header.includes("Secure") && header.includes("SameSite=strict"));
  cookie = header.split(";")[0];
  const adminHtml = await (await fetch(`${base}/admin`, { headers: { Cookie: cookie } })).text();
  assert.match(adminHtml, /You run the moment/);
  assert.doesNotMatch(adminHtml, /local-test-admin-password/);
  assert.equal((await post("/api/admin/open", {})).status, 200);
  const session = await (await fetch(`${base}/api/session`)).json();
  const device = randomUUID();
  const vote = { sessionId: session.session.id, deviceId: device, group: "B" };
  assert.equal((await post("/api/vote", { ...vote, group: "E" })).status, 400);
  assert.equal((await post("/api/vote", vote, "https://evil.example")).status, 403);
  const burst = await Promise.all(Array.from({ length: 8 }, () => post("/api/vote", vote)));
  assert.equal(burst.filter((r) => r.status === 201).length, 1);
  assert.equal(burst.filter((r) => r.status === 409).length, 7);
  const totals = await (await fetch(`${base}/api/session`)).json();
  assert.equal(totals.totals.B, 1);
  assert.equal((await post("/api/admin/close", {})).status, 200);
  const closed = await post("/api/vote", { ...vote, deviceId: randomUUID() });
  assert.equal(closed.status, 409);
  assert.equal((await closed.json()).code, "closed");
  assert.equal((await post("/api/admin/new-session", {})).status, 400);
  assert.equal((await post("/api/admin/new-session", { confirm: true })).status, 200);
  const fresh = await (await fetch(`${base}/api/session`)).json();
  assert.notEqual(fresh.session.id, session.session.id);
  assert.equal(fresh.session.is_open, false);
  assert.deepEqual(fresh.totals, { A: 0, B: 0, C: 0, D: 0 });
  const stale = await post("/api/vote", vote);
  assert.equal((await stale.json()).code, "session_changed");
  assert.equal((await post("/api/admin/open", {})).status, 200);
  assert.equal((await post("/api/vote", { ...vote, sessionId: fresh.session.id })).status, 201);
  const logout = await post("/api/admin/logout", {});
  assert.equal(logout.status, 200);
  assert.ok(logout.headers.get("set-cookie")?.includes("Max-Age=0"));
  cookie = "";
  assert.equal((await post("/api/admin/close", {})).status, 401);
  const hashes = await db.query<{ voter_hash: string }>("select voter_hash from public.votes");
  assert.equal(hashes.rows.length, 2);
  assert.match(hashes.rows[0].voter_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hashes.rows[0].voter_hash, device);
});
