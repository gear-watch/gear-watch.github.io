-- Everyone who has TOY, Puppy and Drone because of a counted invite. Run in Supabase → SQL Editor.
-- One row per person, with who they invited / were invited by.
select p.username,
  string_agg(distinct case when i.inviter = p.id then 'invited @' || b.username else 'invited by @' || a.username end, ', ') as because,
  bool_and(ut.title is not null) as has_titles
from public.profiles p
join public.invites i on i.counted_at is not null and (i.inviter = p.id or i.invitee = p.id)
left join public.profiles a on a.id = i.inviter
left join public.profiles b on b.id = i.invitee
left join public.user_titles ut on ut.user_id = p.id and ut.title in ('TOY', 'Puppy', 'Drone')
group by p.username
order by p.username;

-- Also: invites that don't count yet (waiting for a profile picture + first item).
select a.username as inviter, b.username as invitee, i.how, i.created_at
from public.invites i
left join public.profiles a on a.id = i.inviter
left join public.profiles b on b.id = i.invitee
where i.counted_at is null
order by i.created_at desc;
