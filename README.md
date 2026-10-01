# LiveVote

A QR-based live event voting app for exactly four groups: A, B, C, and D. Built with Next.js App Router, TypeScript, Tailwind CSS, Supabase PostgreSQL and Realtime. Ready to deploy to Vercel after connecting your Supabase project.

## 1. Install

Use Node.js 24 LTS (Node 22.18+ also works).

```bash
npm install
```

On Windows PowerShell with script execution disabled, use `npm.cmd` instead of `npm`.

## 2. Create a Supabase project

1. Create a project at [Supabase](https://supabase.com/dashboard). Wait for the database to finish provisioning.
2. In the project's **Connect** dialog, copy its Project URL (for example, `https://your-project.supabase.co`). You can also find it under Project Settings → Data API.
3. Open **Project Settings → API Keys → Legacy anon, service_role API keys**. Copy the `anon` key and `service_role` key. Keep legacy keys enabled if you use these. The anon key is public; the service role key is server-only.
4. Alternatively, Supabase's newer publishable key can be used in `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and its secret key in `SUPABASE_SERVICE_ROLE_KEY`. The environment names are retained for this project's interface. Never place the secret/service role key in a `NEXT_PUBLIC_` variable.

See [Supabase's API key documentation](https://supabase.com/docs/guides/getting-started/api-keys).

## 3. Run the SQL migration

Open Supabase **SQL Editor → New query**. Paste the **entire contents** of:

```text
supabase/migrations/001_live_voting.sql
```

Click **Run**. Run it once on a fresh project. It runs inside a transaction, so a failure rolls back the setup rather than leaving partial tables. It creates:

- `voting_sessions`, `votes`, and `vote_totals` with constraints and RLS.
- An initial active session named **Event Voting**, initially **CLOSED**, with four zero totals.
- Transactional voting, open/close and new-session RPCs.
- Private persistent request limits and a lock for concurrent admin operations.
- Public read policies for only the active session and its totals.
- A Realtime publication entry for `vote_totals`.

The default event name is **Event Voting**. To customize it, run this in the SQL Editor:

```sql
update public.voting_sessions
set name = 'Your Event Title'
where is_active;
```

New sessions use the default name. Rename the new active session in the same way when needed.

## 4. Environment variables

Copy `.env.example` to `.env.local` in the project root:

```bash
cp .env.example .env.local
```

PowerShell equivalent:

```powershell
Copy-Item .env.example .env.local
```

Set all seven variables:

| Variable | Value | Visibility |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon / publishable key | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role / secret key | Server only |
| `NEXT_PUBLIC_APP_URL` | Full app origin, locally `http://localhost:3000` | Public |
| `ADMIN_PASSWORD` | A strong password of at least 12 characters | Server only |
| `ADMIN_SESSION_SECRET` | A random secret of at least 32 characters | Server only |
| `VOTER_HASH_SECRET` | A different random secret of at least 32 characters | Server only |

Generate each secret separately:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Do not commit `.env.local` or real secrets. Keep `VOTER_HASH_SECRET` stable throughout an active session: changing it changes voter hashes and permits a previous browser to vote again. Changing the admin password or session secret invalidates existing admin cookies.

## 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Route | Purpose |
| --- | --- |
| `/` | Projector home, large QR, current status and vote total |
| `/vote` | Mobile group selection, confirmation and receipt |
| `/results` | Live totals, percentages and smooth result bars |
| `/admin` | Server-authenticated organizer controls |

Sign in at `/admin`, then click **Open voting**. An admin cookie lasts eight hours, is HttpOnly and SameSite=Strict, and is Secure in production. Local `npm run dev` uses an HTTP-compatible cookie.

To test with a phone on the same Wi-Fi, set `NEXT_PUBLIC_APP_URL=http://YOUR-LAN-IP:3000`, restart the dev server, and allow local port 3000 through your firewall. A localhost QR will open the phone's own localhost and cannot reach your computer. A deployed HTTPS URL is the easiest event setup. Browser UUID generation requires a secure context (HTTPS or localhost); use an HTTPS deployment/tunnel for an actual phone rather than an HTTP LAN address if the browser blocks `crypto.randomUUID()`.

### Validation

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:integration
```

Tests run the actual SQL migration in an isolated, in-memory PostgreSQL engine (PGlite), then verify vote validation, duplicate constraints, atomic rollback, totals, session rollover, historical data, anonymous RLS, RPC access and rate limits. They also verify session signing/expiry, tamper rejection, password rotation and input validation. PGlite is a development dependency and is not used in the deployed app. Its requests execute serially; this suite does not claim to simulate independent PostgreSQL connections or the hosted Realtime service.

After building, `npm run test:integration` launches the production Next.js server on an isolated local port and exercises the actual HTTP routes against that PostgreSQL migration through a test-only RPC adapter. It checks protected admin access, cookie attributes, same-origin protection, vote bursts, close/open, session rollover, historical hashes and logout. It uses temporary in-memory test data and test credentials, and stops its servers afterwards. It does not connect to your Supabase account.

For a production-mode preview, use `npm run build` then `npm start`. Production admin cookies require HTTPS, so use `npm run dev` for admin testing on localhost HTTP.

### Event rehearsal

1. Open `/` and confirm the printed QR URL is your deployed `/vote` URL.
2. Open `/results` on the projector and `/admin` in a separate tab. Sign in and open voting.
3. Scan the QR on a phone. Select a group; confirm that selection alone does not submit. Press **Confirm vote**. Check the success receipt and live results.
4. Reload `/vote`: it shows that this browser already voted. Clearing only the receipt key still cannot bypass the database's unique voter constraint. Use another browser to test another vote.
5. Close voting. Confirm a fresh participant sees the closed message and cannot submit. Ties for the highest positive total are highlighted equally; no winner is highlighted while voting is open, or when all totals are zero.
6. Start a new session, confirm the dialog, and check four zero totals. It starts CLOSED; click **Open voting**. The same phone can now vote again. Old votes remain in the database.
7. Briefly disconnect the results display from the internet. Reconnect and verify totals recover. The app uses one `vote_totals` Realtime subscription, coalesces event bursts, and reconciles every 20 seconds when connected or every 5 seconds when disconnected. It never refreshes the whole page.

## 6. Vercel deployment

1. Push this project to a GitHub repository, including `package-lock.json` and the SQL migration, excluding `.env.local`.
2. In [Vercel](https://vercel.com/new), choose **Add New → Project**, import the repository, and select the **Next.js** preset. Use Node 24, default install command `npm install`, and build command `npm run build`.
3. Add all seven environment variables in **Project Settings → Environment Variables** for **Production**. Add them to Preview only if you want previews connected to that database. Use a separate Supabase project for testing so preview admins cannot disrupt your live event.
4. Set `NEXT_PUBLIC_APP_URL` to the final HTTPS origin, such as `https://your-app.vercel.app`, without `/vote` or other path segments.
5. Deploy. If the final domain was assigned after the first deployment, update `NEXT_PUBLIC_APP_URL` and **redeploy**. Public variables are compiled into browser assets at build time.
6. For a custom domain, set the variable to that HTTPS domain and redeploy again. Scan the QR and check the fallback URL before the event.
7. Run the event rehearsal above against the production deployment. Keep the admin password private.

No Supabase user accounts or authentication redirect URLs are required. Admin auth runs on the Next.js server. No Vercel cron job or persistent Node process is needed.

## 7. Supabase Realtime

The migration enables `public.vote_totals` in `supabase_realtime` automatically. Verify it with:

```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime';
```

If `public.vote_totals` is missing, run this once in the SQL Editor:

```sql
alter publication supabase_realtime add table public.vote_totals;
```

You can also enable that table in the Supabase Dashboard's publication/replication controls. Do not publish `votes` or the private schema for this app. See [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

If Realtime is unavailable, the app shows **Syncing automatically** and uses snapshot polling until the connection recovers. Supabase RLS allows anonymous reads of only active totals; the private vote rows are never returned to the public client. Status changes touch the active totals' timestamp to notify that same subscription; a newly inserted session's totals signal rollover.

## Security and operating limits

- The device ID is generated with `crypto.randomUUID()` and stored under `qr_voting_device_id` in localStorage. The server stores only an HMAC-SHA-256 hash, keyed with `VOTER_HASH_SECRET`. There is no IP-based voter blocking.
- **One vote per browser/device is lightweight event protection. Clearing browser data, using another browser/profile, or switching devices can bypass it. This is not an election-grade identity system.**
- `(session_id, voter_hash)` is unique in PostgreSQL. The cast RPC validates the group and the expected active session, takes a shared session lock, and inserts a vote. Its trigger increments the matching total in the same transaction. Close/reset waits for in-flight votes, and admin operations serialize through a singleton lock.
- Mutation RPCs are callable only by the server's service role. Public roles can neither insert votes nor access raw votes or historical sessions. History is accessible to the organizer through the trusted Supabase SQL Editor.
- Server mutations require a matching Origin and JSON content type. Request bodies are limited to 4 KiB. Admin passwords never reach client code; only the submitted login password is sent over HTTPS. Cookies are signed with a random nonce, expire after eight hours, and become invalid when the password or signing secret changes. Logout removes the browser cookie; a stolen copy of a stateless cookie remains valid until expiry or credential rotation.
- Persistent limits allow 15 vote requests per browser hash per minute, 10 admin login attempts per source per minute (using Vercel's trusted forwarding header; a shared bucket locally), 200 login attempts globally per minute, and 30 authenticated admin actions per minute. Limits are stored privately, work across Vercel instances, and expire old buckets opportunistically. They do not stop someone generating fresh browser IDs; for unusually large or exposed events, configure hosting-level traffic limits.
- Requests fail closed when Supabase is unreachable. Clients show friendly errors and allow retries; retries after an uncertain response cannot add a second vote to the same session.
- Vote totals are integer counters. Percentages are rounded to one decimal place and may sum to 99.9% or 100.1%. This does not affect exact vote counts.
- No real credentials are included. You must create Supabase, run the migration, populate environment variables, and deploy before hosted voting or Realtime can be verified.

The included checks verify SQL, security, production builds and HTTP behavior. Complete the phone/projector visual rehearsal on your actual event devices as well.

## Project layout

```text
app/                         Pages and API route handlers
components/                  Presentation, voting, results and admin UI
lib/auth/                    Server-only admin session helpers
lib/supabase/                Separate browser/server database clients
lib/voting/                  Voting types, server logic and live session hook
supabase/migrations/         Complete PostgreSQL setup
tests/                       SQL and security verification
.env.example                 Environment template without secrets
```

API routes: `GET /api/session`, `POST /api/vote`, and `POST /api/admin/login`, `/logout`, `/open`, `/close`, `/new-session`. Mutation requests require `Content-Type: application/json` and a matching `Origin`; protected admin operations also require the admin session cookie. Vote payload: `{ "sessionId": "uuid", "deviceId": "uuid", "group": "A" }`. New-session payload: `{ "confirm": true }`. Other admin actions use `{}`.
