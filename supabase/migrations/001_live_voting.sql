-- Run this entire file once in the Supabase SQL Editor as postgres.
begin;

create schema if not exists voting_private;
revoke all on schema voting_private from public, anon, authenticated;

create table public.voting_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Event Voting' check (length(name) between 1 and 100),
  is_active boolean not null default false,
  is_open boolean not null default false,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index one_active_voting_session
  on public.voting_sessions (is_active) where is_active;

create table public.vote_totals (
  session_id uuid not null references public.voting_sessions(id),
  group_name text not null check (group_name in ('A', 'B', 'C', 'D')),
  vote_count integer not null default 0 check (vote_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (session_id, group_name)
);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.voting_sessions(id),
  group_name text not null check (group_name in ('A', 'B', 'C', 'D')),
  voter_hash text not null check (voter_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  constraint one_vote_per_session unique (session_id, voter_hash),
  foreign key (session_id, group_name)
    references public.vote_totals (session_id, group_name)
);

-- A singleton mutex serializes admin operations, including concurrent resets.
create table voting_private.control (id boolean primary key check (id));
insert into voting_private.control values (true);
create table voting_private.request_limits (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null
);
alter table voting_private.control enable row level security;
alter table voting_private.request_limits enable row level security;

-- Every session always starts with its four valid totals.
create function voting_private.initialize_totals() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.vote_totals (session_id, group_name)
    select new.id, g from unnest(array['A', 'B', 'C', 'D']) as g;
  return new;
end;
$$;
create trigger initialize_session_totals after insert on public.voting_sessions
  for each row execute function voting_private.initialize_totals();

-- The trigger and vote insert are the same transaction: neither can commit alone.
create function voting_private.increment_total() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.vote_totals set vote_count = vote_count + 1,
    updated_at = clock_timestamp()
    where session_id = new.session_id and group_name = new.group_name;
  if not found then raise exception 'Missing group total'; end if;
  return new;
end;
$$;
create trigger increment_vote_total after insert on public.votes
  for each row execute function voting_private.increment_total();

create function public.cast_vote(
  p_session_id uuid, p_group_name text, p_voter_hash text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.voting_sessions%rowtype;
begin
  if p_group_name is null or p_group_name not in ('A', 'B', 'C', 'D')
    or p_voter_hash is null or p_voter_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  -- Shared session locks allow concurrent votes; close/reset waits for them.
  select * into s from public.voting_sessions where is_active for share;
  if not found then return jsonb_build_object('status', 'no_session'); end if;
  -- A stale phone must never silently vote in a newly created session.
  if p_session_id is null or s.id <> p_session_id then
    return jsonb_build_object('status', 'session_changed');
  end if;
  if exists (select 1 from public.votes
    where session_id = s.id and voter_hash = p_voter_hash) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  if not s.is_open then return jsonb_build_object('status', 'closed'); end if;
  begin
    insert into public.votes (session_id, group_name, voter_hash)
      values (s.id, p_group_name, p_voter_hash);
  exception when unique_violation then
    return jsonb_build_object('status', 'duplicate');
  end;
  return jsonb_build_object('status', 'success', 'session_id', s.id,
    'group_name', p_group_name);
end;
$$;

create function public.set_voting_open(p_is_open boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_is_open is null then raise exception 'Invalid status'; end if;
  perform 1 from voting_private.control where id for update;
  update public.voting_sessions set is_open = p_is_open,
    closed_at = case when p_is_open then null else clock_timestamp() end
    where is_active returning id into v_id;
  if v_id is null then raise exception 'No active session'; end if;
  -- Notify the sole public Realtime subscription about status changes too.
  update public.vote_totals set updated_at = clock_timestamp()
    where session_id = v_id;
  return v_id;
end;
$$;

create function public.start_voting_session() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform 1 from voting_private.control where id for update;
  update public.voting_sessions set is_open = false, is_active = false,
    closed_at = coalesce(closed_at, clock_timestamp()) where is_active;
  insert into public.voting_sessions (name, is_active, is_open)
    values ('Event Voting', true, false) returning id into v_id;
  return v_id;
end;
$$;

-- One statement gives a consistent public snapshot without exposing raw votes.
create function public.get_voting_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'session', jsonb_build_object('id', s.id, 'name', s.name,
      'is_open', s.is_open, 'created_at', s.created_at, 'closed_at', s.closed_at),
    'totals', (select jsonb_object_agg(t.group_name, t.vote_count)
      from public.vote_totals t where t.session_id = s.id)
  ) from public.voting_sessions s where s.is_active;
$$;

-- Persistent limits work across Vercel instances. No IP is used for voter identity.
create function public.consume_request_limit(
  p_key text, p_limit integer, p_window_seconds integer
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_hits integer; v_now timestamptz := clock_timestamp();
begin
  if length(p_key) > 128 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid limit';
  end if;
  insert into voting_private.request_limits as limits (key, window_start, hits)
    values (p_key, v_now, 1)
    on conflict (key) do update set
      window_start = case when limits.window_start <=
        v_now - make_interval(secs => p_window_seconds) then v_now else limits.window_start end,
      hits = case when limits.window_start <= v_now - make_interval(secs => p_window_seconds)
        then 1 else least(limits.hits + 1, p_limit + 1) end
    returning hits into v_hits;
  if random() < 0.01 then
    delete from voting_private.request_limits where window_start < v_now - interval '1 day';
  end if;
  return v_hits <= p_limit;
end;
$$;

alter table public.voting_sessions enable row level security;
alter table public.vote_totals enable row level security;
alter table public.votes enable row level security;

revoke all on public.voting_sessions, public.vote_totals, public.votes
  from public, anon, authenticated;
grant select on public.voting_sessions, public.vote_totals to anon, authenticated;
grant select on public.voting_sessions, public.vote_totals to service_role;
create policy read_active_session on public.voting_sessions for select
  to anon, authenticated using (is_active);
create policy read_active_totals on public.vote_totals for select
  to anon, authenticated using (exists (
    select 1 from public.voting_sessions s where s.id = session_id and s.is_active
  ));
-- No policies or grants on votes for public users, and no public write policies.

revoke all on function voting_private.initialize_totals() from public, anon, authenticated;
revoke all on function voting_private.increment_total() from public, anon, authenticated;
revoke all on function public.cast_vote(uuid, text, text) from public, anon, authenticated;
revoke all on function public.set_voting_open(boolean) from public, anon, authenticated;
revoke all on function public.start_voting_session() from public, anon, authenticated;
revoke all on function public.consume_request_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.get_voting_snapshot() from public;
grant execute on function public.cast_vote(uuid, text, text),
  public.set_voting_open(boolean), public.start_voting_session(),
  public.consume_request_limit(text, integer, integer) to service_role;
grant execute on function public.get_voting_snapshot() to anon, authenticated, service_role;

insert into public.voting_sessions (name, is_active, is_open)
  values ('Event Voting', true, false);

-- Supabase normally has this publication. Create it when absent.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vote_totals') then
    alter publication supabase_realtime add table public.vote_totals;
  end if;
end;
$$;
commit;
