-- ============================================================================
-- 0035 · Make a point worth enough to be worth having
--
-- The first version set one point to one piastre because it was the roundest
-- possible rule. Putting it on screen showed what that actually means: 400
-- points — half a year of not missing a Saturday — took **EGP 4** off a
-- 450-pound shirt. Under one percent. A discount that small is worse than none,
-- because it tells a member exactly what the club thinks their year is worth.
--
-- ONE POINT = 10 PIASTRES
--
-- Calibrated against the ladder rather than picked. Checking in earns 10 points
-- plus up to 10 more for a streak, so a run is worth roughly EGP 1–2 back:
--
--   a month of running      ~80 points    ~EGP 8
--   Legend (six months)     480 points    ~EGP 48   — a tenth off a shirt
--   a full year             ~950 points   ~EGP 95   — a fifth off
--
-- Enough to notice, not enough to replace paying. It also stays deliberately
-- below the tier rewards, which already promise a free shirt at Competitor
-- (migration 0026): points and tiers are two channels to the same members, and
-- if points alone bought the shirt the tier reward would mean nothing.
--
-- STILL THE OWNER'S CALL
--
-- This is a pricing decision dressed as a constant, and the club may want it
-- higher or lower once real merch prices exist. It is one number, in one
-- function, mirrored in one line of TypeScript that a comment ties back here —
-- and docs/open-items.md tracks it as a decision to confirm rather than a
-- default to forget.
-- ============================================================================

create or replace function public.points_discount_minor(p_points integer)
returns integer
language sql
immutable
parallel safe
as $$
  -- 10 piastres a point. Integer arithmetic throughout: money never touches a
  -- float in this schema.
  select greatest(coalesce(p_points, 0), 0) * 10;
$$;

comment on function public.points_discount_minor is
  'One point is 10 piastres (EGP 0.10). Calibrated so six months of perfect attendance is about a tenth off a shirt — noticeable, but below the tier rewards, which already give one outright. See migration 0035; the rate is the club''s to change.';

-- ---------------------------------------------------------------------------
-- And the bug that changing the rate exposed.
--
-- place_order() ended with:
--
--     v_spend := v_discount;
--
-- which was right only while a point was a piastre and the two numbers were
-- identical. At 10 piastres a point it charges ten times the points: a member
-- spending 500 points for EGP 50 off was billed 5,000 points for it.
--
-- The two quantities are now named apart and converted deliberately. Rounding
-- is UP, so the club never gives away a fraction of a point's worth of discount
-- for free — and a member is never charged for one they did not use, because
-- the discount is derived from the capped spend rather than the other way
-- round.
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

grant execute on function public.place_order(uuid, integer, text, integer, uuid, text) to authenticated;
