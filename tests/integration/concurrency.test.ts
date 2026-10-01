// Uses an isolated real PostgreSQL cluster when PostgreSQL tools are on PATH.
// Never connects to Supabase or to an existing local database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

function command(binary: string, args: string[]): Promise<string> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { errors += data; });
    // On Windows the detached server may inherit pg_ctl's pipe handles. Its
    // parent's exit, rather than the descendant closing those pipes, is final.
    child.on("exit", () => { if (binary === "pg_ctl") { child.stdout.destroy(); child.stderr.destroy(); } });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveCommand(output.trim()) : reject(new Error(`${binary} failed: ${errors}`)));
  });
}

test("independent PostgreSQL connections cannot exceed a network cap or reuse a code", { timeout: 60_000 }, async (t) => {
  try { await command("initdb", ["--version"]); await command("pg_ctl", ["--version"]); await command("psql", ["--version"]); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { t.skip("PostgreSQL tools are not installed on PATH"); return; }
    throw error;
  }
  const directory = await mkdtemp(join(tmpdir(), "live-vote-pg-"));
  let started = false;
  t.after(async () => {
    if (started) await command("pg_ctl", ["-D", directory, "-m", "immediate", "-w", "stop"]);
    // Delete only the exact temporary directory created by this test.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("live-vote-pg-"));
    await rm(directory, { recursive: true, force: true });
  });
  const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const address = reservation.address(); assert.ok(address && typeof address !== "string");
  const port = String(address.port); await new Promise<void>((done) => reservation.close(() => done()));
  await command("initdb", ["-D", directory, "-U", "postgres", "--auth=trust", "--no-locale", "--encoding=UTF8"]);
  await command("pg_ctl", ["-D", directory, "-l", join(directory, "test.log"), "-o", `-h 127.0.0.1 -p ${port} -c max_connections=60 -c log_statement=none`, "-w", "start"]);
  started = true;
  const connection = ["-X", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"];
  const sql = (statement: string) => command("psql", [...connection, "-c", statement]);
  await sql("create role anon; create role authenticated; create role service_role bypassrls;");
  for (const name of ["001_live_voting", "002_configurable_voting", "003_vote_protection"]) {
    await command("psql", [...connection, "-f", fileURLToPath(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url))]);
  }
  const id = await sql("select id from public.voting_sessions where is_active");
  const option = await sql(`select id from public.voting_options where session_id='${id}' order by display_order limit 1`);
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const network = digest("shared-network");
  await sql("select public.set_voting_open(true)");
  const cast = (device: string, ip: string, code: string | null = null) => sql(`select public.cast_option_vote('${id}','${option}','${digest(device)}',0,'${ip}',${code ? `'${code}'` : "null"})->>'status'`);
  const first = await Promise.all(Array.from({ length: 25 }, (_, i) => cast(`device-${i}`, network)));
  assert.equal(first.filter((status) => status === "success").length, 5);
  assert.equal(first.filter((status) => status === "network_limit").length, 20);
  assert.equal(await sql(`select count(*) from public.votes where session_id='${id}'`), "5");
  assert.equal(await sql(`select sum(vote_count) from public.vote_totals where session_id='${id}'`), "5");
  assert.equal(await sql(`select public.configure_voting_protection('${id}',true,20,'standard')->>'status'`), "success");
  const more = await Promise.all(Array.from({ length: 25 }, (_, i) => cast(`additional-${i}`, network)));
  assert.equal(more.filter((status) => status === "success").length, 15);
  assert.equal(await sql(`select vote_count from voting_private.ip_vote_counts where session_id='${id}'`), "20");
  const next = JSON.parse(await sql(`select public.create_voting_session('Strict','Choose',null,array['Alpha','Phoenix'],'${id}')`)).session_id as string;
  const nextOption = await sql(`select id from public.voting_options where session_id='${next}' order by display_order limit 1`);
  const code = digest("single-code");
  await sql(`select public.configure_voting_protection('${next}',true,5,'strict_code'); select public.generate_voter_codes('${next}',array['${code}']); select public.set_voting_open(true);`);
  const races = await Promise.all(Array.from({ length: 25 }, (_, i) => sql(`select public.cast_option_vote('${next}','${nextOption}','${digest(`incognito-${i}`)}',0,'${digest(`network-${i}`)}','${code}')->>'status'`)));
  assert.equal(races.filter((status) => status === "success").length, 1);
  assert.equal(races.filter((status) => status === "code_used").length, 24);
  assert.equal(await sql(`select count(*) from public.votes where session_id='${next}'`), "1");
  assert.equal(await sql(`select sum(vote_count) from voting_private.ip_vote_counts where session_id='${next}'`), "1");
  assert.equal(await sql(`select count(*) from public.voter_codes where session_id='${next}' and used_at is not null`), "1");
});
