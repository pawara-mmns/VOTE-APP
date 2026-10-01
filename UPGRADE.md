# Upgrade the deployed voting app

## Add network protection and one-time codes (migration 003)

If your database already has configurable voting options from migration 002, run **only `supabase/migrations/003_vote_protection.sql`** for this update. Do not rerun 001 or 002. For an installation still on 001, first follow the configurable-polls steps below, then apply 003 before deploying this code.

1. **Close voting using the currently deployed admin page** before the upgrade. Keep it closed until the migration and deployment both finish.
2. Generate a new independent secret locally: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Add it as **`IP_HASH_SECRET`** to your local `.env.local` and to the existing Vercel project's **Settings → Environment Variables** for every environment using this database. Do not put it in a `NEXT_PUBLIC_` variable or commit it. Keep all existing secrets unchanged.
3. In the existing Supabase project's **SQL Editor → New query**, paste the complete [003_vote_protection.sql](supabase/migrations/003_vote_protection.sql) file and click **Run** once. It runs in a transaction and preserves every existing session, vote, voter hash, timestamp and total. Existing votes retain `ip_hash = NULL`, because their actual historical IP cannot be recovered safely. New votes require a valid hash through a database trigger.
4. Push this code to the branch connected to your existing Vercel project and deploy the new commit. Ensure `IP_HASH_SECRET` is available before building/redeploying. An older deployment cannot submit votes after 003: its hash-less voting RPCs now return `upgrade_required`. This closes alternate paths around protection, so finish the coordinated redeployment before reopening voting. The upgraded endpoint still accepts group payloads from old browser tabs where their legacy option mapping is valid, and supplies the new protections server-side.
5. Restart the local dev server after changing environment variables. Reload the event's `/admin`, `/vote`, `/results` and QR page after deployment. The QR URL and existing localStorage device ID remain unchanged.
6. In **Anti-Abuse Protection**, choose ON/OFF and a network quota from 1–100 (default 5). Quota changes are allowed during voting. Keep the Wi-Fi helper text in mind when choosing 1. Device protection always stays enabled.
7. For strict mode, create a new session, choose **Strict Code** before opening voting, and click **Save Settings**. Generate and immediately download codes, give exactly one to each participant, then open voting. Mode changes are blocked while open or once votes exist; use a new session to switch later.

The migration adds session settings (`ip_protection_enabled`, `max_votes_per_ip`, `voting_mode`), nullable historical `votes.ip_hash`, an indexed network lookup, private transactional network counters, `voter_codes` and an optional code reference on new votes. It retains `UNIQUE(session_id, voter_hash)` and deliberately does **not** create a unique network-IP constraint. Strict-mode codes have `UNIQUE(session_id, code_hash)` and a locked, atomic used-at update. New RPCs are service-role-only; code tables and counters have no browser access and are never added to Realtime.

Network counter rows are incremented by an atomic conditional UPSERT within the insert trigger. Concurrent votes on one network cannot exceed its quota; failed inserts roll back counters and code consumption. Counts continue while protection is off, so turning it back on uses the full known count. Unknown historical IPs are excluded. `IP_HASH_SECRET` also hashes voting codes with a separate domain prefix; keep it fixed through the active session to avoid resetting quotas or invalidating codes.

Verify without displaying identifiers:

```sql
select name, is_open, ip_protection_enabled, max_votes_per_ip, voting_mode
from public.voting_sessions where is_active;

select count(*) as total_votes,
  count(*) filter (where ip_hash is null) as historical_unknown_network,
  count(*) filter (where ip_hash is not null) as protected_votes
from public.votes;

-- Should return true; counter totals equal new votes with known networks.
select (select count(*) from public.votes where ip_hash is not null)
  = coalesce((select sum(vote_count) from voting_private.ip_vote_counts), 0)
  as network_counters_match;

select session_id, count(*) as generated_codes,
  count(*) filter (where used_at is not null) as used_codes
from public.voter_codes group by session_id;
```

Rehearse in a **new test session**: vote twice from one browser (second blocked); allow five different browsers/devices on one network with quota 5 (sixth blocked); raise to 20 and retry (accepted). In a second session, enable Strict Code, generate codes, vote once, then try the used code in incognito from another network (blocked). A rejected vote must not consume an unused code. Old sessions and totals must remain saved. Set an appropriate quota before the actual event.

Implementation files for this update: `supabase/migrations/003_vote_protection.sql`, `lib/voting/abuse.ts`, `lib/voting/abuse-server.ts`, `components/AntiAbuseEditor.tsx`, `app/api/admin/anti-abuse/route.ts`, `app/api/admin/codes/route.ts`, `tests/abuse.test.ts`, and `tests/integration/concurrency.test.ts`. Existing vote route, session types/snapshot checks, admin result messages/dashboard, voting page, styles, environment template, README and HTTP integration tests are updated. No runtime dependencies were added.

## Configurable polls (migration 002)

1. Finish the current voting round, then **Close voting** in the existing admin dashboard. Your current votes stay saved.
2. Open the same Supabase project's **SQL Editor → New query**.
3. Paste the entire contents of **`supabase/migrations/002_configurable_voting.sql`** and click **Run**. Run this migration once, after the already-installed `001_live_voting.sql`. **Do not rerun 001 on your existing project.** No production tables need manual editing.
4. Check the verification queries below. The migration is transactional: a missing legacy mapping or invalid option count aborts the whole upgrade. If the SQL Editor reports an error, stop the redeployment and resolve that error first; do not remove constraints or wipe tables.
5. Push the changed files to the production branch of the GitHub repository connected to your **existing** Vercel project. Its normal production deployment will build the updated app. To trigger it manually, open Vercel → existing project → Deployments → Create Deployment, enter the new commit SHA or production branch, and deploy. Confirm the new commit is used; Redeploy on an older deployment rebuilds that older commit. See [Vercel Git deployments](https://vercel.com/docs/git).
6. Keep all existing environment variables, especially `VOTER_HASH_SECRET` and `ADMIN_SESSION_SECRET`. Migration 002 itself needs no new variable; migration 003 requires `IP_HASH_SECRET` as described above. Keep `NEXT_PUBLIC_APP_URL` set to the same HTTPS origin. Do not change the QR URL when starting a poll.
7. Wait for the deployment to become Ready, then reload `/admin`, `/vote`, `/results`, and the projector home page. Finish redeployment before using the new option editor or creating custom polls.
8. Sign in with the existing admin password. Check the migrated session and counts. Start a new session if the current session already contains votes, then configure its options and open voting manually.

Migration 002 retains nullable legacy `group_name` columns, mappings, and old database RPCs for its deployment transition. Migration 003 subsequently closes hash-less RPCs as described above. The updated UI and vote transaction use option IDs. The public snapshot retains legacy totals as an extra compatibility field. Already-open old browser tabs can submit to an unchanged migrated poll through the upgraded server endpoint; after its option configuration changes, they must reload. Old browser bundles cannot display arbitrary new polls, so reload the event devices after deployment. Old localStorage receipts and the existing browser identifier continue to work.

## Database changes

- `voting_sessions`: adds `question`, optional `description`, and `options_revision`. The existing single-active-session index stays intact.
- `voting_options`: adds UUID option IDs, session ownership, configurable names, display order, timestamps and active-session read policies. Option names are unique per session, including case-insensitive duplicates.
- `votes`: adds required `option_id`; existing votes are mapped to their legacy option. Vote IDs, voter hashes, timestamps and the `UNIQUE(session_id, voter_hash)` constraint are unchanged.
- `vote_totals`: adds required `option_id` and uses `(session_id, option_id)` as its primary key. Exact existing counters are preserved. Each new option initializes one zero total.
- Composite foreign keys reject cross-session options. Atomic vote insertion + trigger increment remains in place.
- Session and option mutations serialize with the existing admin lock. They lock the session against in-flight votes and reject stale session IDs. Option changes are blocked while voting is open and permanently blocked after the first vote; metadata remains editable.
- Deferred database checks enforce 2–20 options even when inserting a complete session transactionally.
- Public users cannot write sessions, options, totals or votes, or read raw votes and voter hashes. Admin mutation RPCs remain service-role-only.
- Realtime still publishes only `vote_totals`. The browser subscribes with the active session's ID and replaces the subscription when the session changes. A five-second lightweight snapshot check detects rollover and reconnects missed updates without refreshing the whole page.

## Verification in Supabase

These queries expose counts and names, not voter identifiers:

```sql
-- Exactly one active session, with configured settings.
select id, name, question, description, is_active, is_open
from public.voting_sessions
order by created_at;

-- Every old and new session should have 2–20 options and a total per option.
select s.id, s.name,
  count(o.id) as options,
  count(t.option_id) as totals,
  coalesce(sum(t.vote_count), 0) as total_votes
from public.voting_sessions s
left join public.voting_options o on o.session_id = s.id
left join public.vote_totals t on t.session_id = s.id and t.option_id = o.id
group by s.id, s.name;

-- Normally returns zero rows: compare stored totals with actual vote counts.
select t.session_id, o.name, t.vote_count, count(v.id) as actual_votes
from public.vote_totals t
join public.voting_options o on o.id = t.option_id
left join public.votes v on v.session_id = t.session_id and v.option_id = t.option_id
group by t.session_id, o.name, t.option_id, t.vote_count
having t.vote_count <> count(v.id);

-- vote_totals should still be enabled; the migration leaves its publication intact.
select schemaname, tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'vote_totals';
```

If the last query is empty, run `alter publication supabase_realtime add table public.vote_totals;` once. Do not publish raw votes for this app. See [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

## Test the admin customization

1. Start **Round 1**, question **Vote Your Team**, with four team names. New sessions start CLOSED.
2. Before opening voting, rename an option, add another option, move it up/down, and delete it after confirming. Check **Current Poll Preview**, the home page, `/vote` and `/results`.
3. Open voting. On Device 1, select one option and confirm. Its count becomes 1. A second submission by that browser in this session is rejected.
4. Vote for a different option on Device 2. Results update automatically; equal counts have equal ranks and use display order to resolve their screen order.
5. Try option editing after votes exist: the controls are disabled and the server rejects direct requests too. Session name, question and description can still be saved.
6. Close voting and confirm the dialog. A new participant cannot vote while closed.
7. Create **Round 2** with five different options. Rename **Phoenix** to **Phoenix Team** before opening. The same Device 1 can vote once again after opening this new session.
8. Create a poll with 10 options and rehearse it on a 360px phone and a 1920×1080 projector. Try 2 and 20 options as boundary cases. Names wrap; long option lists scroll, and larger result lists use compact columns.
9. Disconnect/reconnect the results display briefly and verify automatic recovery. Starting another session should appear automatically within five seconds, then use that session's Realtime subscription.

Migration 002 alone uses browser identity. Migration 003 adds network quotas and optional one-time codes, as described above, without adding participant accounts.

## File changes

Modified existing files:

```text
README.md
app/api/admin/[action]/route.ts
app/api/session/route.ts
app/api/vote/route.ts
app/globals.css
components/Admin.tsx
components/Presentation.tsx
components/ResultBar.tsx
components/ResultsPage.tsx
components/Shell.tsx
components/VoteResults.tsx
components/VotingPage.tsx
lib/client-api.ts
lib/http.ts
lib/supabase/server.ts
lib/voting/server.ts
lib/voting/types.ts
lib/voting/use-live-session.ts
tests/integration/event-flow.test.ts
tests/security.test.ts
```

New files:

```text
UPGRADE.md
app/api/admin/session/route.ts
app/api/admin/options/route.ts
app/api/admin/options/[id]/route.ts
app/api/admin/options/reorder/route.ts
components/AdminDashboard.tsx
components/OptionCard.tsx
components/PollEditor.tsx
lib/voting/admin.ts
lib/voting/validation.ts
supabase/migrations/002_configurable_voting.sql
tests/configurable.test.ts
```

`components/GroupCard.tsx` was replaced by `OptionCard.tsx`. The original migration, QR component, admin authentication/cookie code, environment template, package dependencies and Next/Vercel configuration are unchanged.

## Local checks

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run test:integration
```

`npm test` verifies the legacy setup plus an upgrade with pre-existing votes, dynamic configuration, historical preservation, bounds, stale revisions, RLS, ranking and duplicate constraints. The production HTTP suite uses a test-only local RPC adapter backed by PostgreSQL (PGlite), with isolated test credentials and data. It checks the actual server routes, not your production database. Hosted WebSocket delivery and visual phone/projector verification still require an event rehearsal; the tests do not claim to simulate separate PostgreSQL connections or hosted Supabase Realtime.
