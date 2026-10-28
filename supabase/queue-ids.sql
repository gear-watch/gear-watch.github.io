-- Light queue check for the admin badge: only ids, instead of the full queue.
create or replace function public.catalog_queue_ids() returns text[] language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  return array(
    select c.id::text from public.catalog c where c.status in ('pending', 'hidden')
    union all
    select f.id::text from public.catalog_flags f join public.catalog c on c.id = f.catalog_id where f.status = 'open');
end $$;
revoke all on function public.catalog_queue_ids() from public, anon;
grant execute on function public.catalog_queue_ids() to authenticated;
