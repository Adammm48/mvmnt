-- ============================================================================
-- 0036 · Erasure has to reach what people wrote
--
-- A gap Phase 3 opened without anybody noticing.
--
-- `orders.buyer_id` and `orders.recipient_id` are ON DELETE SET NULL, so erasing
-- a member anonymises the order exactly as it anonymises attendance. That is
-- right for the fact of a purchase — the club's own sales history should survive
-- and it identifies nobody once the ids are gone.
--
-- But two columns on that row are **free text a person wrote**, and they survive
-- untouched:
--
--   · `gift_message` — a private note from one member to another
--   · `delivery_note` — "leave it at 14 Zamalek Street, ask for Ahmed"
--
-- An anonymised order carrying a home address is not anonymous, and it is
-- exactly the sort of thing an Article 17 request is about. The person is gone
-- from the row and their address is still sitting in it.
--
-- WHY A FUNCTION CHANGE RATHER THAN A CONSTRAINT
--
-- There is no foreign-key action that means "null this unrelated column when
-- that one is nulled". This has to be an explicit step in erase_member(), which
-- is also the honest place for it: erasure is a deliberate act with a list, and
-- the list should be readable.
--
-- The same reasoning applies to anything free-text added later. The rule is:
-- **anonymising an id is not enough if the row also holds something the member
-- typed.**
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A worse bug, found while fixing the one above.
--
-- `gift_has_recipient` says: `not is_gift or recipient_id is not null`.
-- Reasonable on its face — a gift needs somebody to be for.
--
-- But `recipient_id` is ON DELETE SET NULL, so erasing a member who has ever
-- **received** a gift nulls that column while `is_gift` stays true, the check
-- fails, and the whole erasure aborts. A member who was ever sent a shirt could
-- not delete their account at all. That is a hard Article 17 failure, and it
-- would have surfaced as a baffling constraint error in front of somebody
-- trying to exercise a legal right.
--
-- This is the same shape as the Phase 1 conflict between append-only attendance
-- history and the right to erasure (ADR 0002 §6): an integrity rule written for
-- the normal case, which forbids the anonymised state that erasure must be able
-- to produce. Erasure wins, every time.
--
-- The rule is not lost — place_order() raises if a gift has no recipient, which
-- is the only moment the question is meaningful. After erasure the row is
-- simply true in a different way: it was a gift, to somebody who no longer
-- exists.
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint if exists gift_has_recipient;

comment on column public.orders.recipient_id is
  'Null on a gift means the recipient has erased their account. Enforced at creation by place_order(), not by a check constraint — a constraint here forbids the anonymised state erasure has to produce. See migration 0036.';

create or replace function public.erase_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() and auth.uid() is distinct from p_user_id then
    raise exception 'you may only erase your own account'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.check_in_evidence
   where attendance_id in (
     select id from public.run_attendance where user_id = p_user_id
   );

  delete from public.push_tokens where user_id = p_user_id;

  delete from public.notification_deliveries where user_id = p_user_id;

  -- Free text this member wrote, on rows that survive as anonymised history.
  -- Cleared here rather than left to the foreign key, because SET NULL only
  -- reaches the id — a delivery note with a street address would otherwise sit
  -- in an "anonymous" row indefinitely.
  update public.orders
     set delivery_note = null
   where recipient_id = p_user_id and delivery_note is not null;

  update public.orders
     set gift_message = null
   where (buyer_id = p_user_id or recipient_id = p_user_id)
     and gift_message is not null;

  -- The size on a gift is the recipient's own body measurement, which is
  -- personal in a way "a shirt was sold" is not.
  update public.orders
     set size = null
   where recipient_id = p_user_id and size is not null;

  -- Audit BEFORE the auth.users delete cascades actor references away.
  perform app_private.audit('erase_member', 'profiles', p_user_id::text,
                            jsonb_build_object('erased_at', now()));

  -- Cascades to profiles; profiles' ON DELETE SET NULL then anonymises the
  -- attendance, order and event rows rather than removing them. Sponsor
  -- impressions and shop waitlist entries cascade away entirely — neither is
  -- history the club needs once the person is gone.
  delete from auth.users where id = p_user_id;
end;
$$;

comment on function public.erase_member is
  'GDPR Art. 17 erasure. Destroys personal data — including free text the member wrote on orders — and leaves anonymised attendance and sales history so past totals stay correct (ADR 0002 §6, migration 0036).';
