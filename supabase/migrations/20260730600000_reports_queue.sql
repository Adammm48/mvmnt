-- ============================================================================
-- 0056 · The reports queue, readable and actionable
--
-- 0051 built the member's half of content reporting: report_content() writes
-- the row, admin_resolve_report() closes it. What it did not build is the
-- half Apple's guideline 1.2 is actually about — somebody ACTING on reports.
-- A queue nobody reads is a compliance checkbox, not moderation, and the
-- audit's fix is not complete until an organiser can see a report, look at
-- the thing it points to, and deal with it in the same place.
--
-- One RPC returns the queue enriched with what the organiser needs to judge
-- it: who reported, when, and the content itself — the photo's path (the
-- console signs its own URL, as the gallery manager already does) or the
-- gift message's text with both names. Enrichment lives here rather than in
-- three client-side joins because the organiser console's pattern is one
-- RPC per screen, and because the joins cross tables members cannot read.
-- ============================================================================

create or replace function public.admin_reports()
returns table (
  id            uuid,
  kind          text,
  target_id     text,
  reason        text,
  created_at    timestamptz,
  reporter_name text,
  -- Photo reports: where the image lives and which run it belongs to.
  photo_path    text,
  run_title     text,
  -- Gift-message reports: the message and who is involved.
  gift_message  text,
  buyer_name    text,
  recipient_name text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    r.id,
    r.kind,
    r.target_id,
    r.reason,
    r.created_at,
    rep.display_name,
    ph.storage_path,
    ru.title,
    o.gift_message,
    buyer.display_name,
    recip.display_name
  from public.content_reports r
  left join public.profiles rep on rep.id = r.reporter_id
  -- Targets may be gone by the time the queue is read — a photo already
  -- deleted, an order erased. The report still shows, with the content
  -- columns null: "we removed it" and "it no longer exists" both look like
  -- this, and the reason text still says what it was about.
  left join public.run_photos ph
    on r.kind = 'photo' and ph.id::text = r.target_id
  left join public.runs ru on ru.id = ph.run_id
  left join public.orders o
    on r.kind = 'gift_message' and o.id::text = r.target_id
  left join public.profiles buyer on buyer.id = o.buyer_id
  left join public.profiles recip on recip.id = o.recipient_id
  where r.resolved_at is null
  order by r.created_at;
end;
$$;

comment on function public.admin_reports is
  'The open moderation queue, enriched with the reported content so an organiser can judge it in place (migration 0056). Resolved reports leave the queue but keep their rows.';

-- ---------------------------------------------------------------------------
-- Clearing a reported gift message.
--
-- The photo case already has an action (the console deletes the photo and its
-- file). A reported gift message had none: the text sits on the order row,
-- and organisers have no UPDATE on orders. This is the one column of that row
-- an organiser may blank, and only that — the order itself, its money and its
-- state are not moderation surface.
-- ---------------------------------------------------------------------------
create or replace function public.admin_clear_gift_message(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  update public.orders
     set gift_message = null
   where id = p_order_id and gift_message is not null;

  perform app_private.audit('clear_gift_message', 'orders', p_order_id::text, '{}'::jsonb);
end;
$$;

comment on function public.admin_clear_gift_message is
  'Moderation: blanks the free text a member wrote on a gift. The one column of an order an organiser may touch (migration 0056).';

grant execute on function public.admin_reports()                  to authenticated;
grant execute on function public.admin_clear_gift_message(uuid)   to authenticated;
