-- Admin → Browse → "Refresh all prices" reads this list. Run once in Supabase → SQL editor.
create or replace function public.catalog_price_targets() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'url', url, 'name', name, 'price', price, 'was_price', was_price, 'currency', currency) order by updated_at), '[]'::jsonb)
    from public.catalog where status in ('live', 'gone', 'pending') and url ~ '^https?://');
end $$;
grant execute on function public.catalog_price_targets() to authenticated;
grant execute on function public.is_admin() to authenticated;
