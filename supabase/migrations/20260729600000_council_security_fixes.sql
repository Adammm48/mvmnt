-- ============================================================================
-- 0045 · Three holes the end-of-build council found
--
-- All three were verified against the code before this migration was written,
-- and all three are the same species of mistake: a trust boundary that was
-- reasoned about correctly in prose and then not actually enforced.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The geofence was a suggestion, not a control.
--
-- check_in() accepted `p_accuracy_m` from the client and subtracted it from
-- the measured distance:
--
--     if v_distance - coalesce(p_accuracy_m, 0) > v_run.check_in_radius_m
--
-- The allowance is right — ADR 0002 is correct that false negatives, not
-- spoofers, are the failure mode that actually happens, and a member standing
-- in the crowd with a poor fix should not be turned away. But the value was
-- **unbounded client input**. One authenticated request with
-- `p_accuracy_m: 9999999` checks in from anywhere on Earth, and because
-- check_in() creates the attendance row when absent, it is a single call.
-- That chains: attendance → points → tiers → tier_rewards, and points are
-- money in the shop.
--
-- "Generous" and "unbounded" are not the same thing, and the original comment
-- conflated them. The fix keeps the generosity and bounds it.
--
-- WHY 250m
--
-- A phone reporting worse than ~250m accuracy is not doing GPS at all — that
-- is cell-tower triangulation, and it cannot distinguish "at the meeting
-- point" from "two streets away" no matter how honest the number is. So above
-- this, the allowance was never carrying real information.
--
-- The cost of the clamp is a rare genuine member with a terrible fix being
-- refused. That case already has a designed answer that is better than any
-- client-side signal: an organiser checks them in by hand (ADR 0002 §3). The
-- cost of no clamp is that attendance means nothing.
--
-- The RAW claimed accuracy is still recorded in check_in_evidence — the
-- decision uses the clamped value, the evidence keeps what the client said,
-- so an implausible claim stays visible to an organiser rather than being
-- quietly normalised away. Same principle as the client-timestamp handling
-- directly above it.
-- ---------------------------------------------------------------------------
create or replace function public.check_in(
  p_run_id     uuid,
  p_lat        double precision,
  p_lng        double precision,
  p_accuracy_m double precision default null,
  p_client_ts  timestamptz default null
)
returns public.attendance_state
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user       uuid := auth.uid();
  v_run        public.runs;
  v_distance   double precision;
  v_allowed    double precision;
  v_at         timestamptz;
  v_id         uuid;
  v_row        public.run_attendance;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.feature_flags
                 where key = 'geofence_check_in' and enabled) then
    raise exception 'check-in is currently handled by organisers'
      using errcode = 'check_violation';
  end if;

  select * into v_run from public.runs where id = p_run_id;
  if not found then
    raise exception 'run not found' using errcode = 'no_data_found';
  end if;
  if v_run.status not in ('published', 'in_progress') then
    raise exception 'this run is not open for check-in' using errcode = 'check_violation';
  end if;

  -- Trust the device's timestamp only when it is plausible; otherwise treat the
  -- check-in as happening now. A device clock is client input like any other.
  v_at := coalesce(p_client_ts, now());
  if v_at > now() + interval '5 minutes' or v_at < now() - interval '24 hours' then
    v_at := now();
  end if;

  if v_at < v_run.starts_at - interval '1 hour' then
    raise exception 'check-in is not open yet' using errcode = 'check_violation';
  end if;
  if v_at > coalesce(v_run.ends_at, v_run.starts_at + interval '4 hours') then
    raise exception 'check-in has closed for this run' using errcode = 'check_violation';
  end if;

  v_distance := app_private.distance_meters(
    p_lat, p_lng, v_run.meeting_point_lat, v_run.meeting_point_lng
  );

  -- Accept when the member could plausibly be inside the radius given their
  -- own reported GPS accuracy. Comparing raw distance against the radius would
  -- reject people who really are present but have a poor fix — and false
  -- negatives, not spoofers, are the failure mode that actually happens
  -- (ADR 0002). A generous accuracy allowance is a spoofing risk we accept and
  -- record rather than one we try to detect.
  -- Bounded generosity (migration 0045). The allowance still exists so a real
  -- member with a poor fix is not refused; the clamp exists so it cannot be
  -- used as a teleport. greatest(...,0) floors a negative claim, which would
  -- otherwise make the check stricter by accident.
  v_allowed := least(greatest(coalesce(p_accuracy_m, 0), 0), 250);

  if v_distance - v_allowed > v_run.check_in_radius_m then
    raise exception 'you look too far from % to check in (about %m away)',
      v_run.meeting_point_name, round(v_distance)
      using errcode = 'check_violation';
  end if;

  -- Checking in without a prior sign-up is explicitly supported (App Spec §4.1)
  -- and confers a place, so signed_up_at is set either way.
  insert into public.run_attendance (
    run_id, user_id, queued_at, signed_up_at, checked_in_at, check_in_method
  )
  values (p_run_id, v_user, clock_timestamp(), v_at, v_at, 'geofence')
  on conflict (run_id, user_id) do update
    set checked_in_at   = coalesce(public.run_attendance.checked_in_at, v_at),
        check_in_method = coalesce(public.run_attendance.check_in_method, 'geofence'),
        signed_up_at    = coalesce(public.run_attendance.signed_up_at, v_at),
        withdrawn_at    = null
  returning id into v_id;

  insert into public.check_in_evidence (
    attendance_id, run_id, method, reported_lat, reported_lng,
    accuracy_m, distance_m, client_ts
  )
  values (
    v_id, p_run_id, 'geofence', p_lat, p_lng, p_accuracy_m, v_distance, p_client_ts
  )
  on conflict (attendance_id) do nothing;

  insert into public.run_attendance_events (attendance_id, run_id, user_id, event, actor_id)
  values (v_id, p_run_id, v_user, 'checked_in', v_user);

  select * into v_row from public.run_attendance where id = v_id;
  return public.attendance_state(v_row.signed_up_at, v_row.checked_in_at, v_row.withdrawn_at);
end;
$$;

comment on function public.check_in is
  'Geofenced check-in. The client''s reported accuracy widens the radius but is clamped to 250m (migration 0045) — beyond that a fix carries no positional information and the allowance becomes a bypass. Raw claims are still stored as evidence.';


-- ---------------------------------------------------------------------------
-- 2. dev_mark_paid() was callable by any member, for anybody's order.
--
-- It is a stand-in for a payment gateway webhook, and its guard was "refuse
-- if no @mvmnt.test account exists" — a proxy for "this is not production".
-- Two things were wrong with that:
--
--   · the grant was to `authenticated`, so any member could call it;
--   · the body never checked whose order it was.
--
-- The proxy guard is also weaker than it looks: seed.sql and the screenshot
-- script both create @mvmnt.test accounts, so seeding a live project once —
-- for a demo, for README stills — would switch the guard off and hand every
-- member a free-shirt button.
--
-- A stand-in for a *server-to-server webhook* should never have been reachable
-- by a member session in the first place. service_role only; the environment
-- check stays as a second line rather than the only one.
-- ---------------------------------------------------------------------------
revoke execute on function public.dev_mark_paid(uuid) from authenticated;
revoke execute on function public.dev_mark_paid(uuid) from anon, public;
grant  execute on function public.dev_mark_paid(uuid) to service_role;

comment on function public.dev_mark_paid is
  'DEVELOPMENT ONLY, service_role only (migration 0045). Stands in for a payment gateway webhook — a member session must never be able to mark an order paid. Also refuses to run on a database with no seeded test accounts. See docs/costs.md.';


-- ---------------------------------------------------------------------------
-- 3. Points could be spent twice, concurrently.
--
-- place_order() locked the product row before counting stock — correct, and
-- tested — but never locked the *buyer*. Two orders placed at the same moment
-- for two different products take two different product locks, both read the
-- same full points balance, and both spend it. The member ends up with more
-- discount than they had points, and the ledger goes negative.
--
-- This is the same bug shape as overselling stock, in the one place the
-- existing lock could not see: the contended resource is the member, not the
-- product.
--
-- The fix is a lock on the member's own profile row, taken FIRST — before the
-- product lock — so that two concurrent orders by the same member serialise.
-- Lock ordering matters: buyer then product, always, or two members buying
-- two products in opposite orders could deadlock.
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_product_id   uuid,
  p_quantity     integer default 1,
  p_size         text default null,
  p_use_points   integer default 0,
  p_recipient_id uuid default null,
  p_gift_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me        uuid := auth.uid();
  v_product   public.products;
  v_available integer;
  v_points    integer;
  v_spend     integer;
  v_gross     integer;
  v_discount  integer;
  v_order_id  uuid;
  v_message   text;
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_quantity, 0) < 1 then
    raise exception 'choose at least one' using errcode = 'check_violation';
  end if;

  -- The buyer, locked BEFORE the product (migration 0045). Without this, two
  -- concurrent orders for two different products take two different product
  -- locks, both read the same full points balance, and both spend it. The
  -- contended resource here is the member, not the product.
  --
  -- Buyer-then-product, always: a consistent lock order is what stops two
  -- members buying the same two products in opposite orders from deadlocking.
  perform 1 from public.profiles where id = v_me for update;

  select * into v_product from public.products where id = p_product_id for update;

  if not found then
    raise exception 'that item is no longer in the shop' using errcode = 'no_data_found';
  end if;
  if v_product.status <> 'in_stock' then
    raise exception 'that item is not on sale yet' using errcode = 'check_violation';
  end if;

  if v_product.stock is not null then
    v_available := v_product.stock;
    if v_available < p_quantity then
      v_message := case
        when v_available = 0 then 'that item has sold out'
        when v_available = 1 then 'only one left'
        else 'only ' || v_available || ' left'
      end;
      raise exception '%', v_message using errcode = 'check_violation';
    end if;
  end if;

  if array_length(v_product.sizes, 1) is not null then
    if p_size is null or not (p_size = any (v_product.sizes)) then
      raise exception 'choose a size' using errcode = 'check_violation';
    end if;
  end if;

  if p_recipient_id is not null then
    if p_recipient_id = v_me then
      raise exception 'that is you — no gift needed' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from public.friendships
      where user_low = least(v_me, p_recipient_id)
        and user_high = greatest(v_me, p_recipient_id)
    ) then
      raise exception 'you can only gift to someone you have added as a friend'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  v_gross := v_product.price_minor * p_quantity;

  -- Points, capped three ways: what they have, what they asked to spend, and
  -- what this order can actually absorb. The third is the one that was missing.
  v_points := public.points_total(v_me);
  v_spend  := least(greatest(coalesce(p_use_points, 0), 0), v_points);
  -- Rounding up so the club never hands out a part-point of discount free.
  v_spend  := least(v_spend, ceil(v_gross::numeric / 10)::integer);
  v_discount := least(public.points_discount_minor(v_spend), v_gross);

  insert into public.orders (
    buyer_id, product_id, product_name, unit_price_minor, quantity, size,
    points_spent, discount_minor, total_minor, currency,
    is_gift, recipient_id, gift_message
  )
  values (
    v_me, v_product.id, v_product.name, v_product.price_minor, p_quantity, p_size,
    v_spend, v_discount, v_gross - v_discount, v_product.currency,
    p_recipient_id is not null, p_recipient_id, nullif(trim(coalesce(p_gift_message, '')), '')
  )
  returning id into v_order_id;

  if v_product.stock is not null then
    update public.products
       set stock = stock - p_quantity,
           status = case when stock - p_quantity <= 0 then 'retired' else status end
     where id = v_product.id;
  end if;

  if v_spend > 0 then
    insert into public.point_events (user_id, run_id, kind, points, source, note)
    values (v_me, null, 'redemption', -v_spend, 'live', 'order ' || v_order_id::text);
  end if;

  perform app_private.audit('place_order', 'orders', v_order_id::text,
    jsonb_build_object('product', v_product.name, 'total_minor', v_gross - v_discount,
                       'points_spent', v_spend, 'is_gift', p_recipient_id is not null));

  return v_order_id;
end;
$$;

comment on function public.place_order is
  'Reserves stock and redeems points. Locks the BUYER first and then the product (migration 0045) — without the buyer lock, two concurrent orders for different products each read the full balance and spend the same points twice.';
