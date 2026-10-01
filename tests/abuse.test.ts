import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { normalizeIP, requestIP, networkHash, normalizeCode, votingCodeHash, generateCodes, abuseSettings, codeCount } from "../lib/voting/abuse.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
test("IP normalization, trusted header boundaries, code generation and settings validation", () => {
  assert.equal(normalizeIP(" 203.0.113.8 "), "203.0.113.8");
  assert.equal(normalizeIP("2001:0DB8:0000:0000:0000:0000:0000:0001"), "2001:db8::1");
  assert.equal(normalizeIP("[2001:db8::1]"), "2001:db8::1");
  assert.equal(normalizeIP("::ffff:203.0.113.8"), "203.0.113.8");
  assert.equal(normalizeIP("::FFFF:CB00:7108"), "203.0.113.8");
  for (const value of ["invalid", "01.2.3.4", "127.0.0.1:80", "fe80::1%eth0", "", "999.1.1.1"]) assert.equal(normalizeIP(value), null);
  const headers = new Headers({ "x-vercel-forwarded-for": "2001:db8::1, 10.0.0.1", "x-forwarded-for": "203.0.113.8", "x-real-ip": "203.0.113.9" });
  assert.equal(requestIP(headers, true, false), "2001:db8::1");
  assert.equal(requestIP(headers, false, false), null);
  assert.equal(requestIP(headers, false, true), "127.0.0.1");
  headers.delete("x-vercel-forwarded-for"); assert.equal(requestIP(headers, true, false), "203.0.113.8");
  headers.delete("x-forwarded-for"); assert.equal(requestIP(headers, true, false), "203.0.113.9");
  headers.set("x-vercel-forwarded-for", "forged"); assert.equal(requestIP(headers, true, false), null);
  assert.equal(requestIP(new Headers(), true, false), null);
  const secret = "a".repeat(64);
  assert.match(networkHash("203.0.113.8", secret), /^[a-f0-9]{64}$/);
  assert.notEqual(networkHash("203.0.113.8", secret), networkHash("203.0.113.8", "b".repeat(64)));
  assert.equal(normalizeCode(" a7k9p2 "), "A7K9P2");
  assert.equal(normalizeCode("A7K9P2x"), null);
  assert.notEqual(votingCodeHash("A7K9P2", secret), networkHash("A7K9P2", secret));
  const codes = generateCodes(1000); assert.equal(new Set(codes).size, 1000);
  assert.ok(codes.every((code) => /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)));
  assert.equal(codeCount(1000), 1000);
  for (const value of [0, 1001, 1.5, "100"]) assert.throws(() => codeCount(value));
  for (const maxVotesPerIp of [1, 100]) assert.equal(abuseSettings({ ipProtectionEnabled: true, maxVotesPerIp, votingMode: "strict_code" }).p_max_votes_per_ip, maxVotesPerIp);
  for (const maxVotesPerIp of [0, 101, 2.1, "5"]) assert.throws(() => abuseSettings({ ipProtectionEnabled: true, maxVotesPerIp, votingMode: "standard" }));
  assert.throws(() => abuseSettings({ ipProtectionEnabled: "true", maxVotesPerIp: 5, votingMode: "standard" }));
});

test("anti-abuse migration preserves history, caps networks and consumes codes transactionally", async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  for (const name of ["001_live_voting", "002_configurable_voting"]) await db.exec(await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8"));
  const id = (await db.query<{ id: string }>("select id from public.voting_sessions where is_active")).rows[0].id;
  const option = (await db.query<{ id: string }>("select id from public.voting_options where session_id=$1 order by display_order", [id])).rows[0].id;
  await db.query("select public.set_voting_open(true)");
  await db.query("select public.cast_option_vote($1,$2,$3,0)", [id, option, hash("historical")]);
  const before = (await db.query("select id,session_id,option_id,voter_hash,created_at from public.votes")).rows;
  await db.exec(await readFile(new URL("../supabase/migrations/003_vote_protection.sql", import.meta.url), "utf8"));
  assert.deepEqual((await db.query("select id,session_id,option_id,voter_hash,created_at from public.votes")).rows, before);
  assert.equal((await db.query<{ ip_hash: string | null }>("select ip_hash from public.votes")).rows[0].ip_hash, null);
  async function cast(device: string, ip = "wifi", code: string | null = null, session = id, selected = option, revision = 0) {
    const result = await db.query<{ data: { status: string } }>("select public.cast_option_vote($1,$2,$3,$4,$5,$6) data", [session, selected, hash(device), revision, hash(ip), code ? hash(code) : null]);
    return result.rows[0].data.status;
  }
  async function protection(enabled: boolean, max: number, mode = "standard", session = id) {
    return (await db.query<{ data: { status: string } }>("select public.configure_voting_protection($1,$2,$3,$4) data", [session, enabled, max, mode])).rows[0].data.status;
  }
  assert.equal(await cast("historical"), "duplicate");
  assert.equal(await cast("device-a"), "success");
  assert.equal(await cast("device-a", "another-network"), "duplicate");
  for (let i = 1; i < 5; i++) assert.equal(await cast(`phone-${i}`), "success");
  assert.equal(await cast("incognito-new-device"), "network_limit");
  assert.equal(await cast("phone-six"), "network_limit");
  assert.equal((await db.query<{ vote_count: number }>("select vote_count::integer from voting_private.ip_vote_counts where session_id=$1 and ip_hash=$2", [id, hash("wifi")])).rows[0].vote_count, 5);
  assert.equal(await protection(true, 20), "success");
  assert.equal(await cast("phone-six"), "success");
  assert.equal(await protection(true, 5), "success");
  assert.equal(await cast("phone-seven"), "network_limit");
  assert.equal(await protection(false, 5), "success");
  assert.equal(await cast("phone-seven"), "success");
  assert.equal(await protection(true, 20), "success");
  const attempts = await Promise.all(Array.from({ length: 30 }, (_, i) => cast(`burst-${i}`)));
  assert.equal(attempts.filter((status) => status === "success").length, 13);
  assert.equal(attempts.filter((status) => status === "network_limit").length, 17);
  assert.equal(await protection(true, 5, "strict_code"), "mode_locked");
  for (const statement of ["select public.cast_vote($1,'A',$2) data", "select public.cast_option_vote($1,$3,$2,0) data", "select public.cast_legacy_option_vote($1,'A',$2) data"]) {
    const args = statement.includes("$3") ? [id, hash("bypass"), option] : [id, hash("bypass")];
    assert.equal((await db.query<{ data: { status: string } }>(statement, args)).rows[0].data.status, "upgrade_required");
  }
  await assert.rejects(db.query("insert into public.votes(session_id,option_id,voter_hash) values($1,$2,$3)", [id, option, hash("missing-ip")]), /network hash/);
  const next = (await db.query<{ data: { session_id: string } }>("select public.create_voting_session('Strict','Choose',null,$1,$2) data", [["Alpha", "Phoenix"], id])).rows[0].data.session_id;
  const nextOption = (await db.query<{ id: string }>("select id from public.voting_options where session_id=$1 order by display_order", [next])).rows[0].id;
  assert.equal(await protection(true, 1, "strict_code", next), "success");
  const codes = ["code-one", "code-two", "code-three"].map(hash);
  assert.equal((await db.query<{ data: { status: string } }>("select public.generate_voter_codes($1,$2) data", [next, codes])).rows[0].data.status, "success");
  assert.equal((await db.query<{ data: { status: string } }>("select public.generate_voter_codes($1,$2) data", [next, [hash("code-four"), codes[0]]])).rows[0].data.status, "code_collision");
  assert.equal((await db.query("select * from public.voter_codes")).rows.length, 3);
  await db.query("select public.set_voting_open(true)");
  const strictCast = (device: string, ip: string, code: string | null) => cast(device, ip, code, next, nextOption);
  assert.equal(await strictCast("fresh", "strict-net", null), "code_required");
  assert.equal(await strictCast("fresh", "strict-net", "missing"), "invalid_code");
  await db.exec("begin"); assert.equal(await strictCast("fresh", "strict-net", "code-one"), "success"); await db.exec("rollback");
  assert.equal((await db.query("select * from voting_private.ip_vote_counts where session_id=$1", [next])).rows.length, 0);
  assert.equal((await db.query<{ used_at: string | null }>("select used_at from public.voter_codes where code_hash=$1", [codes[0]])).rows[0].used_at, null);
  assert.equal(await strictCast("fresh", "strict-net", "code-one"), "success");
  assert.equal(await strictCast("incognito", "different-net", "code-one"), "code_used");
  assert.equal(await strictCast("other", "strict-net", "code-two"), "network_limit");
  assert.equal((await db.query<{ used_at: string | null }>("select used_at from public.voter_codes where code_hash=$1", [codes[1]])).rows[0].used_at, null);
  assert.equal(await strictCast("fresh", "different-net", "code-two"), "duplicate");
  assert.equal(await strictCast("other", "different-net", "code-two"), "success");
  const races = await Promise.all(Array.from({ length: 12 }, (_, i) => strictCast(`race-${i}`, `network-${i}`, "code-three")));
  assert.equal(races.filter((status) => status === "success").length, 1);
  assert.equal(races.filter((status) => status === "code_used").length, 11);
  const totals = (await db.query<{ n: number }>("select sum(vote_count)::integer n from public.vote_totals where session_id=$1", [next])).rows[0].n;
  assert.equal(totals, 3);
  const counters = (await db.query<{ n: number }>("select sum(vote_count)::integer n from voting_private.ip_vote_counts where session_id=$1", [next])).rows[0].n;
  assert.equal(counters, 3);
  const snapshot = (await db.query<{ data: unknown }>("select public.get_voting_snapshot() data")).rows[0].data;
  assert.ok(!JSON.stringify(snapshot).includes(codes[0]));
  assert.ok(!JSON.stringify(snapshot).includes(hash("strict-net")));
  await db.exec("set role anon");
  for (const sql of ["select * from public.votes", "select * from public.voter_codes", "select * from voting_private.ip_vote_counts", "select public.get_voter_code_stats($1)", "select public.generate_voter_codes($1,array[]::text[])", "select public.configure_voting_protection($1,true,100,'standard')"]) {
    await assert.rejects(db.query(sql, sql.includes("$1") ? [next] : []), /permission denied/);
  }
  await assert.rejects(db.query("select public.cast_option_vote($1,$2,$3,0,$4,null)", [next, nextOption, hash("attack"), hash("net")]), /permission denied/);
  await db.exec("reset role; set role service_role");
  await assert.rejects(db.query("select * from public.voter_codes"), /permission denied/);
  assert.equal((await db.query<{ data: { stats: { used: number } } }>("select public.get_voter_code_stats($1) data", [next])).rows[0].data.stats.used, 3);
});
