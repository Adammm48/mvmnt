-- A nudge the recipient can actually see.
--
-- poke_friend() records the poke and queues a push notification — and push is
-- the ONLY place the recipient was ever told. Until the club owns its Apple
-- and Firebase accounts no push is sent, so a nudge was a message into the
-- void: the sender saw "Already nudged", the server logged 'skipped', and the
-- friend saw nothing, anywhere, ever. Found live, two phones side by side.
--
-- This is the gallery-reachable-only-by-notification bug wearing a new shirt
-- (docs/testing.md, layer 2), and the fix is the same shape: the in-app
-- surface must exist FIRST, and the push is a tap on the shoulder pointing at
-- it. my_pokes() is that surface's query: who wants me at which upcoming run.
--
-- Sender names come through a join rather than a client-side profile fetch,
-- because members cannot select each other's profiles directly — the same
-- reason the leaderboard goes through an RPC.

create or replace function public.my_pokes()
returns table (
  run_id     uuid,
  run_title  text,
  from_name  text,
  poked_at   timestamptz
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    p.run_id,
    r.title,
    coalesce(pr.display_name, 'A friend'),
    p.created_at
  from public.pokes p
  join public.runs r on r.id = p.run_id
  left join public.profiles pr on pr.id = p.from_user
  where p.to_user = auth.uid()
    -- Only runs a nudge can still act on. A poke about a finished run is
    -- history, not a prompt, and rendering it would nag about the past.
    and r.status in ('published', 'in_progress')
    and coalesce(r.ends_at, r.starts_at + interval '3 hours') > now()
  order by p.created_at desc
$$;

grant execute on function public.my_pokes() to authenticated;

comment on function public.my_pokes is
  'Nudges waiting for me, on runs that have not finished. The in-app surface '
  'push notifications point at — and the only surface at all until the club '
  'has push credentials.';
