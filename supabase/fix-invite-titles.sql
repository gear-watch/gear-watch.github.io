-- Gives TOY, Puppy and Drone to BOTH sides of every counted invite. Safe to run again.
create or replace function public.invite_titles(uid uuid) returns void language plpgsql security definer set search_path = public as $$
declare n int; t text; got boolean := false;
begin
  select count(*) into n from public.invites where (inviter = uid or invitee = uid) and counted_at is not null;
  if n >= 1 then
    foreach t in array array['TOY', 'Puppy', 'Drone'] loop if public.give_title(uid, t) then got := true; end if; end loop;
    if got then perform public.title_push(uid, 'TOY, Puppy and Drone'); end if;
  end if;
end $$;

create or replace function public.title_checks(uid uuid) returns void language plpgsql security definer set search_path = public as $$
declare inv uuid;
begin
  if not exists (select 1 from public.user_titles where user_id = uid and title = 'Gearhead') and public.owned_count(uid) >= 25 then
    if public.give_title(uid, 'Gearhead') then perform public.title_push(uid, 'Gearhead'); end if;
  end if;
  select inviter into inv from public.invites where invitee = uid and counted_at is null;
  if inv is not null and exists (select 1 from public.profiles where id = uid and avatar is not null)
     and exists (select 1 from public.user_data u, jsonb_array_elements(u.data->'gw'->'profiles') pr, jsonb_array_elements(pr->'items') it where u.user_id = uid) then
    update public.invites set counted_at = now() where invitee = uid;
    perform public.invite_titles(inv);
    perform public.invite_titles(uid);
  end if;
end $$;

-- Backfill: everyone on either side of a counted invite.
select public.invite_titles(invitee) from public.invites where counted_at is not null;
select public.invite_titles(inviter) from public.invites where counted_at is not null;

-- Check:
select p.username, string_agg(ut.title, ', ' order by ut.title) as invite_titles
from public.invites i
join public.profiles p on p.id in (i.inviter, i.invitee)
left join public.user_titles ut on ut.user_id = p.id and ut.title in ('TOY', 'Puppy', 'Drone')
where i.counted_at is not null
group by p.username order by p.username;
