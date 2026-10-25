-- GearWatch: Mittens becomes a sub-square inside Hands & feet (instead of its own main square).
-- Run once in the Supabase SQL editor. Safe to run again.

create or replace function public.cat_tile(cat text, nm text) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select tile from public.catalog_categories where norm = public.cat_norm(cat)), case
    when lower(coalesce(cat, '')) ~ '(boot|shoe|sneaker|heel|footwear)' then 'footwear'
    when lower(coalesce(cat, '')) ~ '(catsuit|surfsuit|leotard|bodysuit|zentai|suit)' then 'suits'
    when lower(coalesce(cat, '')) ~ '(hood|mask|helmet|head)' then 'headgear'
    when lower(coalesce(cat, '')) ~ '(harness)' then 'harnesses'
    when lower(coalesce(cat, '')) ~ '(glove|mitt|sock|paw|feet|foot)' then 'handsfeet'
    when lower(coalesce(cat, '')) ~ '(chastity)' then 'chastity'
    when lower(coalesce(cat, '')) ~ '(equipment|furniture|bench|sling|frame)' then 'equipment'
    when lower(coalesce(cat, '')) ~ '(bottom|short|brief|underwear|trouser|tight|skirt|legging|pant|jock)' then 'bottoms'
    when lower(coalesce(cat, '')) ~ '(top|jacket|shirt|vest|coat)' then 'tops'
    when lower(coalesce(cat, '')) ~ '(cuff|gag|leash|collar|toy|restraint|plug|tail)' then 'play'
    else 'accessories' end)
$$;

-- Staff categories that sat inside the old Mittens square move into Hands & feet.
update public.catalog_categories set tile = 'handsfeet' where tile = 'mittens';

-- Keep the old Mittens cover photo as the cover of the new Mittens sub-square.
insert into public.catalog_tile_covers (tile, url, updated_by)
  select 'c:mitten', url, updated_by from public.catalog_tile_covers where tile = 'mittens'
  on conflict (tile) do nothing;
delete from public.catalog_tile_covers where tile = 'mittens';
