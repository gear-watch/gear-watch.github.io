-- GearWatch: sub-squares inside main squares (Headgear → Puphood, Drone hood…).
-- Run after categories.sql. Safe to run again.
-- In Admin → Categories, add a category and choose "Inside Headgear" — it becomes a sub-square there.

create or replace function public.catalog_browse(t text, lim int default 60) returns setof public.catalog language sql stable security definer set search_path = public as $$
  select * from public.catalog where (status in ('live', 'gone') or (added_by = auth.uid() and status = 'pending'))
    and (public.cat_tile(category, name) = t or (t like 'c:%' and public.cat_norm(category) = substr(t, 3)))
  order by (status = 'gone'), own_n + want_n desc, created_at desc limit least(greatest(coalesce(lim, 60), 1), 300)
$$;

-- Sub-squares: every type inside a main square (built-in like Hood or Cuffs, plus staff ones like Gasmask).
create or replace function public.catalog_sub_tiles() returns jsonb language sql stable security definer set search_path = public as $$
  with k as (
    select cc.norm, cc.name, cc.tile, false builtin from public.catalog_categories cc where cc.tile not like 'c:%'
    union all
    select public.cat_norm(b), b, public.cat_tile(b, ''), true from unnest(array['Catsuit', 'Surfsuit', 'Leotard', 'Top', 'Jacket', 'Bottoms', 'Hood', 'Harness', 'Shorts', 'Underwear', 'Trousers', 'Tights', 'Skirt', 'Gloves', 'Mittens', 'Socks', 'Boots', 'Shoes', 'Cuffs', 'Gags', 'Chastity', 'Leashes', 'Collars', 'Toys', 'Equipment', 'Accessory']::text[]) b
      where not exists (select 1 from public.catalog_categories cc where cc.norm = public.cat_norm(b))
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', 'c:' || k.norm, 'name', k.name, 'tile', k.tile, 'builtin', k.builtin, 'n', coalesce(s.n, 0), 'photo', coalesce(cv.url, s.photo), 'auto', s.photo, 'custom', cv.url is not null) order by k.builtin, k.name), '[]'::jsonb)
  from k
  left join lateral (select count(*) n, (array_agg(c.photos[1] order by c.own_n + c.want_n desc) filter (where c.photos[1] is not null))[1] photo
    from public.catalog c where c.status = 'live' and public.cat_norm(c.category) = k.norm) s on true
  left join public.catalog_tile_covers cv on cv.tile = 'c:' || k.norm
$$;
grant execute on function public.catalog_sub_tiles() to authenticated;

create or replace function public.catalog_tile_cover_set(t text, u text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  if not (split_part(t, ':', 1) in ('suits', 'headgear', 'tops', 'bottoms', 'handsfeet', 'mittens', 'footwear', 'harnesses', 'play', 'chastity', 'equipment', 'accessories') or (split_part(t, ':', 1) = 'c' and (split_part(t, ':', 2) = any(array['catsuit', 'surfsuit', 'leotard', 'top', 'jacket', 'bottom', 'hood', 'harnes', 'short', 'underwear', 'trouser', 'tight', 'skirt', 'glove', 'mitten', 'sock', 'boot', 'shoe', 'cuff', 'gag', 'chastity', 'leashe', 'collar', 'toy', 'equipment', 'accessory']::text[]) or exists (select 1 from public.catalog_categories cc where cc.norm = split_part(t, ':', 2))))) or length(t) > 80 then raise exception 'Unknown category'; end if;
  if coalesce(u, '') = '' then delete from public.catalog_tile_covers where tile = t;
  else
    if u !~ '^https?://' then raise exception 'That isn’t a photo link'; end if;
    insert into public.catalog_tile_covers (tile, url, updated_by) values (t, u, auth.uid()) on conflict (tile) do update set url = excluded.url, updated_by = excluded.updated_by, updated_at = now();
  end if;
  insert into public.catalog_log (actor, action, detail) values (auth.uid(), 'category cover', jsonb_build_object('tile', t, 'cleared', coalesce(u, '') = ''));
end $$;
revoke all on function public.catalog_tile_cover_set(text, text) from public, anon;
grant execute on function public.catalog_tile_cover_set(text, text) to authenticated;
