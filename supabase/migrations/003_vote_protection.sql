-- Run once AFTER 001 and 002. Close voting before the coordinated deployment.
-- Historical votes retain their original data; their unknown IP stays NULL.
begin;
lock table public.voting_sessions, public.votes, public.vote_totals in access exclusive mode;

alter table public.voting_sessions
  add column ip_protection_enabled boolean not null default true,
  add column max_votes_per_ip integer not null default 5 check (max_votes_per_ip between 1 and 100),
  add column voting_mode text not null default 'standard' check (voting_mode in ('standard', 'strict_code'));
alter table public.votes add column ip_hash text check (ip_hash ~ '^[a-f0-9]{64}$');
create index votes_session_ip_idx on public.votes(session_id, ip_hash) where ip_hash is not null;

create table public.voter_codes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.voting_sessions(id),
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, code_hash),
  unique (session_id, id)
);
alter table public.votes add column voter_code_id uuid,
  add foreign key (session_id, voter_code_id) references public.voter_codes(session_id, id),
  add unique (voter_code_id);

-- Transactional counter rows serialize only votes on the same network. An
-- atomic conditional UPSERT cannot overshoot the cap, even during concurrent
-- requests; failed inserts roll back both this counter and any code claim.
create table voting_private.ip_vote_counts (
  session_id uuid not null references public.voting_sessions(id),
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  vote_count bigint not null check (vote_count > 0),
  primary key (session_id, ip_hash)
);
revoke all on voting_private.ip_vote_counts from public, anon, authenticated, service_role;

create function voting_private.enforce_vote_protection() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.voting_sessions%rowtype; c public.voter_codes%rowtype; accepted bigint;
begin
  if new.ip_hash is null or new.ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'New votes require a network hash' using errcode = '23502';
  end if;
  select * into s from public.voting_sessions where id = new.session_id for share;
  if not found or not s.is_active or not s.is_open then
    raise exception 'Voting is closed' using errcode = 'P1003';
  end if;
  insert into voting_private.ip_vote_counts(session_id, ip_hash, vote_count)
    values(s.id, new.ip_hash, 1)
    on conflict (session_id, ip_hash) do update
      set vote_count = voting_private.ip_vote_counts.vote_count + 1
      where not s.ip_protection_enabled or voting_private.ip_vote_counts.vote_count < s.max_votes_per_ip
    returning vote_count into accepted;
  if accepted is null then raise exception 'Network limit reached' using errcode = 'P1001'; end if;
  if s.voting_mode = 'strict_code' then
    if new.voter_code_id is null then raise exception 'Voting code required' using errcode = 'P1004'; end if;
    select * into c from public.voter_codes where session_id = s.id and id = new.voter_code_id for update;
    if not found then raise exception 'Invalid voting code' using errcode = 'P1004'; end if;
    if c.used_at is not null then raise exception 'Voting code already used' using errcode = 'P1002'; end if;
    update public.voter_codes set used_at = clock_timestamp() where id = c.id;
  elsif new.voter_code_id is not null then
    raise exception 'Unexpected voting code' using errcode = 'P1004';
  end if;
  return new;
end;
$$;
create trigger enforce_vote_protection before insert on public.votes
  for each row execute function voting_private.enforce_vote_protection();

create function voting_private.guard_voting_mode() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.voting_mode is distinct from old.voting_mode and
    (old.is_open or exists(select 1 from public.votes where session_id = old.id)) then
    raise exception 'Voting mode is locked';
  end if;
  return new;
end;
$$;
create trigger guard_voting_mode before update on public.voting_sessions
  for each row execute function voting_private.guard_voting_mode();

create function public.cast_vote(
  p_session_id uuid, p_option_id uuid, p_voter_hash text, p_options_revision integer,
  p_ip_hash text, p_code_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.voting_sessions%rowtype; c public.voter_codes%rowtype;
begin
  if p_voter_hash is null or p_voter_hash !~ '^[a-f0-9]{64}$'
    or p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('status', 'invalid'); end if;
  select * into s from public.voting_sessions where is_active for share;
  if not found then return jsonb_build_object('status', 'no_session'); end if;
  if s.id is distinct from p_session_id then return jsonb_build_object('status', 'session_changed'); end if;
  if exists(select 1 from public.votes where session_id = s.id and voter_hash = p_voter_hash) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  if not s.is_open then return jsonb_build_object('status', 'closed'); end if;
  if p_options_revision is distinct from s.options_revision then return jsonb_build_object('status', 'options_changed'); end if;
  if p_option_id is null or not exists(select 1 from public.voting_options where session_id = s.id and id = p_option_id) then
    return jsonb_build_object('status', 'invalid_option');
  end if;
  if s.voting_mode = 'strict_code' then
    if p_code_hash is null then return jsonb_build_object('status', 'code_required'); end if;
    select * into c from public.voter_codes where session_id = s.id and code_hash = p_code_hash;
    if not found then return jsonb_build_object('status', 'invalid_code'); end if;
    if c.used_at is not null then return jsonb_build_object('status', 'code_used'); end if;
  end if;
  begin
    insert into public.votes(session_id, option_id, voter_hash, ip_hash, voter_code_id)
      values(s.id, p_option_id, p_voter_hash, p_ip_hash, c.id);
  exception
    when unique_violation then return jsonb_build_object('status', 'duplicate');
    when sqlstate 'P1001' then return jsonb_build_object('status', 'network_limit');
    when sqlstate 'P1002' then return jsonb_build_object('status', 'code_used');
    when sqlstate 'P1003' then return jsonb_build_object('status', 'closed');
    when sqlstate 'P1004' then return jsonb_build_object('status', 'invalid_code');
  end;
  return jsonb_build_object('status', 'success', 'session_id', s.id, 'option_id', p_option_id,
    'option_name', (select name from public.voting_options where id = p_option_id));
end;
$$;
create function public.cast_option_vote(p_session_id uuid, p_option_id uuid, p_voter_hash text,
  p_options_revision integer, p_ip_hash text, p_code_hash text)
returns jsonb language sql security definer set search_path = '' as $$
  select public.cast_vote(p_session_id, p_option_id, p_voter_hash, p_options_revision, p_ip_hash, p_code_hash);
$$;
create function public.cast_legacy_option_vote(p_session_id uuid, p_group_name text, p_voter_hash text, p_ip_hash text, p_code_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.voting_sessions%rowtype; o public.voting_options%rowtype; result jsonb;
begin
  select * into s from public.voting_sessions where is_active for share;
  if not found then return jsonb_build_object('status', 'no_session'); end if;
  if s.id is distinct from p_session_id then return jsonb_build_object('status', 'session_changed'); end if;
  if s.options_revision <> 0 then return jsonb_build_object('status', 'options_changed'); end if;
  select * into o from public.voting_options where session_id = s.id and group_name = p_group_name;
  if not found then return jsonb_build_object('status', 'invalid_option'); end if;
  result := public.cast_vote(s.id, o.id, p_voter_hash, s.options_revision, p_ip_hash, p_code_hash);
  return result || jsonb_build_object('group_name', o.group_name);
end;
$$;

-- Old server deployments lack IP/code hashes. Fail closed, rather than leave
-- an alternate service-role RPC that bypasses the new protections.
create or replace function public.cast_vote(p_session_id uuid, p_group_name text, p_voter_hash text)
returns jsonb language sql security definer set search_path = '' as $$ select '{"status":"upgrade_required"}'::jsonb; $$;
create or replace function public.cast_option_vote(p_session_id uuid, p_option_id uuid, p_voter_hash text, p_options_revision integer)
returns jsonb language sql security definer set search_path = '' as $$ select '{"status":"upgrade_required"}'::jsonb; $$;
create or replace function public.cast_legacy_option_vote(p_session_id uuid, p_group_name text, p_voter_hash text)
returns jsonb language sql security definer set search_path = '' as $$ select '{"status":"upgrade_required"}'::jsonb; $$;

create function public.configure_voting_protection(p_session_id uuid, p_ip_protection_enabled boolean,
  p_max_votes_per_ip integer, p_voting_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.voting_sessions%rowtype;
begin
  if p_ip_protection_enabled is null or p_max_votes_per_ip is null or p_max_votes_per_ip not between 1 and 100
    or p_voting_mode is null or p_voting_mode not in ('standard', 'strict_code') then return jsonb_build_object('status', 'invalid'); end if;
  perform 1 from voting_private.control where id for update;
  select * into s from public.voting_sessions where is_active for update;
  if not found then return jsonb_build_object('status', 'no_session'); end if;
  if s.id is distinct from p_session_id then return jsonb_build_object('status', 'session_changed'); end if;
  if s.voting_mode <> p_voting_mode and (s.is_open or exists(select 1 from public.votes where session_id = s.id)) then
    return jsonb_build_object('status', 'mode_locked');
  end if;
  update public.voting_sessions set ip_protection_enabled = p_ip_protection_enabled,
    max_votes_per_ip = p_max_votes_per_ip, voting_mode = p_voting_mode where id = s.id;
  update public.vote_totals set updated_at = clock_timestamp() where session_id = s.id;
  return jsonb_build_object('status', 'success');
end;
$$;
create function public.get_voter_code_stats(p_session_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select case when exists(select 1 from public.voting_sessions where id = p_session_id and is_active)
    then jsonb_build_object('status', 'success', 'stats', jsonb_build_object('total', count(*),
      'used', count(*) filter(where used_at is not null), 'available', count(*) filter(where used_at is null)))
    else jsonb_build_object('status', 'session_changed') end
  from public.voter_codes where session_id = p_session_id;
$$;
create function public.generate_voter_codes(p_session_id uuid, p_code_hashes text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.voting_sessions%rowtype;
begin
  if p_code_hashes is null or cardinality(p_code_hashes) not between 1 and 1000
    or exists(select 1 from unnest(p_code_hashes) h where h is null or h !~ '^[a-f0-9]{64}$')
    or (select count(distinct h) from unnest(p_code_hashes) h) <> cardinality(p_code_hashes) then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform 1 from voting_private.control where id for update;
  select * into s from public.voting_sessions where is_active for update;
  if not found then return jsonb_build_object('status', 'no_session'); end if;
  if s.id is distinct from p_session_id then return jsonb_build_object('status', 'session_changed'); end if;
  if (select count(*) from public.voter_codes where session_id = s.id) + cardinality(p_code_hashes) > 10000 then
    return jsonb_build_object('status', 'code_capacity');
  end if;
  insert into public.voter_codes(session_id, code_hash) select s.id, h from unnest(p_code_hashes) h;
  return public.get_voter_code_stats(s.id);
exception when unique_violation then return jsonb_build_object('status', 'code_collision');
end;
$$;

create or replace function public.get_voting_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'session', jsonb_build_object('id', s.id, 'name', s.name, 'question', s.question,
      'description', s.description, 'options_revision', s.options_revision, 'is_open', s.is_open,
      'created_at', s.created_at, 'closed_at', s.closed_at, 'ip_protection_enabled', s.ip_protection_enabled,
      'max_votes_per_ip', s.max_votes_per_ip, 'voting_mode', s.voting_mode),
    'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name,
      'display_order', o.display_order, 'vote_count', t.vote_count) order by o.display_order)
      from public.voting_options o join public.vote_totals t on t.session_id = o.session_id and t.option_id = o.id
      where o.session_id = s.id), '[]'::jsonb),
    'totals', coalesce((select jsonb_object_agg(t.group_name, t.vote_count)
      from public.vote_totals t where t.session_id = s.id and t.group_name is not null), '{}'::jsonb)
  ) from public.voting_sessions s where s.is_active;
$$;

alter table public.voter_codes enable row level security;
revoke all on public.voter_codes from public, anon, authenticated, service_role;
-- Only server-authenticated RPCs access codes. No code table is published.
revoke all on function voting_private.enforce_vote_protection(), voting_private.guard_voting_mode()
  from public, anon, authenticated, service_role;
revoke all on function public.cast_vote(uuid, uuid, text, integer, text, text),
  public.cast_option_vote(uuid, uuid, text, integer, text, text),
  public.cast_legacy_option_vote(uuid, text, text, text, text),
  public.configure_voting_protection(uuid, boolean, integer, text), public.get_voter_code_stats(uuid),
  public.generate_voter_codes(uuid, text[]) from public, anon, authenticated;
grant execute on function public.cast_vote(uuid, uuid, text, integer, text, text),
  public.cast_option_vote(uuid, uuid, text, integer, text, text),
  public.cast_legacy_option_vote(uuid, text, text, text, text),
  public.configure_voting_protection(uuid, boolean, integer, text), public.get_voter_code_stats(uuid),
  public.generate_voter_codes(uuid, text[]) to service_role;
notify pgrst, 'reload schema';
commit;
