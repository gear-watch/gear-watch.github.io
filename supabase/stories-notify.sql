-- GearWatch: story notifications + official @GearWatch stories.
-- Run after setup.sql and catalog.sql. Safe to run again.
--
-- One-time: sign up a normal account for GearWatch in the app (username e.g. GearWatch, with the app icon as picture),
-- then run:  update public.profiles set official = true where lower(username) = 'gearwatch';

alter table public.profiles add column if not exists official boolean not null default false;

-- Official stories are visible to everyone signed in, not only friends.
create or replace function public.can_see_story_id(sid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from stories s where s.id = sid and (
    s.user_id = auth.uid() or (
      (s.expires_at > now() or s.highlight is not null)
      and (
        exists (select 1 from profiles p where p.id = s.user_id and p.official)
        or (exists (select 1 from follows f where f.follower = auth.uid() and f.followee = s.user_id and f.status = 'accepted')
          and (s.audience = 'all' or exists (select 1 from close_friends c where c.owner = s.user_id and c.friend = auth.uid())))))));
$$;
grant execute on function public.can_see_story_id(uuid) to authenticated;

-- Friends get a phone notification when you post a story. A burst of posts within 3 hours sends one.
-- Close-friends stories only notify close friends.
create or replace function public.push_story_trg() returns trigger language plpgsql security definer set search_path = public as $$
declare u text; off boolean; f uuid;
begin
  select username, coalesce(official, false) into u, off from public.profiles where id = new.user_id;
  if off then return null; end if;
  if exists (select 1 from public.stories s where s.user_id = new.user_id and s.id <> new.id and s.created_at > now() - interval '3 hours') then return null; end if;
  for f in select follower from public.follows where followee = new.user_id and status = 'accepted' loop
    if new.audience = 'close' and not exists (select 1 from public.close_friends c where c.owner = new.user_id and c.friend = f) then continue; end if;
    perform public.push_send(f, 'stories', '@' || coalesce(u, 'someone'), 'posted a new story', '#home');
  end loop;
  return null;
end $$;
drop trigger if exists push_story on public.stories;
create trigger push_story after insert on public.stories for each row execute function public.push_story_trg();

-- Staff post a story as @GearWatch to everyone. Photos only, uploaded to the public catalog bucket first.
create or replace function public.official_story_post(media jsonb, caption text, notify boolean default true) returns int language plpgsql security definer set search_path = public as $$
declare oid uuid; sid uuid := gen_random_uuid(); clean jsonb; n int := 0; t uuid; cap text := nullif(left(btrim(coalesce(caption, '')), 300), '');
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  select id into oid from public.profiles where official order by id limit 1;
  if oid is null then raise exception 'There’s no GearWatch account yet. See the top of stories-notify.sql.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('pub', m->>'pub', 'type', 'image', 'w', nullif(m->>'w', '')::int, 'h', nullif(m->>'h', '')::int, 'tags', '[]'::jsonb)), '[]'::jsonb) into clean
    from jsonb_array_elements(case when jsonb_typeof(media) = 'array' then media else '[]'::jsonb end) m
    where m->>'pub' like '%/storage/v1/object/public/catalog/%';
  if jsonb_array_length(clean) = 0 then raise exception 'Add a photo'; end if;
  insert into public.stories (id, user_id, audience, blur, caption, media) values (sid, oid, 'all', false, cap, clean);
  if notify then
    for t in select distinct user_id from public.push_subs where 'stories' = any(kinds) and user_id <> oid loop
      perform public.push_send(t, 'stories', 'GearWatch', coalesce(left(cap, 120), 'posted a new story'), '#home'); n := n + 1;
    end loop;
  end if;
  insert into public.catalog_log (actor, action, detail) values (auth.uid(), 'official story', jsonb_build_object('notified', n));
  return n;
end $$;
revoke all on function public.official_story_post(jsonb, text, boolean) from public, anon;
grant execute on function public.official_story_post(jsonb, text, boolean) to authenticated;

-- Staff can take an official story down again.
create or replace function public.official_story_delete(sid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  delete from public.stories s where s.id = sid and exists (select 1 from public.profiles p where p.id = s.user_id and p.official);
end $$;
revoke all on function public.official_story_delete(uuid) from public, anon;
grant execute on function public.official_story_delete(uuid) to authenticated;

create or replace function public.official_stories() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'caption', s.caption, 'media', s.media, 'created_at', s.created_at, 'expires_at', s.expires_at,
    'views', (select count(*) from public.story_views v where v.story_id = s.id)) order by s.created_at desc), '[]'::jsonb)
    from public.stories s join public.profiles p on p.id = s.user_id and p.official where s.created_at > now() - interval '14 days');
end $$;
revoke all on function public.official_stories() from public, anon;
grant execute on function public.official_stories() to authenticated;
