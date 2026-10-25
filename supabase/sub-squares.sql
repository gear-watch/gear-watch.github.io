-- GearWatch: sub-squares inside main squares (Headgear → Puphood, Drone hood…).
-- Run after categories.sql. Safe to run again.
-- In Admin → Categories, add a category and choose "Inside Headgear" — it becomes a sub-square there.

create or replace function public.catalog_browse(t text, lim int default 60) returns setof public.catalog language sql stable security definer set search_path = public as $$
  select * from public.catalog where (status in ('live', 'gone') or (added_by = auth.uid() and status = 'pending'))
    and (public.cat_tile(category, name) = t or (t like 'c:%' and public.cat_norm(category) = substr(t, 3)))
  order by (status = 'gone'), own_n + want_n desc, created_at desc limit least(greatest(coalesce(lim, 60), 1), 300)
$$;

-- Sub-squares: staff categories placed inside a main square (e.g. Puphood inside Headgear).
create or replace function public.catalog_sub_tiles() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', 'c:' || cc.norm, 'name', cc.name, 'tile', cc.tile, 'n', coalesce(s.n, 0), 'photo', coalesce(cv.url, s.photo), 'auto', s.photo, 'custom', cv.url is not null) order by cc.created_at), '[]'::jsonb)
  from public.catalog_categories cc
  left join lateral (select count(*) n, (array_agg(c.photos[1] order by c.own_n + c.want_n desc) filter (where c.photos[1] is not null))[1] photo
    from public.catalog c where c.status = 'live' and public.cat_norm(c.category) = cc.norm) s on true
  left join public.catalog_tile_covers cv on cv.tile = 'c:' || cc.norm
  where cc.tile not like 'c:%'
$$;
grant execute on function public.catalog_sub_tiles() to authenticated;

create or replace function public.catalog_tile_cover_set(t text, u text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  if not (split_part(t, ':', 1) in ('suits', 'headgear', 'tops', 'bottoms', 'handsfeet', 'mittens', 'footwear', 'harnesses', 'play', 'chastity', 'equipment', 'accessories') or (split_part(t, ':', 1) = 'c' and exists (select 1 from public.catalog_categories cc where cc.norm = split_part(t, ':', 2)))) or length(t) > 80 then raise exception 'Unknown category'; end if;
  if coalesce(u, '') = '' then delete from public.catalog_tile_covers where tile = t;
  else
    if u !~ '^https?://' then raise exception 'That isn’t a photo link'; end if;
    insert into public.catalog_tile_covers (tile, url, updated_by) values (t, u, auth.uid()) on conflict (tile) do update set url = excluded.url, updated_by = excluded.updated_by, updated_at = now();
  end if;
  insert into public.catalog_log (actor, action, detail) values (auth.uid(), 'category cover', jsonb_build_object('tile', t, 'cleared', coalesce(u, '') = ''));
end $$;
revoke all on function public.catalog_tile_cover_set(text, text) from public, anon;
grant execute on function public.catalog_tile_cover_set(text, text) to authenticated;
