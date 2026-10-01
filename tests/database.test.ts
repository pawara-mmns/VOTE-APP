import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("SQL migration, atomic voting, historical sessions, RLS, and persistent rate limits", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(await readFile(new URL("../supabase/migrations/001_live_voting.sql", import.meta.url), "utf8"));
  const initial = await db.query<{ id: string; is_open: boolean }>("select id, is_open from public.voting_sessions where is_active");
  const id = initial.rows[0].id;
  const hash = "a".repeat(64);
  const otherHash = "b".repeat(64);
  async function cast(group: string, voter: string, session = id) {
    const result = await db.query<{ result: { status: string } }>("select public.cast_vote($1, $2, $3) as result", [session, group, voter]);
    return result.rows[0].result.status;
  }
  assert.equal(initial.rows[0].is_open, false);
  assert.equal((await db.query("select * from public.vote_totals")).rows.length, 4);
  assert.equal(await cast("A", hash), "closed");
  assert.equal(await cast("E", hash), "invalid");
  assert.equal(await cast("A", "raw-browser-id"), "invalid");
  await db.query("select public.set_voting_open(true)");
  assert.equal(await cast("A", hash), "success");
  assert.equal(await cast("B", hash), "duplicate");
  // Even direct privileged inserts cannot bypass the unique constraint.
  await assert.rejects(db.query("insert into public.votes (session_id, group_name, voter_hash) values ($1, 'D', $2)", [id, hash]), /duplicate key/);
  const attempts = await Promise.all(Array.from({ length: 20 }, () => cast("B", otherHash)));
  assert.equal(attempts.filter((s) => s === "success").length, 1);
  assert.equal(attempts.filter((s) => s === "duplicate").length, 19);
  const count = await db.query<{ sum: number }>("select sum(vote_count)::integer as sum from public.vote_totals where session_id = $1", [id]);
  assert.equal(count.rows[0].sum, 2);
  await db.exec("begin");
  assert.equal(await cast("C", "c".repeat(64)), "success");
  await db.exec("rollback");
  assert.equal((await db.query<{ n: number }>("select count(*)::integer n from public.votes")).rows[0].n, 2);
  assert.equal((await db.query<{ n: number }>("select sum(vote_count)::integer n from public.vote_totals")).rows[0].n, 2);
  await db.query("select public.set_voting_open(false)");
  assert.equal(await cast("D", "d".repeat(64)), "closed");
  const next = await db.query<{ id: string }>("select public.start_voting_session() id");
  const nextId = next.rows[0].id;
  assert.notEqual(nextId, id);
  assert.equal((await db.query("select * from public.voting_sessions where is_active")).rows.length, 1);
  assert.equal((await db.query("select * from public.vote_totals where session_id = $1", [nextId])).rows.length, 4);
  assert.equal((await db.query<{ n: number }>("select sum(vote_count)::integer n from public.vote_totals where session_id = $1", [nextId])).rows[0].n, 0);
  assert.equal((await db.query<{ n: number }>("select count(*)::integer n from public.votes where session_id = $1", [id])).rows[0].n, 2);
  await db.query("select public.set_voting_open(true)");
  assert.equal(await cast("A", hash), "session_changed");
  assert.equal(await cast("D", hash, nextId), "success");

  await db.exec("set role anon");
  assert.equal((await db.query("select * from public.voting_sessions")).rows.length, 1);
  assert.equal((await db.query("select * from public.vote_totals")).rows.length, 4);
  const snapshot = await db.query<{ result: { session: { id: string }; totals: { D: number } } }>("select public.get_voting_snapshot() result");
  assert.equal(snapshot.rows[0].result.session.id, nextId);
  assert.equal(snapshot.rows[0].result.totals.D, 1);
  await assert.rejects(db.query("select voter_hash from public.votes"), /permission denied/);
  await assert.rejects(db.query("select public.cast_vote($1, 'A', $2)", [nextId, "e".repeat(64)]), /permission denied/);
  await assert.rejects(db.query("select public.start_voting_session()"), /permission denied/);
  await assert.rejects(db.query("update public.vote_totals set vote_count = 99"), /permission denied/);
  await assert.rejects(db.query("insert into public.votes (session_id, group_name, voter_hash) values ($1, 'A', $2)", [nextId, "e".repeat(64)]), /permission denied/);
  await db.exec("reset role; set role service_role");
  for (let i = 0; i < 4; i++) {
    const r = await db.query<{ allowed: boolean }>("select public.consume_request_limit('test', 3, 60) allowed");
    assert.equal(r.rows[0].allowed, i < 3);
  }
  await db.exec("reset role");
  await db.query("update voting_private.request_limits set window_start = now() - interval '2 minutes' where key = 'test'");
  assert.equal((await db.query<{ allowed: boolean }>("select public.consume_request_limit('test', 3, 60) allowed")).rows[0].allowed, true);
  await db.query("update public.voting_sessions set is_active = false, is_open = false");
  assert.equal(await cast("A", "f".repeat(64)), "no_session");
});
