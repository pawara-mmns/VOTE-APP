import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("upgrade preserves existing votes and supports configurable sessions with guarded options", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(await readFile(new URL("../supabase/migrations/001_live_voting.sql", import.meta.url), "utf8"));
  const oldId = (await db.query<{ id: string }>("select id from public.voting_sessions where is_active")).rows[0].id;
  await db.query("select public.set_voting_open(true)");
  await db.query("select public.cast_vote($1, 'A', $2)", [oldId, "a".repeat(64)]);
  const oldVotes = (await db.query("select id, session_id, voter_hash, created_at from public.votes")).rows;
  await db.exec(await readFile(new URL("../supabase/migrations/002_configurable_voting.sql", import.meta.url), "utf8"));
  assert.deepEqual((await db.query("select id, session_id, voter_hash, created_at from public.votes")).rows, oldVotes);
  const initial = (await db.query<{ data: { options: { id: string; name: string; vote_count: number }[]; totals: { A: number } } }>("select public.get_voting_snapshot() data")).rows[0].data;
  assert.equal(initial.options[0].name, "Group A");
  assert.equal(initial.options[0].vote_count, 1);
  assert.equal(initial.totals.A, 1);
  // Old deployed database RPC remains usable during rollout.
  const legacy = await db.query<{ data: { status: string } }>("select public.cast_vote($1, 'D', $2) data", [oldId, "d".repeat(64)]);
  assert.equal(legacy.rows[0].data.status, "success");
  const compatible = (await db.query<{ data: { status: string; option_id: string } }>("select public.cast_legacy_option_vote($1, 'B', $2) data", [oldId, "b".repeat(64)])).rows[0].data;
  assert.equal(compatible.status, "success");
  assert.equal(compatible.option_id, initial.options[1].id);
  async function configure(id: string, action: string, payload: object = {}) {
    const result = await db.query<{ data: { status: string } }>("select public.configure_voting_session($1, $2, $3) data", [id, action, JSON.stringify(payload)]);
    return result.rows[0].data.status;
  }
  assert.equal(await configure(oldId, "rename", { optionId: initial.options[0].id, name: "Unsafe" }), "options_locked");
  assert.equal(await configure(oldId, "settings", { name: "Existing Event", question: "Updated question", description: "Updated description" }), "success");
  const names = ["Alpha", "Phoenix", "Galaxy", "Nova", "Orion"];
  const created = (await db.query<{ data: { status: string; session_id: string } }>("select public.create_voting_session('Round 2', 'Choose the best', '', $1, $2) data", [names, oldId])).rows[0].data;
  assert.equal(created.status, "success");
  const id = created.session_id;
  async function options() { return (await db.query<{ id: string; name: string; display_order: number }>("select id, name, display_order from public.voting_options where session_id = $1 order by display_order", [id])).rows; }
  let list = await options();
  assert.equal(list.length, 5);
  assert.equal(await configure(id, "rename", { optionId: list[1].id, name: " Phoenix Team " }), "success");
  assert.equal(await configure(id, "add", { name: "alpha" }), "duplicate_name");
  assert.equal(await configure(id, "reorder", { optionIds: [...list].reverse().map((o) => o.id) }), "success");
  list = await options();
  assert.equal(list[0].name, "Orion");
  assert.equal(list[3].name, "Phoenix Team");
  assert.equal(await configure(id, "delete", { optionId: list[0].id }), "success");
  assert.deepEqual((await options()).map((o) => o.display_order), [1, 2, 3, 4]);
  for (let i = 4; i < 20; i++) assert.equal(await configure(id, "add", { name: `Option ${i}` }), "success");
  assert.equal((await options()).length, 20);
  assert.equal(await configure(id, "add", { name: "Overflow" }), "option_bounds");
  assert.equal(await configure(id, "reorder", { optionIds: Array(20).fill(list[1].id) }), "invalid_option");
  assert.equal(await configure(oldId, "settings", { name: "Stale", question: "Stale" }), "session_changed");
  list = await options();
  assert.equal(await configure(id, "open"), "success");
  assert.equal(await configure(id, "add", { name: "During voting" }), "voting_open");
  const revision = (await db.query<{ n: number }>("select options_revision n from public.voting_sessions where id = $1", [id])).rows[0].n;
  async function cast(option: string, hash: string, rev = revision, session = id) {
    return (await db.query<{ data: { status: string } }>("select public.cast_option_vote($1, $2, $3, $4) data", [session, option, hash, rev])).rows[0].data.status;
  }
  assert.equal(await cast(list[0].id, "a".repeat(64), revision - 1), "options_changed");
  assert.equal(await cast(initial.options[0].id, "a".repeat(64)), "invalid_option");
  assert.equal(await cast(list[0].id, "a".repeat(64)), "success");
  assert.equal(await cast(list[1].id, "a".repeat(64)), "duplicate");
  assert.equal(await configure(id, "close"), "success");
  assert.equal(await cast(list[1].id, "b".repeat(64)), "closed");
  for (const action of ["add", "rename", "delete", "reorder"]) assert.equal(await configure(id, action, {}), "options_locked");
  await assert.rejects(db.query("update public.voting_options set name = 'Unsafe' where id = $1", [list[1].id]), /locked/);
  assert.equal((await db.query<{ n: number }>("select count(*)::integer n from public.votes where session_id = $1", [oldId])).rows[0].n, 3);
  await db.exec("set role anon");
  assert.equal((await db.query("select * from public.voting_options")).rows.length, 20);
  await assert.rejects(db.query("select * from public.votes"), /permission denied/);
  await assert.rejects(db.query("update public.voting_options set name = 'Attack'"), /permission denied/);
  await assert.rejects(db.query("select public.configure_voting_session($1, 'close', '{}')", [id]), /permission denied/);
  await db.exec("reset role");
  const minimal = (await db.query<{ data: { session_id: string } }>("select public.create_voting_session('Minimal', 'Pick one', null, $1, $2) data", [["One", "Two"], id])).rows[0].data.session_id;
  const first = (await db.query<{ id: string }>("select id from public.voting_options where session_id = $1", [minimal])).rows[0].id;
  assert.equal(await configure(minimal, "delete", { optionId: first }), "option_bounds");
  await assert.rejects(db.query("delete from public.voting_options where id = $1", [first]), /2 to 20/);
});
