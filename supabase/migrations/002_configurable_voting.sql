-- Upgrade an existing installation AFTER 001_live_voting.sql. Run once as postgres.
-- Existing sessions, vote IDs, hashes, timestamps and exact totals are preserved.
begin;
-- Prevent votes/admin operations from overlapping the backfill.
lock table public.voting_sessions, public.votes, public.vote_totals in access exclusive mode;

alter table public.voting_sessions
  add column question text not null default 'Cast your vote' check (length(btrim(question)) between 1 and 150),
  add column description text check (description is null or length(description) <= 300),
  add column options_revision integer not null default 0;

create table public.voting_options (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.voting_sessions(id),
  name text not null check (name = btrim(name) and length(name) between 1 and 80),
  display_order integer not null check (display_order between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Compatibility mapping only; new options do not need a legacy value.
  group_name text,
  unique (session_id, id),
  unique (session_id, name),
  unique (session_id, group_name),
  unique (session_id, display_order) deferrable initially deferred
);
create index voting_options_session_idx on public.voting_options(session_id);
create unique index voting_options_name_case_insensitive on public.voting_options(session_id, lower(name));

-- Copy the original labels, once, from actual existing totals (not runtime defaults).
insert into public.voting_options (session_id, name, display_order, group_name)
  select session_id, 'Group ' || group_name,
    row_number() over (partition by session_id order by group_name), group_name
  from public.vote_totals;

alter table public.votes add column option_id uuid;
alter table public.vote_totals add column option_id uuid;
update public.votes v set option_id = o.id from public.voting_options o
  where o.session_id = v.session_id and o.group_name = v.group_name;
update public.vote_totals t set option_id = o.id from public.voting_options o
  where o.session_id = t.session_id and o.group_name = t.group_name;

-- Fail and roll back the ENTIRE migration if any legacy record is unmapped.
do $$
begin
  if exists (select 1 from public.votes where option_id is null)
    or exists (select 1 from public.vote_totals where option_id is null)
    or exists (select 1 from public.voting_sessions s where
      (select count(*) from public.voting_options o where o.session_id = s.id) not between 2 and 20) then
    raise exception 'Legacy backfill verification failed; no changes were committed';
  end if;
end;
$$;

alter table public.votes drop constraint votes_session_id_group_name_fkey;
alter table public.vote_totals drop constraint vote_totals_pkey;
alter table public.vote_totals alter column group_name drop not null;
alter table public.votes alter column group_name drop not null;
alter table public.vote_totals alter column option_id set not null;
alter table public.votes alter column option_id set not null;
alter table public.vote_totals add primary key (session_id, option_id),
  add unique (session_id, group_name),
  add foreign key (session_id, option_id) references public.voting_options(session_id, id) on delete cascade;
alter table public.votes
  add foreign key (session_id, option_id) references public.voting_options(session_id, id),
  add foreign key (session_id, option_id) references public.vote_totals(session_id, option_id);
-- one_vote_per_session(session_id, voter_hash) is intentionally untouched.

drop trigger initialize_session_totals on public.voting_sessions;
drop function voting_private.initialize_totals();

create function voting_private.initialize_option_total() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.vote_totals(session_id, option_id, group_name)
    values(new.session_id, new.id, new.group_name);
  return new;
end;
$$;
create trigger initialize_option_total after insert on public.voting_options
  for each row execute function voting_private.initialize_option_total();

-- Keep old deployed cast_vote calls working for mapped legacy options.
create function voting_private.map_legacy_vote() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o public.voting_options%rowtype;
begin
  if new.option_id is null then
    select * into o from public.voting_options
      where session_id = new.session_id and group_name = new.group_name;
  else
    select * into o from public.voting_options
      where session_id = new.session_id and id = new.option_id;
  end if;
  if not found then raise exception 'Invalid voting option' using errcode = '23503'; end if;
  if new.group_name is not null and new.group_name is distinct from o.group_name then
    raise exception 'Option mapping mismatch' using errcode = '23503';
  end if;
  new.option_id := o.id;
  new.group_name := o.group_name;
  return new;
end;
$$;
create trigger map_legacy_vote before insert on public.votes
  for each row execute function voting_private.map_legacy_vote();

create or replace function voting_private.increment_total() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.vote_totals set vote_count = vote_count + 1, updated_at = clock_timestamp()
    where session_id = new.session_id and option_id = new.option_id;
  if not found then raise exception 'Missing option total'; end if;
  return new;
end;
$$;

-- Even privileged option writes respect integrity, not just the admin UI.
create function voting_private.guard_options() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_session uuid; s public.voting_sessions%rowtype;
begin
  v_session := case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  select * into s from public.voting_sessions where id = v_session for update;
  if tg_op = 'UPDATE' and (new.id <> old.id or new.session_id <> old.session_id) then
    raise exception 'An option cannot move to another session';
  end if;
  if s.is_open or exists (select 1 from public.votes where session_id = v_session) then
    raise exception 'Voting options are locked';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger guard_voting_options before insert or update or delete on public.voting_options
  for each row execute function voting_private.guard_options();

-- Deferred checks allow a new session + its options to be created atomically.
create function voting_private.check_option_bounds() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_session uuid; n integer;
begin
  if tg_table_name = 'voting_sessions' then v_session := new.id;
  elsif tg_op = 'DELETE' then v_session := old.session_id;
  else v_session := new.session_id; end if;
  if exists (select 1 from public.voting_sessions where id = v_session) then
    select count(*) into n from public.voting_options where session_id = v_session;
    if n not between 2 and 20 then raise exception 'A session requires 2 to 20 voting options'; end if;
  end if;
  return null;
end;
$$;
create constraint trigger session_option_bounds after insert on public.voting_sessions
  deferrable initially deferred for each row execute function voting_private.check_option_bounds();
create constraint trigger option_bounds after insert or update or delete on public.voting_options
  deferrable initially deferred for each row execute function voting_private.check_option_bounds();

create function public.cast_option_vote(
  p_session_id uuid, p_option_id uuid, p_voter_hash text, p_options_revision integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.voting_sessions%rowtype;
begin
  if p_voter_hash is null or p_voter_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into s from public.voting_sessions where is_active for share;
  if not found then return jsonb_build_object('status', 'no_session'); end if;
  if p_session_id is null or s.id <> p_session_id then return jsonb_build_object('status', 'session_changed'); end if;
  if exists (select 1 from public.votes where session_id = s.id and voter_hash = p_voter_hash) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  if not s.is_open then return jsonb_build_object('status', 'closed'); end if;
  if p_options_revision is null or p_options_revision <> s.options_revision then
    return jsonb_build_object('status', 'options_changed');
  end if;
  if p_option_id is null or not exists (select 1 from public.voting_options where id = p_option_id and session_id = s.id) then
    return jsonb_build_object('status', 'invalid_option');
  end if;
  begin
    insert into public.votes(session_id, option_id, voter_hash) values(s.id, p_option_id, p_voter_hash);
  exception when unique_violation then return jsonb_build_object('status', 'duplicate');
  end;
  return jsonb_build_object('status', 'success', 'session_id', s.id, 'option_id', p_option_id,
    'option_name', (select name from public.voting_options where id = p_option_id));
end;
$$;

-- Old open browser tabs may still send group-based payloads after redeployment.
-- Only an unchanged legacy configuration may accept those votes.
create function public.cast_legacy_option_vote(p_session_id uuid, p_group_name text, p_voter_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.voting_sessions%rowtype; o public.voting_options%rowtype; result jsonb;
begin
  select * into s from public.voting_sessions where is_active for share;
  if not found then return jsonb_build_object('status', 'no_session'); end if;
  if s.id is distinct from p_session_id then return jsonb_build_object('status', 'session_changed'); end if;
  if s.options_revision <> 0 then return jsonb_build_object('status', 'options_changed'); end if;
  select * into o from public.voting_options where session_id = s.id and group_name = p_group_name;
  if not found then return jsonb_build_object('status', 'invalid_option'); end if;
  result := public.cast_vote(p_session_id, p_group_name, p_voter_hash);
  return result || jsonb_build_object('option_id', o.id, 'option_name', o.name);
end;
$$;

create function public.create_voting_session(
  p_name text, p_question text, p_description text, p_options text[], p_expected_session_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_current uuid;
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 100
    or p_question is null or length(btrim(p_question)) not between 1 and 150
    or length(coalesce(btrim(p_description), '')) > 300
    or p_options is null or cardinality(p_options) not between 2 and 20
    or exists(select 1 from unnest(p_options) n where n is null or length(btrim(n)) not between 1 and 80)
    or (select count(distinct lower(btrim(n))) from unnest(p_options) n) <> cardinality(p_options) then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform 1 from voting_private.control where id for update;
  select id into v_current from public.voting_sessions where is_active for update;
  if v_current is distinct from p_expected_session_id then return jsonb_build_object('status', 'session_changed'); end if;
  update public.voting_sessions set is_open = false, is_active = false,
    closed_at = coalesce(closed_at, clock_timestamp()) where is_active;
  insert into public.voting_sessions(name, question, description, is_active, is_open)
    values(btrim(p_name), btrim(p_question), nullif(btrim(p_description), ''), true, false) returning id into v_id;
  insert into public.voting_options(session_id, name, display_order)
    select v_id, btrim(n), ord from unnest(p_options) with ordinality as options(n, ord);
  return jsonb_build_object('status', 'success', 'session_id', v_id);
end;
$$;

create function public.configure_voting_session(p_session_id uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.voting_sessions%rowtype; n integer; v_option uuid; v_name text; v_ids uuid[];
begin
  perform 1 from voting_private.control where id for update;
  select * into s from public.voting_sessions where is_active for update;
  if not found then return jsonb_build_object('status', 'no_session'); end if;
  if p_session_id is null or s.id <> p_session_id then return jsonb_build_object('status', 'session_changed'); end if;
  if p_action = 'settings' then
    if jsonb_typeof(p_payload->'name') <> 'string' or jsonb_typeof(p_payload->'question') <> 'string'
      or length(btrim(coalesce(p_payload->>'name', ''))) not between 1 and 100
      or length(btrim(coalesce(p_payload->>'question', ''))) not between 1 and 150
      or length(coalesce(p_payload->>'description', '')) > 300 then return jsonb_build_object('status', 'invalid'); end if;
    update public.voting_sessions set name = btrim(p_payload->>'name'), question = btrim(p_payload->>'question'),
      description = nullif(btrim(p_payload->>'description'), '') where id = s.id;
  elsif p_action in ('open', 'close') then
    if (select count(*) from public.voting_options where session_id = s.id) not between 2 and 20 then
      return jsonb_build_object('status', 'option_bounds');
    end if;
    update public.voting_sessions set is_open = (p_action = 'open'),
      closed_at = case when p_action = 'open' then null else clock_timestamp() end where id = s.id;
  elsif p_action in ('add', 'rename', 'delete', 'reorder') then
    if exists (select 1 from public.votes where session_id = s.id) then return jsonb_build_object('status', 'options_locked'); end if;
    if s.is_open then return jsonb_build_object('status', 'voting_open'); end if;
    select count(*) into n from public.voting_options where session_id = s.id;
    if p_action in ('add', 'rename') then
      v_name := btrim(p_payload->>'name');
      if jsonb_typeof(p_payload->'name') <> 'string' or v_name is null or length(v_name) not between 1 and 80 then
        return jsonb_build_object('status', 'invalid');
      end if;
    end if;
    if p_action in ('rename', 'delete') then
      begin v_option := (p_payload->>'optionId')::uuid;
      exception when invalid_text_representation then return jsonb_build_object('status', 'invalid_option'); end;
      if v_option is null or not exists(select 1 from public.voting_options where session_id = s.id and id = v_option) then
        return jsonb_build_object('status', 'invalid_option');
      end if;
    end if;
    if p_action = 'add' then
      if n >= 20 then return jsonb_build_object('status', 'option_bounds'); end if;
      insert into public.voting_options(session_id, name, display_order) values(s.id, v_name, n + 1);
    elsif p_action = 'rename' then update public.voting_options set name = v_name where id = v_option;
    elsif p_action = 'delete' then
      if n <= 2 then return jsonb_build_object('status', 'option_bounds'); end if;
      delete from public.voting_options where id = v_option;
      with ordered as (select id, row_number() over(order by display_order) as ord from public.voting_options where session_id = s.id)
        update public.voting_options o set display_order = ordered.ord from ordered where o.id = ordered.id;
    elsif p_action = 'reorder' then
      if jsonb_typeof(p_payload->'optionIds') is distinct from 'array' then return jsonb_build_object('status', 'invalid'); end if;
      begin select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(p_payload->'optionIds');
      exception when invalid_text_representation then return jsonb_build_object('status', 'invalid_option'); end;
      if cardinality(v_ids) is distinct from n or (select count(distinct x) from unnest(v_ids) x) <> n
        or exists(select 1 from unnest(v_ids) x where not exists(select 1 from public.voting_options where session_id = s.id and id = x)) then
        return jsonb_build_object('status', 'invalid_option');
      end if;
      update public.voting_options o set display_order = ordered.ord
        from unnest(v_ids) with ordinality as ordered(id, ord) where o.id = ordered.id;
    end if;
    update public.voting_sessions set options_revision = options_revision + 1 where id = s.id;
  else return jsonb_build_object('status', 'invalid'); end if;
  update public.vote_totals set updated_at = clock_timestamp() where session_id = s.id;
  return jsonb_build_object('status', 'success');
exception when unique_violation then return jsonb_build_object('status', 'duplicate_name');
end;
$$;

-- Preserve the old no-argument RPC during the deployment transition by cloning.
create or replace function public.start_voting_session() returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.voting_sessions%rowtype; names text[]; mappings jsonb; result jsonb; v_id uuid;
begin
  perform 1 from voting_private.control where id for update;
  select * into s from public.voting_sessions where is_active for update;
  select array_agg(name order by display_order), jsonb_object_agg(display_order, group_name)
    into names, mappings from public.voting_options where session_id = s.id;
  result := public.create_voting_session(s.name, s.question, s.description, names, s.id);
  if result->>'status' <> 'success' then raise exception 'Unable to create session'; end if;
  v_id := (result->>'session_id')::uuid;
  update public.voting_options set group_name = mappings->>display_order::text where session_id = v_id;
  update public.vote_totals t set group_name = o.group_name from public.voting_options o
    where t.option_id = o.id and t.session_id = v_id;
  return v_id;
end;
$$;

create or replace function public.get_voting_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'session', jsonb_build_object('id', s.id, 'name', s.name, 'question', s.question,
      'description', s.description, 'options_revision', s.options_revision, 'is_open', s.is_open,
      'created_at', s.created_at, 'closed_at', s.closed_at),
    'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name,
      'display_order', o.display_order, 'vote_count', t.vote_count) order by o.display_order)
      from public.voting_options o join public.vote_totals t on t.session_id = o.session_id and t.option_id = o.id
      where o.session_id = s.id), '[]'::jsonb),
    -- Legacy clients can still read the migrated active session during rollout.
    'totals', coalesce((select jsonb_object_agg(t.group_name, t.vote_count)
      from public.vote_totals t where t.session_id = s.id and t.group_name is not null), '{}'::jsonb)
  ) from public.voting_sessions s where s.is_active;
$$;

alter table public.voting_options enable row level security;
revoke all on public.voting_options from public, anon, authenticated, service_role;
grant select on public.voting_options to anon, authenticated, service_role;
create policy read_active_options on public.voting_options for select to anon, authenticated using (
  exists(select 1 from public.voting_sessions s where s.id = session_id and s.is_active)
);
revoke all on function voting_private.initialize_option_total(), voting_private.map_legacy_vote(),
  voting_private.guard_options(), voting_private.check_option_bounds() from public, anon, authenticated;
revoke all on function public.cast_option_vote(uuid, uuid, text, integer),
  public.cast_legacy_option_vote(uuid, text, text),
  public.create_voting_session(text, text, text, text[], uuid),
  public.configure_voting_session(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.cast_option_vote(uuid, uuid, text, integer),
  public.cast_legacy_option_vote(uuid, text, text),
  public.create_voting_session(text, text, text, text[], uuid),
  public.configure_voting_session(uuid, text, jsonb) to service_role;

-- vote_totals stays in its existing Realtime publication; no raw votes are added.
notify pgrst, 'reload schema';
commit;
