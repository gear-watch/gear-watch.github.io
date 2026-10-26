-- GearWatch titles you can unlock, and invite tracking.
-- Run once in Supabase → SQL Editor, after setup.sql. Safe to run again.
--
-- Titles:
--   TOY, Puppy, Drone: 3 friends joined through you (a friend counts once they have a profile picture and an item)
--   Gearhead: 25 or more owned items (ordered items don't count)
--   Early bird and titles you set by hand keep working and stay pickable.
-- People pick their title in the app (tap the title on your own profile). The app can only pick titles they have.
--
-- Handy queries:
--   Who invited whom:
--     select a.username as inviter, b.username as invitee, i.how, i.created_at, i.counted_at from public.invites i
--       join public.profiles a on a.id = i.inviter join public.profiles b on b.id = i.invitee order by i.created_at desc;
--   Give someone a title by hand:
--     insert into public.user_titles (user_id, title) select id, 'Tester' from public.profiles where username = 'name';
--   Remove a fake invite:
--     delete from public.invites where invitee = (select id from public.profiles where username = 'name');

create table if not exists public.user_titles (
  user_id uuid references auth.users on delete cascade,
  title text not null check (char_length(title) between 1 and 24),
  granted_at timestamptz not null default now(),
  primary key (user_id, title));
alter table public.user_titles enable row level security;
drop policy if exists "see own titles" on public.user_titles;
create policy "see own titles" on public.user_titles for select to authenticated using (user_id = auth.uid());

create table if not exists public.invites (
  invitee uuid primary key references auth.users on delete cascade,
  inviter uuid not null references auth.users on delete cascade,
  how text not null default 'link' check (how in ('link', 'manual')),
  created_at timestamptz not null default now(),
  counted_at timestamptz,
  check (invitee <> inviter));
create index if not exists invites_inviter on public.invites (inviter);
alter table public.invites enable row level security;
drop policy if exists "see own invites" on public.invites;
create policy "see own invites" on public.invites for select to authenticated using (inviter = auth.uid() or invitee = auth.uid());

-- Any title put on a profile (Early bird, ones set by hand) is also kept in the list, so it stays pickable.
create or replace function public.keep_title_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.title is not null then insert into public.user_titles (user_id, title) values (new.id, new.title) on conflict do nothing; end if;
  return null;
end $$;
drop trigger if exists keep_title on public.profiles;
create trigger keep_title after insert or update of title on public.profiles for each row execute function public.keep_title_trg();
insert into public.user_titles (user_id, title) select id, title from public.profiles where title is not null on conflict do nothing;

-- Early bird: same rule as before, but only once. Picking "No title" no longer brings it back.
create or replace function public.grant_early_bird(uid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.user_titles where user_id = uid and title = 'Early bird')
     and exists (select 1 from public.profiles p where p.id = uid and p.title is null and p.avatar is not null)
     and exists (select 1 from public.user_data u, jsonb_array_elements(u.data->'gw'->'profiles') pr, jsonb_array_elements(pr->'items') it where u.user_id = uid) then
    perform set_config('gw.grant', '1', true);
    update public.profiles set title = 'Early bird' where id = uid and title is null;
    perform set_config('gw.grant', '', true);
  end if;
end $$;
revoke all on function public.grant_early_bird(uuid) from public, anon, authenticated;

create or replace function public.give_title(uid uuid, t text) returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.user_titles (user_id, title) values (uid, t) on conflict do nothing;
  get diagnostics n = row_count; return n > 0;
end $$;

create or replace function public.title_push(uid uuid, what text) returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('gw.quiet', true), '') = '1' then return; end if;
  begin perform public.push_send(uid, 'friends', 'New title unlocked', what || ' is yours. Tap the title on your profile to show it.', null);
  exception when others then null; end;
end $$;

create or replace function public.owned_count(uid uuid) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.user_data u, jsonb_array_elements(u.data->'gw'->'profiles') pr, jsonb_array_elements(pr->'items') it
  where u.user_id = uid and it->>'status' = 'owned'
$$;

create or replace function public.invite_titles(uid uuid) returns void language plpgsql security definer set search_path = public as $$
declare n int; t text; got boolean := false;
begin
  select count(*) into n from public.invites where inviter = uid and counted_at is not null;
  if n >= 3 then
    foreach t in array array['TOY', 'Puppy', 'Drone'] loop if public.give_title(uid, t) then got := true; end if; end loop;
    if got then perform public.title_push(uid, 'TOY, Puppy and Drone'); end if;
  end if;
end $$;

-- Runs whenever someone's data or profile picture changes.
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
  end if;
end $$;

create or replace function public.titles_data_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.title_checks(new.user_id); return null; end $$;
drop trigger if exists titles_data on public.user_data;
create trigger titles_data after insert or update on public.user_data for each row execute function public.titles_data_trg();
create or replace function public.titles_avatar_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.title_checks(new.id); return null; end $$;
drop trigger if exists titles_avatar on public.profiles;
create trigger titles_avatar after update of avatar on public.profiles for each row execute function public.titles_avatar_trg();

-- The app calls this once after sign-up: ref is the inviter's username or id (from the invite link, or picked by hand).
-- Only in your first 7 days, only once, never yourself. You become friends straight away.
create or replace function public.claim_invite(ref text, manual boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); inv uuid; made timestamptz; r text := trim(coalesce(ref, ''));
begin
  if me is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.invites where invitee = me) then return jsonb_build_object('ok', false, 'why', 'already'); end if;
  select created_at into made from auth.users where id = me;
  if made is null or made < now() - interval '7 days' then return jsonb_build_object('ok', false, 'why', 'old'); end if;
  if r ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then select id into inv from public.profiles where id = r::uuid;
  else select id into inv from public.profiles where username = lower(regexp_replace(r, '^@', '')); end if;
  if inv is null or inv = me then return jsonb_build_object('ok', false, 'why', 'nobody'); end if;
  insert into public.invites (invitee, inviter, how) values (me, inv, case when manual then 'manual' else 'link' end) on conflict do nothing;
  insert into public.follows (follower, followee, status) values (me, inv, 'accepted'), (inv, me, 'accepted')
    on conflict (follower, followee) do update set status = 'accepted';
  perform public.title_checks(me);
  return jsonb_build_object('ok', true, 'inviter', (select username from public.profiles where id = inv));
end $$;

create or replace function public.set_title(t text) returns void language plpgsql security definer set search_path = public as $$
declare v text := nullif(trim(coalesce(t, '')), '');
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if v is not null and not exists (select 1 from public.user_titles where user_id = auth.uid() and title = v) then raise exception 'You haven’t unlocked that title yet'; end if;
  perform set_config('gw.grant', '1', true);
  update public.profiles set title = v where id = auth.uid();
  perform set_config('gw.grant', '', true);
end $$;

create or replace function public.title_status() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'titles', coalesce((select jsonb_agg(jsonb_build_object('t', title, 'at', granted_at) order by granted_at) from public.user_titles where user_id = auth.uid()), '[]'::jsonb),
    'current', (select title from public.profiles where id = auth.uid()),
    'joined', (select count(*) from public.invites where inviter = auth.uid()),
    'counted', (select count(*) from public.invites where inviter = auth.uid() and counted_at is not null),
    'invitedBy', (select p.username from public.invites i join public.profiles p on p.id = i.inviter where i.invitee = auth.uid()),
    'canClaim', coalesce((select u.created_at > now() - interval '7 days' from auth.users u where u.id = auth.uid()), false)
                and not exists (select 1 from public.invites where invitee = auth.uid()))
$$;

revoke all on function public.give_title(uuid, text) from public, anon, authenticated;
revoke all on function public.title_push(uuid, text) from public, anon, authenticated;
revoke all on function public.owned_count(uuid) from public, anon, authenticated;
revoke all on function public.invite_titles(uuid) from public, anon, authenticated;
revoke all on function public.title_checks(uuid) from public, anon, authenticated;
revoke all on function public.claim_invite(text, boolean) from public, anon;
revoke all on function public.set_title(text) from public, anon;
revoke all on function public.title_status() from public, anon;
grant execute on function public.claim_invite(text, boolean) to authenticated;
grant execute on function public.set_title(text) to authenticated;
grant execute on function public.title_status() to authenticated;

-- Friends lists show titles too.
drop function if exists public.friends_of(uuid);
create function public.friends_of(target uuid)
returns table (id uuid, username text, avatar text, title text)
language sql stable security definer set search_path = public as $$
  select distinct p.id, p.username, p.avatar, p.title from public.profiles p
  where p.id in (select public.my_friend_ids(target)) and p.id <> auth.uid()
    and (target = auth.uid() or target in (select public.my_friend_ids(auth.uid())))
  order by p.username
$$;
grant execute on function public.friends_of(uuid) to authenticated;

-- Catch everyone who already qualifies (no push notifications for this first run).
do $$ declare r record; begin perform set_config('gw.quiet', '1', true); for r in select user_id from public.user_data loop perform public.title_checks(r.user_id); end loop; perform set_config('gw.quiet', '', true); end $$;
