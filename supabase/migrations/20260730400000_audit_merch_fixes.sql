-- ============================================================================
-- 0053 · The audit council's merch findings, fixed
--
-- Three related bugs, one root mistake: 'retired' was doing double duty as
-- both "the club removed this deliberately" and "the stock ran out", and the
-- two states have opposite futures. A retired item should stay gone; a
-- sold-out one should sit visibly in the shop saying "Sold out" and come back
-- the moment stock does.
--
-- 1. THE PIPELINE WAS DEAD IN PRODUCTION. The only path from awaiting_payment
--    to paid was dev_mark_paid(), which refuses to run on any database
--    without seeded test accounts — i.e. on production. Every real "Mark
--    paid" click would have errored; gift notifications would never fire;
--    the recipient's confirm screen was unreachable. The stand-in had been
--    quietly standing in for a function that never got built: an ORGANISER
--    recording that cash changed hands, which is how this club actually
--    takes payment. That function now exists.
--
-- 2. SELLING OUT DELETED THE ITEM. place_order set status='retired' at zero
--    stock, and the visibility policy hides retired items — so the last sale
--    made the product vanish, "Sold out" copy was unreachable, and a gift
--    recipient could no longer read the product row: the size list came back
--    empty, the picker never rendered, and redeem_gift demanded a size the
--    screen had no way to provide.
--
-- 3. CANCELLING RESURRECTED THE DEAD. cancel_order revived 'retired' to
--    'in_stock' unconditionally, so any member cancelling an old order put a
--    deliberately-discontinued item back on sale.
-- ============================================================================

-- The organiser's real function. Payment is in person (docs/costs.md); this
-- is the moment the money crossed the table, recorded by the person it
-- crossed to. The gift notification fires from the status-change trigger
-- exactly as it did for the dev path.
create or replace function public.admin_mark_paid(p_order_id uuid)
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
     set status = 'paid'
   where id = p_order_id and status = 'awaiting_payment';

  if not found then
    raise exception 'that order is not awaiting payment' using errcode = 'check_violation';
  end if;

  perform app_private.audit('mark_paid', 'orders', p_order_id::text, '{}'::jsonb);
end;
$$;

comment on function public.admin_mark_paid is
  'The organiser records that the member paid in person. The only production path from awaiting_payment to paid — dev_mark_paid remains a service_role test stand-in (migration 0053).';

grant execute on function public.admin_mark_paid(uuid) to authenticated;

-- Selling out is its own state now.
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

  -- Buyer first, then product — the lock order from 0045, unchanged.
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

  v_points := public.points_total(v_me);
  v_spend  := least(greatest(coalesce(p_use_points, 0), 0), v_points);
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
           -- SOLD OUT, not retired: still visible, honestly labelled, and
           -- revived by restocking. 'retired' is reserved for the club
           -- removing an item on purpose.
           status = case when stock - p_quantity <= 0 then 'sold_out' else status end
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

-- Cancelling revives only what selling out took away.
create or replace function public.cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders
   where id = p_order_id and buyer_id = auth.uid()
   for update;

  if not found then
    raise exception 'order not found' using errcode = 'no_data_found';
  end if;
  if v_order.status <> 'awaiting_payment' then
    raise exception 'this order can no longer be cancelled — ask an organiser'
      using errcode = 'check_violation';
  end if;

  update public.orders set status = 'cancelled' where id = p_order_id;

  if v_order.product_id is not null then
    update public.products
       set stock = coalesce(stock, 0) + v_order.quantity,
           -- Only a sell-out comes back. An item the club retired on purpose
           -- stays retired, whatever happens to old orders for it.
           status = case when status = 'sold_out' then 'in_stock' else status end
     where id = v_order.product_id;
  end if;

  if v_order.points_spent > 0 then
    insert into public.point_events (user_id, run_id, kind, points, source, note)
    values (v_order.buyer_id, null, 'adjustment', v_order.points_spent, 'live',
            'points returned — order cancelled');
  end if;

  perform app_private.audit('cancel_order', 'orders', p_order_id::text, '{}'::jsonb);
end;
$$;

-- A gift recipient must be able to read the product their gift points at —
-- sizes, name, image — even if it has since retired. Without this the size
-- picker renders empty and redeem_gift demands a size the screen cannot ask
-- for.
drop policy if exists products_select_visible on public.products;
create policy products_select_visible on public.products
  for select to authenticated
  using (
    status <> 'retired'
    or public.is_admin()
    or exists (
      select 1 from public.orders o
      where o.product_id = products.id
        and (o.buyer_id = auth.uid() or o.recipient_id = auth.uid())
    )
  );
