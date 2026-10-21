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
insert into storage.buckets (id, name, public) values ('photos', 'photos', true) on conflict (id) do nothing;
drop policy if exists "upload own photos" on storage.objects;
create policy "upload own photos" on storage.objects for insert to authenticated with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "delete own photos" on storage.objects;
create policy "delete own photos" on storage.objects for delete to authenticated using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Profile photos friends see. Added later; safe to run again.
alter table public.profiles add column if not exists avatar text;

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
