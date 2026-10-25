-- GearWatch: see who viewed and reacted to @GearWatch stories (Admin → Send story).
-- Run once in the Supabase SQL editor, after stories-notify.sql. Safe to run again.

create or replace function public.official_stories() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'caption', s.caption, 'media', s.media, 'created_at', s.created_at, 'expires_at', s.expires_at,
    'views', (select count(*) from public.story_views v where v.story_id = s.id),
    'reacts', (select count(distinct r.user_id) from public.story_reactions r where r.story_id = s.id)) order by s.created_at desc), '[]'::jsonb)
    from public.stories s join public.profiles p on p.id = s.user_id and p.official where s.created_at > now() - interval '14 days');
end $$;
revoke all on function public.official_stories() from public, anon;
grant execute on function public.official_stories() to authenticated;

-- Everyone who saw one @GearWatch story, newest first, with their reactions (paw, flame = heart, want).
create or replace function public.official_story_viewers(sid uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'Staff only'; end if;
  if not exists (select 1 from public.stories s join public.profiles p on p.id = s.user_id and p.official where s.id = sid) then raise exception 'Not a GearWatch story'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'username', pr.username, 'avatar', pr.avatar, 'seen_at', u.seen_at, 'reacts', u.reacts) order by (cardinality(u.reacts) > 0) desc, u.seen_at desc nulls last), '[]'::jsonb)
    from (select coalesce(v.viewer, r.user_id) id, max(v.seen_at) seen_at, coalesce(array_agg(distinct r.kind) filter (where r.kind is not null), '{}') reacts
          from public.story_views v full join public.story_reactions r on r.story_id = v.story_id and r.user_id = v.viewer
          where coalesce(v.story_id, r.story_id) = sid group by 1) u
    join public.profiles pr on pr.id = u.id);
end $$;
revoke all on function public.official_story_viewers(uuid) from public, anon;
grant execute on function public.official_story_viewers(uuid) to authenticated;
