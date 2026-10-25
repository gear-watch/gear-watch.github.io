-- GearWatch: categories staff create for everyone (Admin → Categories).
-- Run after catalog.sql. Safe to run again. Re-run category-merge.sql afterwards if you use it.
-- Each category either gets its own square or sits inside an existing one (e.g. Gasmask → Headgear).

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

create or replace function public.cat_tile(cat text, nm text) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select tile from public.catalog_categories where norm = public.cat_norm(cat)), case
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
    else 'accessories' end)
$$;

create or replace function public.cat_builtin() returns text[] language sql stable security definer set search_path = public as $$
  select array['Catsuit', 'Surfsuit', 'Leotard', 'Top', 'Jacket', 'Bottoms', 'Hood', 'Harness', 'Shorts', 'Underwear', 'Trousers', 'Tights', 'Skirt', 'Gloves', 'Mittens', 'Socks', 'Boots', 'Shoes', 'Cuffs', 'Gags', 'Chastity', 'Leashes', 'Collars', 'Toys', 'Equipment', 'Accessory']::text[] || coalesce((select array_agg(name order by created_at) from public.catalog_categories), '{}'::text[])
$$;

-- Everyone reads the list on app open and every catalog sync.
create or replace function public.cat_official() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'tile', tile, 'zip', zip) order by created_at), '[]'::jsonb) from public.catalog_categories
$$;
grant execute on function public.cat_official() to anon, authenticated;

create or replace function public.cat_official_set(nm text, tl text, zp boolean) returns text language plpgsql security definer set search_path = public as $$
declare n text := btrim(coalesce(nm, '')); k text; tile_k text;
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  n := upper(left(n, 1)) || substr(n, 2); k := public.cat_norm(n);
  if length(n) < 2 or length(n) > 30 or k = '' then raise exception 'Use 2 to 30 letters'; end if;
  if k = any(select public.cat_norm(x) from unnest(array['Catsuit', 'Surfsuit', 'Leotard', 'Top', 'Jacket', 'Bottoms', 'Hood', 'Harness', 'Shorts', 'Underwear', 'Trousers', 'Tights', 'Skirt', 'Gloves', 'Mittens', 'Socks', 'Boots', 'Shoes', 'Cuffs', 'Gags', 'Chastity', 'Leashes', 'Collars', 'Toys', 'Equipment', 'Accessory']::text[]) x) then raise exception 'That category already exists'; end if;
  tile_k := coalesce(nullif(tl, ''), 'c:' || k);
  if not (tile_k in ('suits', 'headgear', 'tops', 'bottoms', 'handsfeet', 'mittens', 'footwear', 'harnesses', 'play', 'chastity', 'equipment', 'accessories') or tile_k = 'c:' || k) then raise exception 'Unknown square'; end if;
  insert into public.catalog_categories (norm, name, tile, zip, created_by) values (k, n, tile_k, coalesce(zp, false), auth.uid())
    on conflict (norm) do update set name = excluded.name, tile = excluded.tile, zip = excluded.zip;
  update public.catalog set category = n, updated_at = now() where public.cat_norm(category) = k and category <> n;
  begin delete from public.category_remaps where from_norm = k; exception when undefined_table then null; end;
  insert into public.catalog_log (actor, action, detail) values (auth.uid(), 'category saved', jsonb_build_object('name', n, 'tile', tile_k, 'zip', coalesce(zp, false)));
  return n;
end $$;
revoke all on function public.cat_official_set(text, text, boolean) from public, anon;
grant execute on function public.cat_official_set(text, text, boolean) to authenticated;

-- Removing keeps people's items; the name just becomes their own category again.
create or replace function public.cat_official_del(nm text) returns void language plpgsql security definer set search_path = public as $$
declare k text := public.cat_norm(nm);
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  delete from public.catalog_tile_covers where tile = 'c:' || k or tile like 'c:' || k || ':%';
  delete from public.catalog_categories where norm = k;
  insert into public.catalog_log (actor, action, detail) values (auth.uid(), 'category removed', jsonb_build_object('name', nm));
end $$;
revoke all on function public.cat_official_del(text) from public, anon;
grant execute on function public.cat_official_del(text) to authenticated;

create or replace function public.catalog_tile_cover_set(t text, u text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  if not (split_part(t, ':', 1) in ('suits', 'headgear', 'tops', 'bottoms', 'handsfeet', 'mittens', 'footwear', 'harnesses', 'play', 'chastity', 'equipment', 'accessories') or (split_part(t, ':', 1) = 'c' and exists (select 1 from public.catalog_categories cc where cc.tile = 'c:' || split_part(t, ':', 2)))) or length(t) > 80 then raise exception 'Unknown category'; end if;
  if coalesce(u, '') = '' then delete from public.catalog_tile_covers where tile = t;
  else
    if u !~ '^https?://' then raise exception 'That isn’t a photo link'; end if;
    insert into public.catalog_tile_covers (tile, url, updated_by) values (t, u, auth.uid()) on conflict (tile) do update set url = excluded.url, updated_by = excluded.updated_by, updated_at = now();
  end if;
  insert into public.catalog_log (actor, action, detail) values (auth.uid(), 'category cover', jsonb_build_object('tile', t, 'cleared', coalesce(u, '') = ''));
end $$;
revoke all on function public.catalog_tile_cover_set(text, text) from public, anon;
grant execute on function public.catalog_tile_cover_set(text, text) to authenticated;
