-- ============================================================================
-- 0032 · The shop: products, orders, gifts, and spending points
--
-- App Spec §4.6. This is the first thing in MVMNT that touches money, so
-- Principles §11 applies in full: every rule here is server-side, every total
-- is derived, and the tests treat it like the check-in geofence rather than
-- like admin CRUD.
--
-- PAYMENT IS DELIBERATELY NOT HERE
--
-- Stripe does not serve Egypt-based businesses, so this needs Paymob, Fawry or
-- Accept — and which one depends on quotes the club has not obtained and on
-- whether MVMNT is a registered company (docs/costs.md). Guessing a provider
-- would mean building an integration against an API nobody has agreed to pay
-- for, and payment integrations are not portable between providers.
--
-- So an order stops at `awaiting_payment`, and `dev_mark_paid()` is the only
-- way past it — a function that names itself, refuses to exist outside a
-- development database, and is impossible to mistake for a real gateway. The
-- entire rest of the flow is real: stock, points, gifts, notifications and
-- redemption all work exactly as they will on the day a gateway is wired in.
--
-- MONEY IS IN PIASTRES
--
-- Integer minor units, never floats. 0.1 + 0.2 is not 0.3 in floating point,
-- and a shop that is a piastre out on some orders is a shop nobody can
-- reconcile.
-- ============================================================================

create type public.product_status as enum ('in_stock', 'coming_soon', 'retired');

create type public.order_status as enum (
  'awaiting_payment',  -- created, stock held, nothing paid
  'paid',              -- the gateway said yes (today: dev_mark_paid)
  'ready',             -- the club has the item ready to hand over
  'fulfilled',         -- in the member's hands
  'cancelled'          -- stock returned, points returned
);

create table public.products (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  image_url    text,
  -- Piastres. 25000 = 250.00 EGP.
  price_minor  integer not null,
  currency     text not null default 'EGP',
  status       public.product_status not null default 'coming_soon',
  -- Null means "not stock-tracked" (a made-to-order item), which is different
  -- from zero: zero is sold out.
  stock        integer,
  -- Apparel needs a size at redemption (§4.6). Empty for anything that does not.
  sizes        text[] not null default '{}',
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint product_name_present check (char_length(trim(name)) between 1 and 120),
  constraint price_not_negative   check (price_minor >= 0),
  constraint stock_not_negative   check (stock is null or stock >= 0)
);

create trigger products_touch_updated_at
  before update on public.products
  for each row execute function app_private.touch_updated_at();

comment on column public.products.stock is
  'Null means not stock-tracked. Zero means sold out. The difference matters: a made-to-order item must not be hidden as though it had run out.';

-- ---------------------------------------------------------------------------
-- "Tell me when it lands" for coming-soon items (§4.6).
-- ---------------------------------------------------------------------------
create table public.product_waitlist (
  product_id uuid not null references public.products (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),

  primary key (product_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Orders.
--
-- The price is copied onto the order rather than joined from the product.
-- Prices change; what somebody actually paid must not change with them, and an
-- order that re-prices itself six months later is unreconcilable.
-- ---------------------------------------------------------------------------
create table public.orders (
  id             uuid primary key default gen_random_uuid(),
  buyer_id       uuid references public.profiles (id) on delete set null,
  product_id     uuid references public.products (id) on delete set null,

  -- Frozen at the moment of ordering.
  product_name   text not null,
  unit_price_minor integer not null,
  quantity       integer not null default 1,
  size           text,

  -- What the points knocked off, and what is actually owed.
  points_spent   integer not null default 0,
  discount_minor integer not null default 0,
  total_minor    integer not null,
  currency       text not null default 'EGP',

  status         public.order_status not null default 'awaiting_payment',

  -- Gift fields (§4.6). recipient_id is set only for a gift, and only ever to
  -- somebody the buyer is actually friends with — enforced in place_order().
  is_gift        boolean not null default false,
  recipient_id   uuid references public.profiles (id) on delete set null,
  gift_message   text,
  -- The recipient confirms size and address before the club hands it over.
  redeemed_at    timestamptz,
  delivery_note  text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint quantity_sane        check (quantity between 1 and 20),
  constraint totals_not_negative  check (total_minor >= 0 and discount_minor >= 0 and points_spent >= 0),
  constraint gift_has_recipient   check (not is_gift or recipient_id is not null),
  constraint gift_is_not_self     check (recipient_id is null or recipient_id <> buyer_id),
  constraint message_length       check (gift_message is null or char_length(gift_message) <= 300)
);

create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function app_private.touch_updated_at();

create index orders_buyer_idx     on public.orders (buyer_id, created_at desc);
create index orders_recipient_idx on public.orders (recipient_id, created_at desc)
  where recipient_id is not null;

comment on column public.orders.unit_price_minor is
  'Copied from the product at order time, never joined. Prices change; what somebody paid must not.';

-- ---------------------------------------------------------------------------
-- What points are worth.
--
-- One place, so the checkout preview and the checkout itself can never quote
-- different numbers — which is the classic way a shop ends up charging
-- something other than what it showed.
-- ---------------------------------------------------------------------------
create or replace function public.points_discount_minor(p_points integer)
returns integer
language sql
immutable
parallel safe
as $$
  -- 1 point = 1 piastre. Deliberately round: a member should be able to work
  -- out their own discount without the app explaining a conversion rate.
  select greatest(coalesce(p_points, 0), 0);
$$;

comment on function public.points_discount_minor is
  'One point is one piastre. Kept as a function rather than a constant so the checkout preview and the checkout itself cannot quote different rates.';

-- ---------------------------------------------------------------------------
-- Placing an order.
--
-- Everything that can go wrong with a shop goes wrong here, so all of it is
-- decided in one transaction: stock, points, the friendship behind a gift, and
-- the price.
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

  -- FOR UPDATE, exactly as join_run locks a run before counting places. Two
  -- members buying the last shirt at the same moment is the same problem as
  -- two members taking the last place on a capped run, and it has the same
  -- answer: serialise on the row that holds the scarce thing.
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
      -- Built into a variable first: RAISE takes a literal format string, not
      -- an expression, so a CASE inline here is a syntax error rather than a
      -- neat one-liner.
      v_message := case
        when v_available = 0 then 'that item has sold out'
        when v_available = 1 then 'only one left'
        else 'only ' || v_available || ' left'
      end;
      raise exception '%', v_message using errcode = 'check_violation';
    end if;
  end if;

  -- Apparel needs a size, and it has to be one the club actually stocks.
  if array_length(v_product.sizes, 1) is not null then
    if p_size is null or not (p_size = any (v_product.sizes)) then
      raise exception 'choose a size' using errcode = 'check_violation';
    end if;
  end if;

  -- A gift can only go to somebody the buyer added in person. This is the
  -- whole reason the friends system is QR-only: without this check the gift
  -- flow becomes a way to send an unsolicited item — and a notification — to
  -- any member whose id can be obtained (§4.4, §4.6).
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

  -- Points: never more than they have, and never more than the order is worth.
  -- Capping rather than erroring, because a member who earned points while the
  -- checkout screen was open should not be shown a failure.
  v_points   := public.points_total(v_me);
  v_spend    := least(greatest(coalesce(p_use_points, 0), 0), v_points);
  v_discount := least(public.points_discount_minor(v_spend), v_gross);
  -- Recompute the spend from the discount actually applied, so a member is
  -- never charged points that bought them nothing.
  v_spend    := v_discount;

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

  -- Stock is decremented now, not on payment. Holding it at order time is what
  -- stops two people paying for the last shirt; the cancel path returns it.
  if v_product.stock is not null then
    update public.products
       set stock = stock - p_quantity,
           status = case when stock - p_quantity <= 0 then 'retired' else status end
     where id = v_product.id;
  end if;

  -- Points leave the ledger as a normal event, so points_total() stays the one
  -- place a balance comes from. The order id is in the note, which is what
  -- makes a refund reconcilable.
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

-- ---------------------------------------------------------------------------
-- Cancelling.
--
-- Returns the stock and the points. Both are written as new facts rather than
-- by editing the originals: the ledger is append-only, and an order that
-- rewrites its own history cannot be audited.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'no_data_found';
  end if;

  if v_order.buyer_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'that is not your order' using errcode = 'insufficient_privilege';
  end if;

  -- Once the club has handed something over, cancelling is a conversation
  -- rather than a button.
  if v_order.status in ('fulfilled', 'cancelled') then
    raise exception 'this order can no longer be cancelled' using errcode = 'check_violation';
  end if;

  update public.orders set status = 'cancelled' where id = p_order_id;

  if v_order.product_id is not null then
    update public.products
       set stock = stock + v_order.quantity,
           status = case when status = 'retired' then 'in_stock' else status end
     where id = v_order.product_id and stock is not null;
  end if;

  if v_order.points_spent > 0 and v_order.buyer_id is not null then
    insert into public.point_events (user_id, run_id, kind, points, source, note)
    values (v_order.buyer_id, null, 'redemption', v_order.points_spent, 'live',
            'refund for cancelled order ' || p_order_id::text);
  end if;

  perform app_private.audit('cancel_order', 'orders', p_order_id::text,
    jsonb_build_object('points_returned', v_order.points_spent));
end;
$$;

-- ---------------------------------------------------------------------------
-- The recipient's side of a gift (§4.6).
--
-- A gift does not just appear: the recipient confirms it, picks a size if the
-- item needs one, and leaves a delivery note. That is the difference between
-- being sent something and being handed something.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_gift(
  p_order_id     uuid,
  p_size         text default null,
  p_delivery_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order   public.orders;
  v_product public.products;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.recipient_id is distinct from auth.uid() then
    raise exception 'that gift is not yours' using errcode = 'insufficient_privilege';
  end if;
  if v_order.redeemed_at is not null then
    raise exception 'you have already confirmed this one' using errcode = 'check_violation';
  end if;

  select * into v_product from public.products where id = v_order.product_id;
  if found and array_length(v_product.sizes, 1) is not null then
    if p_size is null or not (p_size = any (v_product.sizes)) then
      raise exception 'choose a size' using errcode = 'check_violation';
    end if;
  end if;

  update public.orders
     set redeemed_at   = now(),
         size          = coalesce(p_size, size),
         delivery_note = nullif(trim(coalesce(p_delivery_note, '')), ''),
         status        = case when status = 'paid' then 'ready' else status end
   where id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The stand-in for a payment gateway.
--
-- Named so nobody mistakes it for one, and refuses to run anywhere that looks
-- like production. When Paymob or Fawry is chosen, the webhook that confirms a
-- payment takes this function's place and nothing else in this file changes.
-- ---------------------------------------------------------------------------
create or replace function public.dev_mark_paid(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The seeded accounts only exist on a development database. Their absence is
  -- the closest thing to a reliable "this is production" signal available here,
  -- and erring towards refusing is the right way round for a money function.
  if not exists (select 1 from auth.users where email like '%@mvmnt.test') then
    raise exception
      'dev_mark_paid is a development stand-in and will not run here. Wire a real payment gateway — see docs/costs.md.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.orders
     set status = 'paid'
   where id = p_order_id and status = 'awaiting_payment';

  perform app_private.audit('dev_mark_paid', 'orders', p_order_id::text,
                            jsonb_build_object('stub', true));
end;
$$;

comment on function public.dev_mark_paid is
  'DEVELOPMENT ONLY. Stands in for a payment gateway webhook and refuses to run on a database with no seeded test accounts. See docs/costs.md for why no real gateway is wired in yet.';

-- ---------------------------------------------------------------------------
-- Reading the shop and your own orders.
-- ---------------------------------------------------------------------------
create or replace function public.my_orders()
returns table (
  id             uuid,
  product_name   text,
  image_url      text,
  quantity       integer,
  size           text,
  total_minor    integer,
  points_spent   integer,
  currency       text,
  status         public.order_status,
  is_gift        boolean,
  gift_message   text,
  direction      text,
  other_party    text,
  redeemed_at    timestamptz,
  created_at     timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id, o.product_name, p.image_url, o.quantity, o.size, o.total_minor,
         o.points_spent, o.currency, o.status, o.is_gift, o.gift_message,
         case when o.recipient_id = auth.uid() then 'received' else 'bought' end,
         -- The other person's name, which the gift flow needs and which is safe
         -- here: they are already friends, or one gifted the other.
         case when o.recipient_id = auth.uid()
              then (select display_name from public.profiles where id = o.buyer_id)
              else (select display_name from public.profiles where id = o.recipient_id)
         end,
         o.redeemed_at, o.created_at
  from public.orders o
  left join public.products p on p.id = o.product_id
  where o.buyer_id = auth.uid() or o.recipient_id = auth.uid()
  order by o.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.products         enable row level security;
alter table public.product_waitlist enable row level security;
alter table public.orders           enable row level security;

-- The catalogue is public to members; retired items are hidden because an item
-- nobody can buy is only confusing.
create policy products_select_visible on public.products
  for select to authenticated
  using (status <> 'retired' or public.is_admin());

create policy products_admin_write on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy waitlist_own on public.product_waitlist
  for all to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid());

-- An order is visible to the two people in it, and to organisers who have to
-- actually hand the thing over.
create policy orders_select_own on public.orders
  for select to authenticated
  using (buyer_id = auth.uid() or recipient_id = auth.uid() or public.is_admin());

create policy orders_admin_write on public.orders
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Every member-facing write goes through a function that validates first.
revoke insert, delete on public.orders from authenticated;

grant select on public.products         to authenticated;
grant select on public.orders           to authenticated;
grant select, insert, delete on public.product_waitlist to authenticated;
grant insert, update, delete on public.products to authenticated;
grant update on public.orders to authenticated;

grant select, insert, update, delete on public.products         to service_role;
grant select, insert, update, delete on public.product_waitlist to service_role;
grant select, insert, update, delete on public.orders           to service_role;

grant execute on function public.points_discount_minor(integer)                          to authenticated;
grant execute on function public.place_order(uuid, integer, text, integer, uuid, text)   to authenticated;
grant execute on function public.cancel_order(uuid)                                      to authenticated;
grant execute on function public.redeem_gift(uuid, text, text)                           to authenticated;
grant execute on function public.my_orders()                                             to authenticated;
grant execute on function public.dev_mark_paid(uuid)                                     to authenticated;
