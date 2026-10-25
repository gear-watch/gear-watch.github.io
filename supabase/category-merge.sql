-- GearWatch: merge people's custom categories into built-in ones.
-- Run after catalog.sql and new-tiles.sql. Safe to run again.
-- Staff see custom categories in Admin → Custom categories and pick a built-in one.
-- The catalog is updated right away; each person's own items move the next time they open the app.

create or replace function public.cat_norm(c text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(lower(coalesce(c, '')), '[^a-z]', '', 'g'), 's$', '')
$$;
-- Categories staff add for everyone. tile = an existing square, or 'c:<name>' for its own square.
create table if not exists public.catalog_categories (
  norm text primary key,
  name text not null,
  tile text not null,
  zip boolean not null default false,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);
alter table public.catalog_categories enable row level security;
create or replace function public.cat_builtin() returns text[] language sql stable security definer set search_path = public as $$
  select array['Catsuit', 'Surfsuit', 'Leotard', 'Top', 'Jacket', 'Bottoms', 'Hood', 'Harness', 'Shorts', 'Underwear', 'Trousers', 'Tights', 'Skirt', 'Gloves', 'Mittens', 'Socks', 'Boots', 'Shoes', 'Cuffs', 'Gags', 'Chastity', 'Leashes', 'Collars', 'Toys', 'Equipment', 'Accessory']::text[] || coalesce((select array_agg(name order by created_at) from public.catalog_categories), '{}'::text[])
$$;
create table if not exists public.category_remaps (
  from_norm text primary key,
  from_label text not null,
  to_cat text not null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);
alter table public.category_remaps enable row level security;

-- Every custom category in use, grouped by spelling (Mitts, mitts, MITTS → one row).
create or replace function public.cat_custom_scan() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b text[]; out jsonb;
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  select array_agg(public.cat_norm(x)) into b from unnest(public.cat_builtin()) x;
  with src as (
    select u.user_id uid, i->>'category' c, i->>'name' n, 'user' s
    from public.user_data u, jsonb_array_elements(coalesce(u.data->'gw'->'profiles', '[]')) pr, jsonb_array_elements(coalesce(pr->'items', '[]')) i
    where jsonb_typeof(i) = 'object' and btrim(coalesce(i->>'category', '')) <> ''
    union all
    select null, category, name, 'catalog' from public.catalog where status <> 'removed' and btrim(coalesce(category, '')) <> ''
  ), cu as (select *, public.cat_norm(c) k from src where public.cat_norm(c) <> '' and not (public.cat_norm(c) = any(b) or c = 'Accessory'))
  select coalesce(jsonb_agg(row_to_json(g)::jsonb order by g.people desc, g.items desc, g.label), '[]'::jsonb) into out from (
    select cu.k, mode() within group (order by cu.c) label, count(distinct cu.uid) people, count(*) filter (where cu.s = 'user') items, count(*) filter (where cu.s = 'catalog') cat_n,
      (array_agg(distinct cu.n) filter (where cu.n is not null))[1:4] samples, r.to_cat
    from cu left join public.category_remaps r on r.from_norm = cu.k group by cu.k, r.to_cat limit 300) g;
  return out;
end $$;
revoke all on function public.cat_custom_scan() from public, anon;
grant execute on function public.cat_custom_scan() to authenticated;

-- Set (or clear, with to_cat = '') the built-in category a custom one moves into.
create or replace function public.cat_remap_set(f text, to_cat text) returns int language plpgsql security definer set search_path = public as $$
declare k text := public.cat_norm(f); n int := 0;
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  if k = '' then raise exception 'Pick a category'; end if;
  if coalesce(to_cat, '') = '' then delete from public.category_remaps where from_norm = k;
  else
    if not (to_cat = any(public.cat_builtin())) then raise exception 'That isn’t a built-in category'; end if;
    insert into public.category_remaps (from_norm, from_label, to_cat, created_by) values (k, btrim(f), to_cat, auth.uid())
      on conflict (from_norm) do update set to_cat = excluded.to_cat, from_label = excluded.from_label, created_by = excluded.created_by, created_at = now();
    update public.catalog set category = to_cat, updated_at = now() where public.cat_norm(category) = k and category <> to_cat;
    get diagnostics n = row_count;
  end if;
  insert into public.catalog_log (actor, action, detail) values (auth.uid(), 'category merge', jsonb_build_object('from', btrim(f), 'to', coalesce(to_cat, ''), 'catalog', n));
  return n;
end $$;
revoke all on function public.cat_remap_set(text, text) from public, anon;
grant execute on function public.cat_remap_set(text, text) to authenticated;

-- Read by the app on open and every catalog sync: { "mitt": "Mittens", ... }
create or replace function public.cat_remaps() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(from_norm, to_cat), '{}'::jsonb) from public.category_remaps
$$;
revoke all on function public.cat_remaps() from public, anon;
grant execute on function public.cat_remaps() to authenticated;
