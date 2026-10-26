-- Run once in Supabase → SQL Editor. Safe to run again.
-- Who invited whom, with usernames. Open it in Table Editor → invites_named (or: select * from public.invites_named;).
-- Only visible to you in the dashboard; the app can't read it.
create or replace view public.invites_named with (security_invoker = true) as
  select a.username as inviter, b.username as invitee,
    case when i.how = 'manual' then 'Picked by hand' else 'Invite link' end as how,
    case when i.counted_at is not null then 'Counts' else 'Waiting for picture + first item' end as status,
    i.created_at as joined_at, i.counted_at
  from public.invites i
  left join public.profiles a on a.id = i.inviter
  left join public.profiles b on b.id = i.invitee
  order by i.created_at desc;
revoke all on public.invites_named from public, anon, authenticated;

select * from public.invites_named;
