-- GearWatch public catalog. Run AFTER setup.sql: Supabase → SQL Editor → New query → paste → Run.
-- Safe to run more than once. Makes @buckie the first admin (change the username at the bottom if needed).

create extension if not exists pg_trgm;

-- ===== Staff: admins and moderators =====
create table if not exists public.staff (
  user_id uuid primary key references auth.users on delete cascade,
  role text not null check (role in ('admin', 'moderator')),
  added_at timestamptz default now()
);
alter table public.staff enable row level security;
drop policy if exists "see own role" on public.staff;
create policy "see own role" on public.staff for select to authenticated using (user_id = auth.uid());

create or replace function public.staff_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.staff where user_id = auth.uid()
$$;
create or replace function public.is_mod() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'moderator') from public.staff where user_id = auth.uid()), false)
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.staff where user_id = auth.uid()), false)
$$;
-- Accounts younger than a week have everything they contribute reviewed first.
create or replace function public.is_new_account(who uuid) returns boolean language sql stable security definer set search_path = public, auth as $$
  select coalesce((select created_at > now() - interval '7 days' from auth.users where id = who), true)
$$;
revoke all on function public.is_new_account(uuid) from public, anon, authenticated;

-- ===== Shops =====
create table if not exists public.known_shops (
  domain text primary key,
  status text not null default 'trusted' check (status in ('trusted', 'blocked')),
  added_by uuid references auth.users on delete set null,
  added_at timestamptz default now()
);
alter table public.known_shops enable row level security;
drop policy if exists "shops readable" on public.known_shops;
create policy "shops readable" on public.known_shops for select to authenticated using (true);

-- ===== Catalog =====
create table if not exists public.catalog (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  domain text not null,
  name text not null check (char_length(name) between 1 and 160),
  brand text default '',
  category text default '',
  materials text[] default '{}',
  latex_mm text default '',
  photos text[] default '{}',
  price numeric,
  currency text default '€',
  low_price numeric,
  low_at date,
  status text not null default 'pending' check (status in ('pending', 'live', 'hidden', 'gone', 'removed')),
  added_by uuid references auth.users on delete set null,
  own_n int not null default 0,
  want_n int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.catalog add column if not exists was_price numeric;
-- Fixed options people pick from when adding: {"colors":[{"name":"Black","hex":"#111111"}],"sizes":["S","M","L"]}
alter table public.catalog add column if not exists options jsonb not null default '{}'::jsonb;
alter table public.catalog add column if not exists decided_at timestamptz;
alter table public.catalog add column if not exists decide_note text;
alter table public.catalog add column if not exists reapprove boolean not null default false;
alter table public.catalog add column if not exists reapproved_at timestamptz;
create or replace function public.cat_clean_options(o jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'colors', coalesce((select jsonb_agg(jsonb_build_object('name', left(btrim(c->>'name'), 30), 'hex', case when c->>'hex' ~* '^#[0-9a-f]{6}$' then lower(c->>'hex') end))
      from (select c from jsonb_array_elements(case when jsonb_typeof(o->'colors') = 'array' then o->'colors' else '[]'::jsonb end) c where btrim(coalesce(c->>'name', '')) <> '' limit 40) s), '[]'::jsonb),
    'sizes', coalesce((select jsonb_agg(left(btrim(z), 16)) from (select z from jsonb_array_elements_text(case when jsonb_typeof(o->'sizes') = 'array' then o->'sizes' else '[]'::jsonb end) z where btrim(z) <> '' limit 30) s), '[]'::jsonb),
    'mm', coalesce((select jsonb_agg(left(btrim(z), 10)) from (select z from jsonb_array_elements_text(case when jsonb_typeof(o->'mm') = 'array' then o->'mm' else '[]'::jsonb end) z where btrim(z) <> '' limit 10) s), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(left(btrim(z), 40)) from (select z from jsonb_array_elements_text(case when jsonb_typeof(o->'entries') = 'array' then o->'entries' else '[]'::jsonb end) z where btrim(z) <> '' limit 12) s), '[]'::jsonb),
    'custom', coalesce(case when jsonb_typeof(o->'custom') = 'boolean' then (o->>'custom')::boolean end, false),
    'nosize', coalesce(case when jsonb_typeof(o->'nosize') = 'boolean' then (o->>'nosize')::boolean end, false),
    'nocolor', coalesce(case when jsonb_typeof(o->'nocolor') = 'boolean' then (o->>'nocolor')::boolean end, false),
    'm2m', coalesce(case when jsonb_typeof(o->'m2m') = 'boolean' then (o->>'m2m')::boolean end, false))
$$;
create index if not exists catalog_search_idx on public.catalog using gin ((lower(name || ' ' || coalesce(brand, '') || ' ' || coalesce(category, ''))) gin_trgm_ops);
create index if not exists catalog_domain_idx on public.catalog (domain);
alter table public.catalog enable row level security;
drop policy if exists "see catalog" on public.catalog;
create policy "see catalog" on public.catalog for select to authenticated using (status in ('live', 'gone') or added_by = auth.uid() or public.is_mod());

create table if not exists public.catalog_links (
  user_id uuid references auth.users on delete cascade,
  catalog_id uuid references public.catalog on delete cascade,
  status text not null check (status in ('wanted', 'ordered', 'owned')),
  primary key (user_id, catalog_id)
);
alter table public.catalog_links add column if not exists added_at timestamptz default now();
alter table public.catalog_links add column if not exists color text;
alter table public.catalog_links add column if not exists size text;
alter table public.catalog_links enable row level security;
drop policy if exists "own links" on public.catalog_links;
create policy "own links" on public.catalog_links for select to authenticated using (user_id = auth.uid());
alter table public.catalog_flags add column if not exists resolve_note text;

create table if not exists public.catalog_flags (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.catalog on delete cascade,
  user_id uuid references auth.users on delete set null,
  kind text not null check (kind in ('report', 'fix')),
  reason text default '',
  field text default '',
  value text default '',
  note text default '',
  status text not null default 'open' check (status in ('open', 'applied', 'rejected', 'resolved')),
  created_at timestamptz default now(),
  resolved_by uuid references auth.users on delete set null,
  resolved_at timestamptz
);
create unique index if not exists catalog_flags_once on public.catalog_flags (catalog_id, user_id, kind, field) where status = 'open';
alter table public.catalog_flags enable row level security;
drop policy if exists "own or staff flags" on public.catalog_flags;
create policy "own or staff flags" on public.catalog_flags for select to authenticated using (user_id = auth.uid() or public.is_mod());

create table if not exists public.catalog_log (
  id bigserial primary key,
  at timestamptz default now(),
  actor uuid references auth.users on delete set null,
  action text not null,
  catalog_id uuid,
  detail jsonb default '{}'
);
alter table public.catalog_log enable row level security;
create table if not exists public.catalog_aliases (url text primary key, catalog_id uuid not null references public.catalog on delete cascade);
create table if not exists public.catalog_merged (old_id uuid primary key, new_id uuid not null, at timestamptz default now());
create table if not exists public.catalog_not_dupes (a uuid, b uuid, primary key (a, b));
alter table public.catalog_aliases enable row level security;
alter table public.catalog_merged enable row level security;
alter table public.catalog_not_dupes enable row level security;
drop policy if exists "staff read log" on public.catalog_log;
create policy "staff read log" on public.catalog_log for select to authenticated using (public.is_mod());

-- ===== Helpers =====
create or replace function public.cat_norm_url(u text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(lower(trim(u)), '^https?://(www\.)?', 'https://'), '[?#].*$', ''), '/+$', '')
$$;
create or replace function public.cat_domain(u text) returns text language sql immutable as $$
  select split_part(regexp_replace(lower(trim(u)), '^https?://(www\.)?', ''), '/', 1)
$$;

-- Keep own/want counts in step with links.
create or replace function public.cat_count() returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid := coalesce(new.catalog_id, old.catalog_id);
begin
  update public.catalog set
    own_n = (select count(*) from public.catalog_links where catalog_id = cid and status in ('owned', 'ordered')),
    want_n = (select count(*) from public.catalog_links where catalog_id = cid and status = 'wanted')
  where id = cid;
  return null;
end $$;
drop trigger if exists cat_count on public.catalog_links;
create trigger cat_count after insert or update or delete on public.catalog_links for each row execute function public.cat_count();

-- Has what people need to pick from: a size or colour (or made to measure / custom colours), and for suits a zip or entry.
create or replace function public.cat_complete(cid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.catalog x where x.id = cid
    and (coalesce(jsonb_array_length(x.options->'sizes'), 0) > 0 or coalesce((x.options->>'m2m')::boolean, false) or coalesce((x.options->>'nosize')::boolean, false))
    and (coalesce(jsonb_array_length(x.options->'colors'), 0) > 0 or coalesce((x.options->>'custom')::boolean, false) or coalesce((x.options->>'nocolor')::boolean, false))
    and (x.category not in ('Catsuit', 'Surfsuit') or coalesce(jsonb_array_length(x.options->'entries'), 0) > 0));
$$;
revoke all on function public.cat_complete(uuid) from public, anon, authenticated;

-- ===== User functions =====
-- Add a product from a shop link. Returns the catalog id and its status.
create or replace function public.catalog_submit(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); u text; d text; shop text; rec public.catalog; pr numeric; st text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  u := public.cat_norm_url(coalesce(p->>'url', ''));
  if u !~ '^https://[a-z0-9.-]+\.[a-z]{2,}' then raise exception 'A shop link is needed'; end if;
  d := public.cat_domain(u);
  select status into shop from public.known_shops where domain = d;
  if shop = 'blocked' then raise exception 'This shop can’t be added to the catalog'; end if;
  pr := nullif(p->>'price', '')::numeric;
  select * into rec from public.catalog where url = u;
  if not found then select c.* into rec from public.catalog_aliases a join public.catalog c on c.id = a.catalog_id where a.url = u; end if;
  if found then
    if rec.status <> 'removed' then
      update public.catalog set
        price = coalesce(pr, price),
        was_price = case when pr is not null then (case when nullif(p->>'was', '')::numeric > pr then nullif(p->>'was', '')::numeric end) else was_price end,
        currency = case when pr is not null then coalesce(nullif(p->>'currency', ''), currency) else currency end,
        low_price = case when pr is not null and (low_price is null or pr < low_price) then pr else low_price end,
        low_at = case when pr is not null and (low_price is null or pr < low_price) then current_date else low_at end,
        options = case when (options = '{}'::jsonb or (coalesce(jsonb_array_length(options->'colors'), 0) = 0 and coalesce(jsonb_array_length(options->'sizes'), 0) = 0)) and p ? 'options' then public.cat_clean_options(p->'options') when coalesce(p->'options'->>'m2m', '') = 'true' and not coalesce((options->>'m2m')::boolean, false) then options || '{"m2m": true}'::jsonb else options end,
        photos = case when coalesce(array_length(photos, 1), 0) = 0 then coalesce(array(select x from jsonb_array_elements_text(coalesce(p->'photos', '[]'::jsonb)) x where x ~ '^https?://' limit 6), '{}') else photos end,
        updated_at = now() where id = rec.id;
    end if;
    return jsonb_build_object('id', rec.id, 'status', rec.status);
  end if;
  if (select count(*) from public.catalog where added_by = me and created_at > now() - interval '1 day') >= 300 then raise exception 'Daily limit reached, try again tomorrow'; end if;
  -- Every new item waits for staff approval.
  st := 'pending';
  insert into public.catalog (url, domain, name, brand, category, materials, latex_mm, photos, price, was_price, currency, low_price, low_at, status, added_by, options)
  values (u, d, left(coalesce(nullif(trim(p->>'name'), ''), 'Untitled'), 160), left(coalesce(p->>'brand', ''), 80), left(coalesce(p->>'category', ''), 40),
    coalesce(array(select jsonb_array_elements_text(p->'materials')), '{}'), left(coalesce(p->>'latexMm', ''), 10),
    coalesce(array(select x from jsonb_array_elements_text(p->'photos') x where x ~ '^https?://' limit 6), '{}'),
    pr, case when nullif(p->>'was', '')::numeric > pr then nullif(p->>'was', '')::numeric end, coalesce(nullif(p->>'currency', ''), '€'), pr, case when pr is null then null else current_date end, st, me, public.cat_clean_options(coalesce(p->'options', '{}'::jsonb)))
  returning * into rec;
  return jsonb_build_object('id', rec.id, 'status', rec.status);
end $$;

-- The person who added an entry can still correct it while it waits for approval. After that, only staff (catalog_edit).
create or replace function public.catalog_update_mine(cid uuid, p jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.catalog set
    name = left(coalesce(nullif(trim(p->>'name'), ''), name), 160),
    brand = case when p ? 'brand' then left(coalesce(p->>'brand', ''), 80) else brand end,
    category = case when p ? 'category' then left(coalesce(p->>'category', ''), 40) else category end,
    materials = case when jsonb_typeof(p->'materials') = 'array' then array(select jsonb_array_elements_text(p->'materials')) else materials end,
    latex_mm = case when p ? 'latexMm' then left(coalesce(p->>'latexMm', ''), 10) else latex_mm end,
    updated_at = now()
  where id = cid and added_by = auth.uid() and status = 'pending';
end $$;

-- Current shared details for the entries you have, so your copies follow moderators' fixes.
-- since: only entries changed after that moment. "at" is the newest change, for the next call.
drop function if exists public.catalog_rows(uuid[]);
create or replace function public.catalog_rows(ids uuid[], since timestamptz default null) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('at', max(c.updated_at), 'rows', coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'brand', c.brand, 'category', c.category, 'materials', c.materials, 'latex_mm', c.latex_mm, 'photos', c.photos, 'status', c.status, 'options', c.options, 'updated_at', c.updated_at, 'reapproved_at', c.reapproved_at)), '[]'::jsonb))
  from public.catalog c where c.id = any(ids[1:300]) and (since is null or c.updated_at > since) and (c.status in ('live', 'gone', 'removed') or c.added_by = auth.uid());
$$;
create index if not exists catalog_updated_idx on public.catalog (updated_at);
-- Every change (status, merges, fixes) counts as an update, so people's copies pick it up.
create or replace function public.cat_touch() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists catalog_touch on public.catalog;
create trigger catalog_touch before update on public.catalog for each row when (old.* is distinct from new.*) execute function public.cat_touch();

create or replace function public.catalog_search(q text, cat text default '', lim int default 30) returns setof public.catalog language sql stable security definer set search_path = public as $$
  select * from public.catalog c
  where (c.status in ('live', 'gone') or c.added_by = auth.uid())
    and (coalesce(cat, '') = '' or c.category = cat)
    and (coalesce(trim(q), '') = '' or not exists (
      select 1 from unnest(regexp_split_to_array(lower(trim(q)), '\s+')) w
      where w <> '' and position(w in lower(c.name || ' ' || coalesce(c.brand, '') || ' ' || coalesce(c.category, '') || ' ' || c.domain)) = 0))
  order by (c.status = 'gone'), (c.own_n + c.want_n) desc, c.created_at desc
  limit least(greatest(coalesce(lim, 30), 1), 60)
$$;

create or replace function public.catalog_get(cid uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rec public.catalog; fr jsonb;
begin
  cid := coalesce((select new_id from public.catalog_merged where old_id = cid), cid);
  select * into rec from public.catalog where id = cid and (status in ('live', 'gone') or added_by = auth.uid() or public.is_mod());
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'avatar', p.avatar, 'status', l.status, 'color', l.color, 'size', l.size) order by p.username), '[]') into fr
  from public.catalog_links l join public.profiles p on p.id = l.user_id
  where l.catalog_id = cid and l.user_id in (select public.my_friend_ids(auth.uid()));
  return to_jsonb(rec) || jsonb_build_object('friends', fr,
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('tag', tag, 'n', n, 'mine', mine) order by n desc, tag), '[]') from (select tag, count(*) n, bool_or(user_id = auth.uid()) mine from public.catalog_notes where catalog_id = cid group by tag) s),
    'worn', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'url', url, 'mine', user_id = auth.uid()) order by created_at desc), '[]') from (select * from public.catalog_photos where catalog_id = cid and status = 'live' order by created_at desc limit 30) s));
end $$;

-- Replace the signed-in user's own/want links in one go. links = [{"id": "...", "s": "owned"}]
drop function if exists public.catalog_sync_links(jsonb);
create or replace function public.catalog_sync_links(links jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m jsonb; ls jsonb;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select coalesce(jsonb_object_agg(x->>'id', g.new_id), '{}') into m from jsonb_array_elements(coalesce(links, '[]')) x join public.catalog_merged g on g.old_id = (x->>'id')::uuid;
  select coalesce(jsonb_agg(case when m ? (x->>'id') then jsonb_set(x, '{id}', m->(x->>'id')) else x end), '[]') into ls from jsonb_array_elements(coalesce(links, '[]')) x;
  delete from public.catalog_links where user_id = me and catalog_id not in (select (x->>'id')::uuid from jsonb_array_elements(ls) x);
  insert into public.catalog_links (user_id, catalog_id, status, color, size)
    select distinct on ((x->>'id')::uuid) me, (x->>'id')::uuid, x->>'s', left(nullif(x->>'c', ''), 30), left(nullif(x->>'z', ''), 16) from jsonb_array_elements(ls) x
    where x->>'s' in ('wanted', 'ordered', 'owned') and exists (select 1 from public.catalog where id = (x->>'id')::uuid)
  on conflict (user_id, catalog_id) do update set status = excluded.status, color = excluded.color, size = excluded.size
    where public.catalog_links.status is distinct from excluded.status or public.catalog_links.color is distinct from excluded.color or public.catalog_links.size is distinct from excluded.size;
  return m;
end $$;

-- Report or suggest a fix. Reports: 2 hide the entry. Pick-from-list fixes: 3 established accounts agreeing apply it.
create or replace function public.catalog_flag(cid uuid, k text, reason text default '', fld text default '', val text default '', note text default '') returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int; agree int;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if k not in ('report', 'fix') then raise exception 'Unknown kind'; end if;
  if (select count(*) from public.catalog_flags where user_id = me and created_at > now() - interval '1 day') >= 30 then raise exception 'Daily limit reached, try again tomorrow'; end if;
  insert into public.catalog_flags (catalog_id, user_id, kind, reason, field, value, note)
    values (cid, me, k, left(coalesce(reason, ''), 60), left(coalesce(fld, ''), 20), left(coalesce(val, ''), 300), left(coalesce(note, ''), 500))
  on conflict (catalog_id, user_id, kind, field) where status = 'open' do update set reason = excluded.reason, value = excluded.value, note = excluded.note, created_at = now();
  if k = 'report' then
    select count(distinct user_id) into n from public.catalog_flags where catalog_id = cid and kind = 'report' and status = 'open';
    if n >= 2 then update public.catalog set status = 'hidden' where id = cid and status = 'live';
      insert into public.catalog_log (actor, action, catalog_id) values (me, 'auto-hidden: 2 reports', cid); end if;
    return jsonb_build_object('ok', true, 'hidden', n >= 2);
  end if;
  if fld in ('category', 'material', 'gone') and not public.is_new_account(me) then
    select count(distinct f.user_id) into agree from public.catalog_flags f
      where f.catalog_id = cid and f.kind = 'fix' and f.field = fld and f.value = coalesce(val, '') and f.status = 'open' and not public.is_new_account(f.user_id);
    if agree >= 3 then
      perform public.cat_apply_fix(cid, fld, coalesce(val, ''));
      update public.catalog_flags set status = 'applied', resolved_at = now() where catalog_id = cid and kind = 'fix' and field = fld and value = coalesce(val, '') and status = 'open';
      insert into public.catalog_log (actor, action, catalog_id, detail) values (me, 'auto-applied: 3 agree', cid, jsonb_build_object('field', fld, 'value', val));
      return jsonb_build_object('ok', true, 'applied', true);
    end if;
    return jsonb_build_object('ok', true, 'agree', agree);
  end if;
  return jsonb_build_object('ok', true, 'review', true);
end $$;

create or replace function public.cat_apply_fix(cid uuid, fld text, val text) returns void language plpgsql security definer set search_path = public as $$
begin
  if fld = 'category' then update public.catalog set category = left(val, 40), updated_at = now() where id = cid;
  elsif fld = 'material' then update public.catalog set materials = array[left(val, 40)], updated_at = now() where id = cid;
  elsif fld = 'gone' then update public.catalog set status = 'gone', updated_at = now() where id = cid and status = 'live';
  elsif fld = 'name' and val <> '' then update public.catalog set name = left(val, 160), updated_at = now() where id = cid;
  elsif fld = 'brand' then update public.catalog set brand = left(val, 80), updated_at = now() where id = cid;
  elsif fld = 'size' and btrim(val) <> '' then update public.catalog set options = public.cat_clean_options(options || jsonb_build_object('sizes', coalesce(options->'sizes', '[]'::jsonb) || to_jsonb(left(btrim(val), 16)))), updated_at = now() where id = cid and not coalesce(options->'sizes', '[]'::jsonb) ? left(btrim(val), 16);
  elsif fld = 'entry' and btrim(val) <> '' then update public.catalog set options = public.cat_clean_options(options || jsonb_build_object('entries', coalesce(options->'entries', '[]'::jsonb) || to_jsonb(left(btrim(val), 40)))), updated_at = now() where id = cid and not coalesce(options->'entries', '[]'::jsonb) ? left(btrim(val), 40);
  elsif fld = 'link' and val ~ '^https?://' then update public.catalog set url = public.cat_norm_url(val), domain = public.cat_domain(val), updated_at = now() where id = cid;
  end if;
end $$;
revoke all on function public.cat_apply_fix(uuid, text, text) from public, anon, authenticated;

-- ===== Staff functions =====
create or replace function public.catalog_queue() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare items jsonb; flags jsonb;
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  select coalesce(jsonb_agg(x order by x->>'created_at'), '[]') into items from (
    select to_jsonb(c) || jsonb_build_object('by', p.username, 'by_new', public.is_new_account(c.added_by), 'shop', ks.status,
      'same_link', (select count(*) from public.catalog_links l where l.catalog_id = c.id and l.user_id is distinct from c.added_by)) x
    from public.catalog c left join public.profiles p on p.id = c.added_by left join public.known_shops ks on ks.domain = c.domain
    where c.status in ('pending', 'hidden')) s;
  select coalesce(jsonb_agg(x order by x->>'created_at'), '[]') into flags from (
    select to_jsonb(f) || jsonb_build_object('by', p.username, 'by_new', public.is_new_account(f.user_id), 'item', jsonb_build_object('name', c.name, 'brand', c.brand, 'url', c.url, 'photo', c.photos[1], 'status', c.status, 'category', c.category),
      'agree', (select count(distinct g.user_id) from public.catalog_flags g where g.catalog_id = f.catalog_id and g.kind = f.kind and g.field = f.field and g.value = f.value and g.status = 'open')) x
    from public.catalog_flags f join public.catalog c on c.id = f.catalog_id left join public.profiles p on p.id = f.user_id
    where f.status = 'open') s;
  return jsonb_build_object('role', public.staff_role(), 'items', items, 'flags', flags,
    'photos', (select coalesce(jsonb_agg(x order by x->>'created_at'), '[]') from (
      select to_jsonb(ph) || jsonb_build_object('by', p.username, 'by_new', public.is_new_account(ph.user_id), 'item', jsonb_build_object('name', c.name, 'url', c.url)) x
      from public.catalog_photos ph join public.catalog c on c.id = ph.catalog_id left join public.profiles p on p.id = ph.user_id
      where ph.status in ('pending', 'hidden')) s));
end $$;

-- Item actions: approve | reject | restore | remove. Flag actions: approve | reject.
-- note: optional reason shown to the person who sent it. They also get a notification.
alter table public.catalog add column if not exists decided_at timestamptz;
alter table public.catalog add column if not exists reapprove boolean not null default false;
alter table public.catalog add column if not exists reapproved_at timestamptz;
alter table public.catalog add column if not exists decide_note text;
alter table public.catalog_flags add column if not exists resolve_note text;
drop function if exists public.catalog_decide(text, uuid, text);
create or replace function public.catalog_decide(what text, target uuid, act text, note text default '') returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); f public.catalog_flags; c public.catalog; nt text := nullif(left(btrim(coalesce(note, '')), 200), ''); was_re boolean := false; u uuid;
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  if what = 'item' then
    if act = 'approve' and not public.cat_complete(target) then raise exception 'Add sizes, colours (and for suits the zip and entry) before approving'; end if;
    select coalesce(x.reapprove, false) into was_re from public.catalog x where x.id = target;
    update public.catalog set status = case act when 'approve' then 'live' when 'restore' then 'live' when 'reject' then 'removed' when 'remove' then 'removed' else status end, updated_at = now(),
      decided_at = case when act in ('approve', 'reject') then now() else decided_at end, decide_note = case when act = 'reject' then nt when act = 'approve' then null else decide_note end,
      reapprove = case when act in ('approve', 'restore') then false else reapprove end, reapproved_at = case when act in ('approve', 'restore') and reapprove then now() else reapproved_at end where id = target returning * into c;
    -- Back after a re-check: everyone who has it is asked to set their size, colour and entry.
    if act in ('approve', 'restore') and was_re then for u in select distinct l.user_id from public.catalog_links l where l.catalog_id = c.id and l.user_id is distinct from c.added_by loop
      perform public.push_send(u, 'catalog', 'Back in the catalog', c.name || ' now has sizes and options. Set yours.', '#notifs'); end loop; end if;
    if act = 'approve' and c.added_by is not null then perform public.push_send(c.added_by, 'catalog', 'Added to the catalog', c.name || ' is live. Pick your size and colour.', '#notifs');
    elsif act = 'reject' and c.added_by is not null then perform public.push_send(c.added_by, 'catalog', 'Not added to the catalog', c.name || coalesce(': ' || nt, '.'), '#notifs'); end if;
    if act in ('approve', 'restore') then update public.catalog_flags set status = 'resolved', resolved_by = me, resolved_at = now() where catalog_id = target and kind = 'report' and status = 'open'; end if;
    insert into public.catalog_log (actor, action, catalog_id) values (me, 'item ' || act, target);
  elsif what = 'photo' then
    update public.catalog_photos set status = case when act in ('approve', 'restore') then 'live' else 'removed' end where id = target;
    update public.catalog_flags set status = 'resolved', resolved_by = me, resolved_at = now() where field = 'photo:' || target and status = 'open';
    insert into public.catalog_log (actor, action, catalog_id) select me, 'photo ' || act, catalog_id from public.catalog_photos where id = target;
  elsif what = 'flag' then
    select * into f from public.catalog_flags where id = target; if not found then return; end if;
    if f.field like 'photo:%' then
      update public.catalog_photos set status = case when act = 'approve' then 'removed' else 'live' end where id = substr(f.field, 7)::uuid and status in ('live', 'hidden');
      update public.catalog_flags set status = case when act = 'approve' then 'resolved' else 'rejected' end, resolved_by = me, resolved_at = now() where field = f.field and status = 'open';
      insert into public.catalog_log (actor, action, catalog_id, detail) values (me, 'photo report ' || act, f.catalog_id, jsonb_build_object('reason', f.reason));
      return;
    end if;
    if act = 'approve' then
      if f.kind = 'fix' then perform public.cat_apply_fix(f.catalog_id, f.field, f.value);
        update public.catalog_flags set status = 'applied', resolved_by = me, resolved_at = now() where catalog_id = f.catalog_id and kind = 'fix' and field = f.field and value = f.value and status = 'open';
        select * into c from public.catalog where id = f.catalog_id;
        perform public.push_send(f.user_id, 'catalog', 'Your suggestion was applied', c.name || case when f.field = 'size' then ' now has size ' || f.value || '. Set yours.' when f.field = 'entry' then ' now lists ' || f.value || '. Set yours.' else ' was updated.' end, '#notifs');
      else update public.catalog set status = 'removed' where id = f.catalog_id;
        update public.catalog_flags set status = 'resolved', resolved_by = me, resolved_at = now() where catalog_id = f.catalog_id and kind = 'report' and status = 'open'; end if;
    else
      update public.catalog_flags set status = 'rejected', resolved_by = me, resolved_at = now(), resolve_note = nt where id = target;
      if f.kind = 'fix' then select * into c from public.catalog where id = f.catalog_id;
        perform public.push_send(f.user_id, 'catalog', 'Suggestion not applied', 'For ' || coalesce(c.name, 'an item') || coalesce(': ' || nt, '.'), '#notifs'); end if;
      if f.kind = 'report' and not exists (select 1 from public.catalog_flags where catalog_id = f.catalog_id and kind = 'report' and status = 'open') then
        update public.catalog set status = 'live' where id = f.catalog_id and status = 'hidden'; end if;
    end if;
    insert into public.catalog_log (actor, action, catalog_id, detail) values (me, f.kind || ' ' || act, f.catalog_id, jsonb_build_object('field', f.field, 'value', f.value, 'reason', f.reason));
  end if;
end $$;

-- Admins only: trust or block a shop (blocking removes all its entries), or clear it.
create or replace function public.catalog_shop(d text, st text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  d := lower(regexp_replace(trim(d), '^(https?://)?(www\.)?', '')); d := split_part(d, '/', 1);
  if st is null or st = '' then delete from public.known_shops where domain = d;
  else insert into public.known_shops (domain, status, added_by) values (d, st, auth.uid()) on conflict (domain) do update set status = excluded.status; end if;
  if st = 'blocked' then update public.catalog set status = 'removed' where domain = d and status <> 'removed'; end if;
  insert into public.catalog_log (actor, action, detail) values (auth.uid(), 'shop ' || coalesce(nullif(st, ''), 'cleared'), jsonb_build_object('domain', d));
end $$;

-- Admins only: make someone a moderator or admin, or remove their role (role = '').
create or replace function public.catalog_staff_set(uname text, r text) returns void language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select id into who from public.profiles where username = lower(trim(both '@' from trim(uname)));
  if who is null then raise exception 'No one is called @%', uname; end if;
  if who = auth.uid() and coalesce(r, '') <> 'admin' then raise exception 'You can’t remove your own admin role'; end if;
  if coalesce(r, '') = '' then delete from public.staff where user_id = who;
  else insert into public.staff (user_id, role) values (who, r) on conflict (user_id) do update set role = excluded.role; end if;
  insert into public.catalog_log (actor, action, detail) values (auth.uid(), 'staff ' || coalesce(nullif(r, ''), 'removed'), jsonb_build_object('username', uname));
end $$;

create or replace function public.catalog_admin_info() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  return jsonb_build_object(
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('username', p.username, 'role', s.role) order by s.role, p.username), '[]') from public.staff s join public.profiles p on p.id = s.user_id),
    'shops', (select coalesce(jsonb_agg(jsonb_build_object('domain', k.domain, 'status', k.status, 'n', (select count(*) from public.catalog c where c.domain = k.domain)) order by k.status, k.domain), '[]') from public.known_shops k),
    'log', (select coalesce(jsonb_agg(jsonb_build_object('at', l.at, 'by', p.username, 'action', l.action, 'item', c.name, 'detail', l.detail) order by l.at desc), '[]') from (select * from public.catalog_log order by at desc limit 100) l left join public.profiles p on p.id = l.actor left join public.catalog c on c.id = l.catalog_id),
    'counts', (select jsonb_build_object('live', count(*) filter (where status = 'live'), 'pending', count(*) filter (where status = 'pending'), 'hidden', count(*) filter (where status = 'hidden'), 'gone', count(*) filter (where status = 'gone')) from public.catalog));
end $$;

-- Staff, or the person who added it: fill in shop photos for an entry that has none yet.
create or replace function public.catalog_fill_photos(cid uuid, ph jsonb) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.catalog set photos = coalesce(array(select x from jsonb_array_elements_text(coalesce(ph, '[]'::jsonb)) x where x ~ '^https?://' and x !~ '/storage/v1/' limit 6), '{}'), updated_at = now()
    where id = cid and coalesce(array_length(photos, 1), 0) = 0 and (public.is_mod() or added_by = auth.uid() or exists (select 1 from public.catalog_links l where l.catalog_id = cid and l.user_id = auth.uid()));
  get diagnostics n = row_count; return n;
end $$;

-- Staff only: correct an entry's details (often before approving it).
create or replace function public.catalog_edit(cid uuid, p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare old public.catalog; u text; pr numeric;
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  select * into old from public.catalog where id = cid; if not found then raise exception 'Not found'; end if;
  if coalesce(p->>'url', '') <> '' then u := public.cat_norm_url(p->>'url');
    if u !~ '^https://[a-z0-9.-]+\.[a-z]{2,}' then raise exception 'That link doesn’t look right'; end if;
    if u <> old.url and exists (select 1 from public.catalog where url = u) then raise exception 'Another entry already has that link'; end if; end if;
  if p ? 'price' then pr := nullif(replace(coalesce(p->>'price', ''), ',', '.'), '')::numeric; end if;
  update public.catalog set
    name = case when coalesce(trim(p->>'name'), '') <> '' then left(trim(p->>'name'), 160) else name end,
    brand = case when p ? 'brand' then left(trim(coalesce(p->>'brand', '')), 80) else brand end,
    category = case when p ? 'category' then left(coalesce(p->>'category', ''), 40) else category end,
    materials = case when p ? 'materials' then coalesce(array(select left(x, 40) from jsonb_array_elements_text(p->'materials') x limit 6), '{}') else materials end,
    latex_mm = case when p ? 'latexMm' then left(coalesce(p->>'latexMm', ''), 10) else latex_mm end,
    price = case when p ? 'price' then pr else price end,
    was_price = case when p ? 'was' then (case when nullif(replace(coalesce(p->>'was', ''), ',', '.'), '')::numeric > coalesce(case when p ? 'price' then pr else price end, 0) then nullif(replace(coalesce(p->>'was', ''), ',', '.'), '')::numeric end) else was_price end,
    currency = case when coalesce(p->>'currency', '') <> '' then left(p->>'currency', 3) else currency end,
    low_price = case when p ? 'price' and pr is not null and (low_price is null or pr < low_price) then pr else low_price end,
    low_at = case when p ? 'price' and pr is not null and (low_price is null or pr < low_price) then current_date else low_at end,
    photos = case when p ? 'photos' then coalesce(array(select x from jsonb_array_elements_text(p->'photos') x where x ~ '^https?://' and (x !~ '/storage/v1/' or x ~ '/storage/v1/object/public/catalog/') limit 12), '{}') else photos end,
    options = case when p ? 'options' then public.cat_clean_options(p->'options') else options end,
    url = coalesce(u, url), domain = case when u is not null then public.cat_domain(u) else domain end,
    updated_at = now()
  where id = cid;
  insert into public.catalog_log (actor, action, catalog_id, detail) values (auth.uid(), 'edited', cid, (p - 'photos') || jsonb_build_object('photos', jsonb_array_length(coalesce(p->'photos', '[]'::jsonb))));
  -- The old link keeps pointing here, so people's items that use it stay linked.
  if u is not null and u <> old.url then insert into public.catalog_aliases (url, catalog_id) values (old.url, cid) on conflict (url) do update set catalog_id = excluded.catalog_id; delete from public.catalog_aliases where url = u; end if;
end $$;

-- Staff only: search every entry, whatever its status.
create or replace function public.catalog_admin_search(q text default '', st text default '', lim int default 60) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  select coalesce(jsonb_agg(x), '[]') into out from (
    select to_jsonb(c) || jsonb_build_object('by', p.username) x from public.catalog c left join public.profiles p on p.id = c.added_by
    where (coalesce(st, '') = '' or c.status = st)
      and (coalesce(trim(q), '') = '' or not exists (
        select 1 from unnest(regexp_split_to_array(lower(trim(q)), '\s+')) w
        where w <> '' and position(w in lower(c.name || ' ' || coalesce(c.brand, '') || ' ' || coalesce(c.category, '') || ' ' || c.url)) = 0))
    order by c.updated_at desc limit least(greatest(coalesce(lim, 60), 1), 200)) s;
  return out;
end $$;

-- ===== Fit notes (owners only, preset tags) =====
create table if not exists public.catalog_notes (
  catalog_id uuid references public.catalog on delete cascade,
  user_id uuid references auth.users on delete cascade,
  tag text not null,
  created_at timestamptz default now(),
  primary key (catalog_id, user_id, tag)
);
alter table public.catalog_notes enable row level security;
drop policy if exists "own notes" on public.catalog_notes;
create policy "own notes" on public.catalog_notes for select to authenticated using (user_id = auth.uid());
-- Only the three sizing notes and short own notes are kept.
delete from public.catalog_notes where not (tag in ('True to size', 'Runs small', 'Runs large') or tag like 'note:%');

create or replace function public.catalog_note_set(cid uuid, t text, turn_on boolean) returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); pre text[] := array['True to size', 'Runs small', 'Runs large']; own_note text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  t := trim(coalesce(t, ''));
  if not (t = any(pre)) then
    if t !~ '^note:' then raise exception 'Unknown fit note'; end if;
    own_note := btrim(substr(t, 6)); t := 'note:' || own_note;
    if char_length(own_note) < 2 or char_length(own_note) > 30 then raise exception 'Notes can be 2 to 30 characters'; end if;
    if own_note ~* '(https?:|www\.|\.com|\.nl|@)' then raise exception 'Notes can’t contain links or usernames'; end if;
  end if;
  if turn_on then
    if not exists (select 1 from public.catalog_links where catalog_id = cid and user_id = me and status in ('owned', 'ordered')) then raise exception 'Only people who own it can add fit notes'; end if;
    if t = any(pre) then delete from public.catalog_notes where catalog_id = cid and user_id = me and tag = any(pre);
    else delete from public.catalog_notes where catalog_id = cid and user_id = me and tag like 'note:%'; end if;
    insert into public.catalog_notes (catalog_id, user_id, tag) values (cid, me, t) on conflict do nothing;
  else delete from public.catalog_notes where catalog_id = cid and user_id = me and tag = t; end if;
end $$;

-- ===== Photos shared by owners ("Worn by others") =====
create table if not exists public.catalog_photos (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.catalog on delete cascade,
  user_id uuid references auth.users on delete cascade,
  url text not null,
  status text not null default 'pending' check (status in ('pending', 'live', 'hidden', 'removed')),
  created_at timestamptz default now()
);
create index if not exists catalog_photos_idx on public.catalog_photos (catalog_id, status);
alter table public.catalog_photos enable row level security;
drop policy if exists "see shared photos" on public.catalog_photos;
create policy "see shared photos" on public.catalog_photos for select to authenticated using (status = 'live' or user_id = auth.uid() or public.is_mod());
drop policy if exists "owners upload worn photos" on storage.objects;
create policy "owners upload worn photos" on storage.objects for insert to authenticated with check (bucket_id = 'catalog' and (storage.foldername(name))[1] = 'worn' and (storage.foldername(name))[2] = auth.uid()::text);
drop policy if exists "owners delete worn photos" on storage.objects;
create policy "owners delete worn photos" on storage.objects for delete to authenticated using (bucket_id = 'catalog' and (storage.foldername(name))[1] = 'worn' and (storage.foldername(name))[2] = auth.uid()::text);

create or replace function public.catalog_photo_add(cid uuid, u text) returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); st text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if position('/storage/v1/object/public/catalog/worn/' || me::text || '/' in u) = 0 then raise exception 'Not your upload'; end if;
  if not exists (select 1 from public.catalog_links where catalog_id = cid and user_id = me and status in ('owned', 'ordered')) then raise exception 'Only people who own it can share photos'; end if;
  if (select count(*) from public.catalog_photos where catalog_id = cid and user_id = me and status <> 'removed') >= 6 then raise exception 'Up to 6 photos per item'; end if;
  st := 'pending'; -- every shared photo is checked by staff before anyone sees it
  insert into public.catalog_photos (catalog_id, user_id, url, status) values (cid, me, u, st);
  return st;
end $$;

create or replace function public.catalog_photos_mine(cid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'url', url, 'status', status) order by created_at), '[]') from public.catalog_photos where catalog_id = cid and user_id = auth.uid() and status <> 'removed'
$$;

-- Stop sharing: removes your shared photos for this item and returns their links so the app can delete the files.
create or replace function public.catalog_photos_remove(cid uuid) returns text[] language plpgsql security definer set search_path = public as $$
declare urls text[];
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select coalesce(array_agg(url), '{}') into urls from public.catalog_photos where catalog_id = cid and user_id = auth.uid();
  delete from public.catalog_photos where catalog_id = cid and user_id = auth.uid();
  return urls;
end $$;

-- Report one shared photo. Two reports hide it until staff check.
create or replace function public.catalog_photo_report(pid uuid, reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); ph public.catalog_photos; n int;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into ph from public.catalog_photos where id = pid; if not found then raise exception 'Not found'; end if;
  if (select count(*) from public.catalog_flags where user_id = me and created_at > now() - interval '1 day') >= 30 then raise exception 'Daily limit reached, try again tomorrow'; end if;
  insert into public.catalog_flags (catalog_id, user_id, kind, reason, field, value)
    values (ph.catalog_id, me, 'report', left(coalesce(reason, ''), 60), 'photo:' || pid, ph.url)
  on conflict (catalog_id, user_id, kind, field) where status = 'open' do update set reason = excluded.reason, created_at = now();
  select count(distinct user_id) into n from public.catalog_flags where field = 'photo:' || pid and status = 'open';
  if n >= 2 then update public.catalog_photos set status = 'hidden' where id = pid and status = 'live'; end if;
  return jsonb_build_object('ok', true, 'hidden', n >= 2);
end $$;

-- Everything you've contributed, with where it stands.
create or replace function public.catalog_my_activity() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  return jsonb_build_object(
    'added', (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]') from (select jsonb_build_object('id', id, 'name', name, 'brand', brand, 'status', status, 'at', created_at, 'decided_at', decided_at, 'note', decide_note, 'photo', photos[1]) x from public.catalog where added_by = me order by created_at desc limit 60) s),
    'flags', (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]') from (select jsonb_build_object('kind', f.kind, 'field', f.field, 'value', case when f.field like 'photo:%' then '' else f.value end, 'reason', f.reason, 'status', f.status, 'at', f.created_at, 'resolved_at', f.resolved_at, 'note', f.resolve_note, 'id', c.id, 'name', c.name, 'photo', c.photos[1]) x from public.catalog_flags f join public.catalog c on c.id = f.catalog_id where f.user_id = me order by f.created_at desc limit 60) s),
    'photos', (select coalesce(jsonb_agg(x order by x->>'at' desc), '[]') from (select jsonb_build_object('id', c.id, 'name', c.name, 'url', p.url, 'status', p.status, 'at', p.created_at) x from public.catalog_photos p join public.catalog c on c.id = p.catalog_id where p.user_id = me order by p.created_at desc limit 60) s));
end $$;

-- ===== Discover rows =====
-- Trending and "owners also have" need at least 2 people, so no one's single item gives them away.
create or replace function public.catalog_discover() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  return jsonb_build_object(
    'sale', (select coalesce(jsonb_agg(to_jsonb(c) order by c.price / c.was_price), '[]') from (select * from public.catalog where status = 'live' and price is not null and was_price is not null and was_price > price order by price / was_price limit 12) c),
    'trending', (select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('adds', t.n) order by t.n desc), '[]') from (
        select catalog_id, count(*) n from public.catalog_links where status = 'wanted' and added_at > now() - interval '7 days' group by catalog_id having count(*) >= 2 order by n desc limit 10) t
      join public.catalog c on c.id = t.catalog_id and c.status = 'live'),
    'pairs', (select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object('n', t.n) order by t.n desc), '[]') from (
        select l2.catalog_id, count(distinct l2.user_id) n
        from public.catalog_links m
        join public.catalog_links l1 on l1.catalog_id = m.catalog_id and l1.user_id <> me and l1.status in ('owned', 'ordered')
        join public.catalog_links l2 on l2.user_id = l1.user_id and l2.status in ('owned', 'ordered')
        where m.user_id = me and m.status in ('owned', 'ordered') and l2.catalog_id not in (select catalog_id from public.catalog_links where user_id = me)
        group by l2.catalog_id having count(distinct l2.user_id) >= 2 order by n desc limit 10) t
      join public.catalog c on c.id = t.catalog_id and c.status = 'live'));
end $$;

-- ===== Duplicates: suggestions and merging (staff) =====
create or replace function public.cat_base_name(n text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(n, '')), '\m(black|white|red|blue|navy|yellow|green|lime|purple|violet|pink|orange|grey|gray|silver|gold|brown|beige|transparent|clear|chrome|metallic|cream|burgundy|teal|turquoise|copper|camo|zwart|wit|rood|blauw|geel|groen|paars|roze|oranje|grijs|colou?r|xs|s|m|l|xl|xxl|size)\M', ' ', 'g'), '[^a-z0-9]+', ' ', 'g'))
$$;
create or replace function public.catalog_dupes() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('sim', round(s.sim::numeric, 2), 'a', to_jsonb(a), 'b', to_jsonb(b)) order by s.sim desc), '[]') from (
    select x.id ai, y.id bi, similarity(public.cat_base_name(x.name), public.cat_base_name(y.name)) sim
    from public.catalog x join public.catalog y on x.id < y.id
      and (lower(coalesce(nullif(x.brand, ''), x.domain)) = lower(coalesce(nullif(y.brand, ''), y.domain)) or x.domain = y.domain)
    where x.status in ('live', 'pending', 'gone') and y.status in ('live', 'pending', 'gone')
      and not exists (select 1 from public.catalog_not_dupes d where (d.a = x.id and d.b = y.id) or (d.a = y.id and d.b = x.id))
      and similarity(public.cat_base_name(x.name), public.cat_base_name(y.name)) >= 0.6
    order by 3 desc limit 40) s join public.catalog a on a.id = s.ai join public.catalog b on b.id = s.bi);
end $$;
create or replace function public.catalog_not_dupe(x uuid, y uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  insert into public.catalog_not_dupes (a, b) values (least(x, y), greatest(x, y)) on conflict do nothing;
end $$;
-- Fold src into dst: owners, fit notes, shared photos, reports, colours and sizes move over; src's link keeps working.
create or replace function public.catalog_merge(src uuid, dst uuid) returns void language plpgsql security definer set search_path = public as $$
declare s public.catalog; d public.catalog; me uuid := auth.uid();
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  if src = dst then raise exception 'Pick two different entries'; end if;
  select * into s from public.catalog where id = src; select * into d from public.catalog where id = dst;
  if s.id is null or d.id is null then raise exception 'Not found'; end if;
  insert into public.catalog_links (user_id, catalog_id, status, color, size, added_at) select user_id, dst, status, color, size, added_at from public.catalog_links where catalog_id = src on conflict (user_id, catalog_id) do nothing;
  delete from public.catalog_links where catalog_id = src;
  insert into public.catalog_notes (catalog_id, user_id, tag, created_at) select dst, user_id, tag, created_at from public.catalog_notes where catalog_id = src on conflict do nothing;
  update public.catalog_photos set catalog_id = dst where catalog_id = src;
  delete from public.catalog_flags f where f.catalog_id = src and f.status = 'open' and exists (select 1 from public.catalog_flags g where g.catalog_id = dst and g.user_id = f.user_id and g.kind = f.kind and g.field = f.field and g.status = 'open');
  update public.catalog_flags set catalog_id = dst where catalog_id = src;
  update public.catalog set
    options = public.cat_clean_options(jsonb_build_object(
      'colors', (select coalesce(jsonb_agg(c), '[]') from (select distinct on (lower(c->>'name')) c from jsonb_array_elements(coalesce(d.options->'colors', '[]') || coalesce(s.options->'colors', '[]')) c) z),
      'sizes', (select coalesce(jsonb_agg(z), '[]') from (select distinct z from jsonb_array_elements_text(coalesce(d.options->'sizes', '[]') || coalesce(s.options->'sizes', '[]')) z) y),
      'entries', (select coalesce(jsonb_agg(z), '[]') from (select distinct z from jsonb_array_elements_text(coalesce(d.options->'entries', '[]') || coalesce(s.options->'entries', '[]')) z) y),
      'mm', (select coalesce(jsonb_agg(z), '[]') from (select distinct z from jsonb_array_elements_text(coalesce(d.options->'mm', '[]') || coalesce(s.options->'mm', '[]')) z) y),
      'custom', coalesce((d.options->>'custom')::boolean, false) or coalesce((s.options->>'custom')::boolean, false),
      'm2m', coalesce((d.options->>'m2m')::boolean, false) or coalesce((s.options->>'m2m')::boolean, false))),
    photos = case when coalesce(array_length(d.photos, 1), 0) = 0 then s.photos else d.photos end,
    status = case when d.status = 'pending' and s.status = 'live' then 'live' else d.status end,
    updated_at = now()
  where id = dst;
  insert into public.catalog_aliases (url, catalog_id) values (s.url, dst) on conflict (url) do update set catalog_id = dst;
  update public.catalog_aliases set catalog_id = dst where catalog_id = src;
  update public.catalog_merged set new_id = dst where new_id = src;
  insert into public.catalog_merged (old_id, new_id) values (src, dst) on conflict (old_id) do update set new_id = dst;
  delete from public.catalog where id = src;
  update public.catalog set own_n = (select count(*) from public.catalog_links where catalog_id = dst and status in ('owned', 'ordered')), want_n = (select count(*) from public.catalog_links where catalog_id = dst and status = 'wanted') where id = dst;
  insert into public.catalog_log (actor, action, catalog_id, detail) values (me, 'merged', dst, jsonb_build_object('from', s.name, 'url', s.url));
end $$;

-- ===== Browse by type (category tiles) =====
create or replace function public.cat_tile(cat text, nm text) returns text language sql immutable as $$
  select case
    when lower(coalesce(cat, '')) ~ '(boot|shoe|sneaker|heel|footwear)' then 'footwear'
    when lower(coalesce(cat, '')) ~ '(catsuit|surfsuit|leotard|bodysuit|zentai|suit)' then 'suits'
    when lower(coalesce(cat, '')) ~ '(hood|mask|helmet|head)' then 'headgear'
    when lower(coalesce(cat, '')) ~ '(harness)' then 'harnesses'
    when lower(coalesce(cat, '')) ~ '(mitt)' then 'mittens'
    when lower(coalesce(cat, '')) ~ '(glove|sock|paw|feet|foot)' then 'handsfeet'
    when lower(coalesce(cat, '')) ~ '(chastity)' then 'chastity'
    when lower(coalesce(cat, '')) ~ '(equipment|furniture|bench|sling|frame)' then 'equipment'
    when lower(coalesce(cat, '')) ~ '(bottom|short|brief|underwear|trouser|tight|skirt|legging|pant|jock)' then 'bottoms'
    when lower(coalesce(cat, '')) ~ '(top|jacket|shirt|vest|coat)' then 'tops'
    when lower(coalesce(cat, '')) ~ '(cuff|gag|leash|collar|toy|restraint|plug|tail)' then 'play'
    else 'accessories' end
$$;
create table if not exists public.catalog_tile_covers (tile text primary key, url text not null, updated_by uuid references auth.users on delete set null, updated_at timestamptz default now());
alter table public.catalog_tile_covers enable row level security;
create or replace function public.catalog_tiles() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('tile', s.t, 'n', s.n, 'photo', coalesce(cv.url, s.photo), 'auto', s.photo, 'custom', cv.url is not null)), '[]') from (
    select public.cat_tile(category, name) t, count(*) n, (array_agg(photos[1] order by own_n + want_n desc) filter (where photos[1] is not null))[1] photo
    from public.catalog where status = 'live' group by 1) s left join public.catalog_tile_covers cv on cv.tile = s.t
$$;
-- Staff: set or clear (url = '') the cover photo of a category tile.
create or replace function public.catalog_tile_cover_set(t text, u text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  if t not in ('suits', 'headgear', 'tops', 'bottoms', 'handsfeet', 'mittens', 'footwear', 'harnesses', 'play', 'chastity', 'equipment', 'accessories') then raise exception 'Unknown category'; end if;
  if coalesce(u, '') = '' then delete from public.catalog_tile_covers where tile = t;
  else
    if u !~ '^https?://' then raise exception 'That isn’t a photo link'; end if;
    insert into public.catalog_tile_covers (tile, url, updated_by) values (t, u, auth.uid()) on conflict (tile) do update set url = excluded.url, updated_by = excluded.updated_by, updated_at = now();
  end if;
  insert into public.catalog_log (actor, action, detail) values (auth.uid(), 'category cover', jsonb_build_object('tile', t, 'cleared', coalesce(u, '') = ''));
end $$;
create or replace function public.catalog_browse(t text, lim int default 60) returns setof public.catalog language sql stable security definer set search_path = public as $$
  select * from public.catalog where (status in ('live', 'gone') or (added_by = auth.uid() and status = 'pending')) and public.cat_tile(category, name) = t
  order by (status = 'gone'), own_n + want_n desc, created_at desc limit least(greatest(coalesce(lim, 60), 1), 120)
$$;

-- ===== Size sets (staff): named lists of sizes to apply to entries in one tap =====
create table if not exists public.catalog_size_sets (id uuid primary key default gen_random_uuid(), name text not null, sizes jsonb not null default '[]'::jsonb, m2m boolean not null default false, updated_by uuid references auth.users on delete set null, updated_at timestamptz default now());
alter table public.catalog_size_sets enable row level security;
create or replace function public.catalog_size_sets() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sizes', sizes, 'm2m', m2m) order by lower(name)), '[]'::jsonb) from public.catalog_size_sets);
end $$;
create or replace function public.catalog_size_set_save(sid uuid, nm text, sz jsonb, mtm boolean) returns uuid language plpgsql security definer set search_path = public as $$
declare out_id uuid; clean jsonb;
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  if coalesce(btrim(nm), '') = '' then raise exception 'Give the set a name'; end if;
  clean := coalesce((select jsonb_agg(left(btrim(z), 16)) from (select z from jsonb_array_elements_text(case when jsonb_typeof(sz) = 'array' then sz else '[]'::jsonb end) z where btrim(z) <> '' limit 40) q), '[]'::jsonb);
  if sid is null then insert into public.catalog_size_sets (name, sizes, m2m, updated_by) values (left(btrim(nm), 60), clean, coalesce(mtm, false), auth.uid()) returning id into out_id;
  else update public.catalog_size_sets set name = left(btrim(nm), 60), sizes = clean, m2m = coalesce(mtm, false), updated_by = auth.uid(), updated_at = now() where id = sid returning id into out_id; end if;
  insert into public.catalog_log (actor, action, detail) values (auth.uid(), 'size set saved', jsonb_build_object('name', nm));
  return out_id;
end $$;
create or replace function public.catalog_size_set_delete(sid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  delete from public.catalog_size_sets where id = sid;
end $$;

do $$ declare f text; begin
  foreach f in array array['catalog_size_sets()', 'catalog_size_set_save(uuid, text, jsonb, boolean)', 'catalog_size_set_delete(uuid)', 'catalog_submit(jsonb)', 'catalog_update_mine(uuid, jsonb)', 'catalog_rows(uuid[], timestamptz)', 'catalog_search(text, text, int)', 'catalog_get(uuid)', 'catalog_sync_links(jsonb)', 'catalog_flag(uuid, text, text, text, text, text)', 'catalog_queue()', 'catalog_decide(text, uuid, text, text)', 'catalog_shop(text, text)', 'catalog_staff_set(text, text)', 'catalog_admin_info()', 'staff_role()', 'catalog_fill_photos(uuid, jsonb)', 'catalog_edit(uuid, jsonb)', 'catalog_admin_search(text, text, int)', 'catalog_note_set(uuid, text, boolean)', 'catalog_photo_add(uuid, text)', 'catalog_photos_mine(uuid)', 'catalog_photos_remove(uuid)', 'catalog_photo_report(uuid, text)', 'catalog_my_activity()', 'catalog_discover()', 'catalog_dupes()', 'catalog_not_dupe(uuid, uuid)', 'catalog_merge(uuid, uuid)', 'catalog_tiles()', 'catalog_browse(text, int)', 'catalog_tile_cover_set(text, text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop; end $$;

-- ===== Photos staff upload for catalog entries (public bucket) =====
insert into storage.buckets (id, name, public) values ('catalog', 'catalog', true) on conflict (id) do update set public = true;
drop policy if exists "staff upload catalog photos" on storage.objects;
create policy "staff upload catalog photos" on storage.objects for insert to authenticated with check (bucket_id = 'catalog' and public.is_mod());
drop policy if exists "staff delete catalog photos" on storage.objects;
create policy "staff delete catalog photos" on storage.objects for delete to authenticated using (bucket_id = 'catalog' and public.is_mod());

-- ===== Starting data =====
insert into public.known_shops (domain) values ('libidex.com'), ('kinkfox.com'), ('mybluewolf.com'), ('kinkprojects.com') on conflict do nothing;
-- Also trust any shop that two or more people already have links from.
insert into public.known_shops (domain)
  select d from (
    select distinct u.user_id, public.cat_domain(i->>'url') d
    from public.user_data u, jsonb_array_elements(coalesce(u.data->'gw'->'profiles', '[]')) pr, jsonb_array_elements(coalesce(pr->'items', '[]')) i
    where coalesce(i->>'url', '') ~ '^https?://') s
  group by d having count(*) >= 2
on conflict do nothing;

-- First admin.
insert into public.staff (user_id, role) select id, 'admin' from public.profiles where username = 'buckie' on conflict (user_id) do update set role = 'admin';

-- Catalog notifications for everyone who already turned notifications on.
do $$ begin update public.push_subs set kinds = array_append(kinds, 'catalog') where not ('catalog' = any(kinds)); exception when others then null; end $$;

-- Approved entries missing sizes/colours (or a suit's zip and entry) go back to the queue until staff fill them in.
alter table public.catalog add column if not exists reapprove boolean not null default false;
alter table public.catalog add column if not exists reapproved_at timestamptz;
update public.catalog c set status = 'pending', reapprove = true where c.status = 'live' and not public.cat_complete(c.id);
