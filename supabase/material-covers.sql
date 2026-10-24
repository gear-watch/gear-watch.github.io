-- GearWatch: material squares inside a catalog category (e.g. Headgear → Latex, Leather, Silicone).
-- Run after catalog.sql. Safe to run again.
-- Material covers reuse catalog_tile_covers with keys like 'headgear:Latex'.

create or replace function public.catalog_tile_mats() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('tile', s.t, 'mat', s.m, 'n', s.n, 'photo', coalesce(cv.url, s.photo), 'auto', s.photo, 'custom', cv.url is not null) order by s.t, s.n desc), '[]'::jsonb) from (
    select public.cat_tile(c.category, c.name) t, m, count(*) n, (array_agg(c.photos[1] order by c.own_n + c.want_n desc) filter (where c.photos[1] is not null))[1] photo
    from public.catalog c, unnest(c.materials) m where c.status = 'live' and btrim(m) <> '' group by 1, 2) s
  left join public.catalog_tile_covers cv on cv.tile = s.t || ':' || s.m
$$;
revoke all on function public.catalog_tile_mats() from public, anon;
grant execute on function public.catalog_tile_mats() to authenticated;

-- Same as before, but also accepts 'tile:Material' keys.
create or replace function public.catalog_tile_cover_set(t text, u text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  if split_part(t, ':', 1) not in ('suits', 'headgear', 'tops', 'bottoms', 'handsfeet', 'footwear', 'harnesses', 'play', 'accessories') or length(t) > 80 then raise exception 'Unknown category'; end if;
  if coalesce(u, '') = '' then delete from public.catalog_tile_covers where tile = t;
  else
    if u !~ '^https?://' then raise exception 'That isn’t a photo link'; end if;
    insert into public.catalog_tile_covers (tile, url, updated_by) values (t, u, auth.uid()) on conflict (tile) do update set url = excluded.url, updated_by = excluded.updated_by, updated_at = now();
  end if;
  insert into public.catalog_log (actor, action, detail) values (auth.uid(), 'category cover', jsonb_build_object('tile', t, 'cleared', coalesce(u, '') = ''));
end $$;
revoke all on function public.catalog_tile_cover_set(text, text) from public, anon;
grant execute on function public.catalog_tile_cover_set(text, text) to authenticated;
