-- GearWatch: Mittens, Chastity and Equipment category squares.
-- Run after catalog.sql and material-covers.sql. Safe to run again.
-- Items move into the new squares automatically based on their type (e.g. type "Mittens").

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

-- Accepts the new tiles (and 'tile:Material' keys).
create or replace function public.catalog_tile_cover_set(t text, u text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  if split_part(t, ':', 1) not in ('suits', 'headgear', 'tops', 'bottoms', 'handsfeet', 'mittens', 'footwear', 'harnesses', 'play', 'chastity', 'equipment', 'accessories') or length(t) > 80 then raise exception 'Unknown category'; end if;
  if coalesce(u, '') = '' then delete from public.catalog_tile_covers where tile = t;
  else
    if u !~ '^https?://' then raise exception 'That isn’t a photo link'; end if;
    insert into public.catalog_tile_covers (tile, url, updated_by) values (t, u, auth.uid()) on conflict (tile) do update set url = excluded.url, updated_by = excluded.updated_by, updated_at = now();
  end if;
  insert into public.catalog_log (actor, action, detail) values (auth.uid(), 'category cover', jsonb_build_object('tile', t, 'cleared', coalesce(u, '') = ''));
end $$;
revoke all on function public.catalog_tile_cover_set(text, text) from public, anon;
grant execute on function public.catalog_tile_cover_set(text, text) to authenticated;
