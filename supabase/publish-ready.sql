-- Lets everyone who is signed in read the saved size sets (e.g. "Kinkfox catsuit"),
-- so the "Add to the catalog" form can offer them. Editing them stays staff-only.
-- Supabase → SQL Editor → New query → paste → Run. Safe to run more than once.
create or replace function public.catalog_size_sets() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sizes', sizes, 'm2m', m2m) order by lower(name)), '[]'::jsonb) from public.catalog_size_sets);
end $$;
revoke all on function public.catalog_size_sets() from public, anon;
grant execute on function public.catalog_size_sets() to authenticated;
