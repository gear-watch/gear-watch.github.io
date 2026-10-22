-- GearWatch accounts. Paste into Supabase → SQL Editor → New query → Run. Safe to run more than once.

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_.]{3,20}$'),
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to authenticated using (true);
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());

-- Everything in the app (wishlist, collection, outfits, budget, measurements). Only the owner can read it.
create table if not exists public.user_data (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz default now()
);
alter table public.user_data enable row level security;
drop policy if exists "own data" on public.user_data;
create policy "own data" on public.user_data for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Follow requests. The person being followed accepts or declines.
create table if not exists public.follows (
  follower uuid references auth.users on delete cascade,
  followee uuid references auth.users on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
alter table public.follows enable row level security;
drop policy if exists "see own follows" on public.follows;
create policy "see own follows" on public.follows for select to authenticated using (follower = auth.uid() or followee = auth.uid());
drop policy if exists "request follow" on public.follows;
create policy "request follow" on public.follows for insert to authenticated with check (follower = auth.uid() and status = 'pending');
drop policy if exists "answer request" on public.follows;
create policy "answer request" on public.follows for update to authenticated using (followee = auth.uid()) with check (followee = auth.uid());
drop policy if exists "remove follow" on public.follows;
create policy "remove follow" on public.follows for delete to authenticated using (follower = auth.uid() or followee = auth.uid());

-- What followers see: wishlist, collection and outfits only. No prices paid, sizes or measurements.
create table if not exists public.public_lists (
  user_id uuid primary key references auth.users on delete cascade,
  list jsonb not null,
  updated_at timestamptz default now()
);
alter table public.public_lists enable row level security;
drop policy if exists "owner or accepted follower" on public.public_lists;
create policy "owner or accepted follower" on public.public_lists for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.follows f where f.followee = public_lists.user_id and f.follower = auth.uid() and f.status = 'accepted')
);
drop policy if exists "owner writes" on public.public_lists;
create policy "owner writes" on public.public_lists for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Photos you add yourself. Files get random names; anyone with the exact link can view them.
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
-- Photos are private: only you, your friends, and (for profile pictures) other signed-in people can open them.
update storage.buckets set public = false where id = 'photos';
drop policy if exists "read photos" on storage.objects;
create policy "read photos" on storage.objects for select to authenticated using (
  bucket_id = 'photos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or storage.filename(name) like 'avatar-%'
    or exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee::text = (storage.foldername(name))[1] and f.status = 'accepted')
  ));
drop policy if exists "upload own photos" on storage.objects;
create policy "upload own photos" on storage.objects for insert to authenticated with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "delete own photos" on storage.objects;
create policy "delete own photos" on storage.objects for delete to authenticated using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Profile photos friends see. Added later; safe to run again.
alter table public.profiles add column if not exists avatar text;

-- Profile titles like "Early tester". Only you (the owner, from the SQL Editor) can set these; the app can't change them.
alter table public.profiles add column if not exists title text check (title is null or char_length(title) <= 24);
create or replace function public.lock_title() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then new.title := null; else new.title := old.title; end if;
  end if;
  return new;
end $$;
drop trigger if exists lock_title on public.profiles;
create trigger lock_title before insert or update on public.profiles for each row execute function public.lock_title();

-- Friends are two-way. Accepting a request (or adding someone who already asked you) makes both sides friends.
create or replace function public.accept_friend(other uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or other = auth.uid() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.follows where follower = other and followee = auth.uid()) then raise exception 'No request from this person'; end if;
  update public.follows set status = 'accepted' where follower = other and followee = auth.uid();
  insert into public.follows (follower, followee, status) values (auth.uid(), other, 'accepted')
    on conflict (follower, followee) do update set status = 'accepted';
end $$;
revoke all on function public.accept_friend(uuid) from public;
grant execute on function public.accept_friend(uuid) to authenticated;
-- Turn earlier one-way follows into friendships.
insert into public.follows (follower, followee, status)
  select followee, follower, 'accepted' from public.follows where status = 'accepted'
  on conflict (follower, followee) do update set status = 'accepted';

-- ===== Stories =====
-- Photos and videos that disappear after 24 hours, unless pinned as a Highlight.
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  audience text not null default 'all' check (audience in ('all', 'close')),
  blur boolean not null default false,
  caption text check (char_length(caption) <= 300),
  media jsonb not null default '[]',
  items jsonb not null default '[]',
  poll jsonb,
  highlight text check (char_length(highlight) <= 30)
);
create index if not exists stories_user_idx on public.stories (user_id, created_at desc);

-- Close friends: only you can see or change your list.
create table if not exists public.close_friends (
  owner uuid references auth.users on delete cascade,
  friend uuid references auth.users on delete cascade,
  primary key (owner, friend)
);
alter table public.close_friends enable row level security;
drop policy if exists "own close friends" on public.close_friends;
create policy "own close friends" on public.close_friends for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

-- Who may see a story: its owner, or a friend while it's live (or pinned), and only close friends for close-friends stories.
create or replace function public.can_see_story_id(sid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from stories s where s.id = sid and (
    s.user_id = auth.uid() or (
      (s.expires_at > now() or s.highlight is not null)
      and exists (select 1 from follows f where f.follower = auth.uid() and f.followee = s.user_id and f.status = 'accepted')
      and (s.audience = 'all' or exists (select 1 from close_friends c where c.owner = s.user_id and c.friend = auth.uid())))));
$$;
grant execute on function public.can_see_story_id(uuid) to authenticated;
create or replace function public.owns_story(sid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from stories s where s.id = sid and s.user_id = auth.uid());
$$;
grant execute on function public.owns_story(uuid) to authenticated;

alter table public.stories enable row level security;
drop policy if exists "see stories" on public.stories;
create policy "see stories" on public.stories for select to authenticated using (public.can_see_story_id(id));
drop policy if exists "post stories" on public.stories;
create policy "post stories" on public.stories for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "edit own stories" on public.stories;
create policy "edit own stories" on public.stories for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "delete own stories" on public.stories;
create policy "delete own stories" on public.stories for delete to authenticated using (user_id = auth.uid());

create table if not exists public.story_views (
  story_id uuid references public.stories on delete cascade, viewer uuid references auth.users on delete cascade,
  seen_at timestamptz not null default now(), primary key (story_id, viewer));
alter table public.story_views enable row level security;
drop policy if exists "log view" on public.story_views;
create policy "log view" on public.story_views for insert to authenticated with check (viewer = auth.uid() and public.can_see_story_id(story_id));
drop policy if exists "see views" on public.story_views;
create policy "see views" on public.story_views for select to authenticated using (viewer = auth.uid() or public.owns_story(story_id));

create table if not exists public.story_reactions (
  story_id uuid references public.stories on delete cascade, user_id uuid references auth.users on delete cascade,
  kind text not null check (kind in ('paw', 'flame', 'want')), created_at timestamptz not null default now(), primary key (story_id, user_id, kind));
alter table public.story_reactions enable row level security;
drop policy if exists "react" on public.story_reactions;
create policy "react" on public.story_reactions for insert to authenticated with check (user_id = auth.uid() and public.can_see_story_id(story_id));
drop policy if exists "unreact" on public.story_reactions;
create policy "unreact" on public.story_reactions for delete to authenticated using (user_id = auth.uid());
drop policy if exists "see reactions" on public.story_reactions;
create policy "see reactions" on public.story_reactions for select to authenticated using (user_id = auth.uid() or public.owns_story(story_id));

create table if not exists public.story_replies (
  id uuid primary key default gen_random_uuid(), story_id uuid references public.stories on delete cascade,
  from_user uuid references auth.users on delete cascade, body text not null check (char_length(body) between 1 and 500), created_at timestamptz not null default now());
alter table public.story_replies enable row level security;
drop policy if exists "reply" on public.story_replies;
create policy "reply" on public.story_replies for insert to authenticated with check (from_user = auth.uid() and public.can_see_story_id(story_id));
drop policy if exists "see replies" on public.story_replies;
create policy "see replies" on public.story_replies for select to authenticated using (from_user = auth.uid() or public.owns_story(story_id));

create table if not exists public.story_votes (
  story_id uuid references public.stories on delete cascade, user_id uuid references auth.users on delete cascade,
  choice int not null check (choice between 0 and 3), primary key (story_id, user_id));
alter table public.story_votes enable row level security;
drop policy if exists "vote" on public.story_votes;
create policy "vote" on public.story_votes for insert to authenticated with check (user_id = auth.uid() and public.can_see_story_id(story_id));
drop policy if exists "change vote" on public.story_votes;
create policy "change vote" on public.story_votes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "see votes" on public.story_votes;
create policy "see votes" on public.story_votes for select to authenticated using (public.can_see_story_id(story_id));

-- Story files are private: only the owner and friends allowed to see the story can open them.
insert into storage.buckets (id, name, public) values ('stories', 'stories', false) on conflict (id) do nothing;
drop policy if exists "upload own story files" on storage.objects;
create policy "upload own story files" on storage.objects for insert to authenticated with check (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "delete own story files" on storage.objects;
create policy "delete own story files" on storage.objects for delete to authenticated using (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "read allowed story files" on storage.objects;
create policy "read allowed story files" on storage.objects for select to authenticated using (
  bucket_id = 'stories' and ((storage.foldername(name))[1] = auth.uid()::text or public.can_see_story_id(((storage.foldername(name))[2])::uuid)));


-- Friends of friends: see a friend's friend list, and suggestions from 2+ mutual friends.
create or replace function public.my_friend_ids(who uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select case when follower = who then followee else follower end from public.follows
  where status = 'accepted' and (follower = who or followee = who)
$$;
revoke all on function public.my_friend_ids(uuid) from public, anon, authenticated;

create or replace function public.friends_of(target uuid)
returns table (id uuid, username text, avatar text)
language sql stable security definer set search_path = public as $$
  select distinct p.id, p.username, p.avatar from public.profiles p
  where p.id in (select public.my_friend_ids(target)) and p.id <> auth.uid()
    and (target = auth.uid() or target in (select public.my_friend_ids(auth.uid())))
  order by p.username
$$;
grant execute on function public.friends_of(uuid) to authenticated;

create or replace function public.friend_suggestions()
returns table (id uuid, username text, avatar text, mutuals int, via text[])
language sql stable security definer set search_path = public as $$
  with mine as (select public.my_friend_ids(auth.uid()) as uid),
  fof as (select f.uid as via, public.my_friend_ids(f.uid) as cand from mine f)
  select p.id, p.username, p.avatar, count(distinct fof.via)::int, (array_agg(distinct vp.username))[1:3]
  from fof join public.profiles p on p.id = fof.cand join public.profiles vp on vp.id = fof.via
  where fof.cand <> auth.uid() and fof.cand not in (select uid from mine)
    and not exists (select 1 from public.follows x where (x.follower = auth.uid() and x.followee = fof.cand) or (x.followee = auth.uid() and x.follower = fof.cand))
  group by p.id, p.username, p.avatar
  having count(distinct fof.via) >= 2
  order by 4 desc, p.username
  limit 12
$$;
grant execute on function public.friend_suggestions() to authenticated;


-- Short share links: a small public record per shared item or outfit.
create table if not exists public.shares (
  id text primary key check (id ~ '^[A-Za-z0-9]{5,12}$'),
  data jsonb not null,
  owner uuid references auth.users on delete cascade default auth.uid(),
  created_at timestamptz default now()
);
alter table public.shares enable row level security;
drop policy if exists "anyone reads shares" on public.shares;
create policy "anyone reads shares" on public.shares for select to anon, authenticated using (true);
drop policy if exists "signed in creates shares" on public.shares;
create policy "signed in creates shares" on public.shares for insert to authenticated with check (owner = auth.uid());


-- Delete my account. The app removes your photos first, then this removes everything else (every table cascades).
create or replace function public.delete_my_account() returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
