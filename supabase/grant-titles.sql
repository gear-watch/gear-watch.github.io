-- Give @buckie and @custard every title. Run in Supabase → SQL Editor, after titles.sql.
insert into public.user_titles (user_id, title)
select p.id, t.title
from public.profiles p
cross join (values ('Early bird'), ('Gearhead'), ('TOY'), ('Puppy'), ('Drone')) as t(title)
where p.username in ('buckie', 'custard')
on conflict do nothing;

-- Keep whatever title they have on their profile now (like custard's Pizza puppy) pickable.
insert into public.user_titles (user_id, title)
select id, title from public.profiles where username in ('buckie', 'custard') and title is not null
on conflict do nothing;

-- Check:
select p.username, u.title, u.granted_at from public.user_titles u join public.profiles p on p.id = u.user_id
where p.username in ('buckie', 'custard') order by p.username, u.granted_at;
