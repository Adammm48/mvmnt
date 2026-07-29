-- ============================================================================
-- The shop, gifts, points redemption, and sponsor reporting.
--
-- The first thing in MVMNT that touches money, so Principles §11 puts it in the
-- same bracket as the check-in geofence and the friend codes rather than with
-- admin CRUD. The four things that must hold:
--
--   · stock cannot be oversold
--   · points cannot be spent twice, or spent and kept
--   · a gift can only reach somebody the buyer added in person
--   · sponsor reach cannot be inflated by a client
--
-- Every one of those is invisible from the UI when it breaks. An oversold shirt
-- looks like a successful order until two people turn up for it.
-- ============================================================================
begin;

do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_c uuid;
  v_shirt uuid; v_soon uuid; v_sticker uuid;
  v_order uuid; v_gift uuid;
  v_sponsor uuid; v_placement uuid;
  v_tok text; v_run uuid;
  v_points integer; v_stock integer; v_total integer;
  v_reach integer; v_taps integer;
  v_now timestamptz := now();
begin
  perform tests.act_as_system();
  v_admin := tests.make_member('organiser', true);
  v_a := tests.make_member('ama');
  v_b := tests.make_member('ben');
  v_c := tests.make_member('cleo');

  -- Give ama something to spend.
  perform tests.act_as(v_admin);
  perform public.admin_adjust_points(v_a, 500, 'seeding points for the shop tests');
  perform tests.act_as_system();

  insert into public.products (name, price_minor, status, stock, sizes)
  values ('Club shirt', 25000, 'in_stock', 2, array['S','M','L'])
  returning id into v_shirt;

  insert into public.products (name, price_minor, status, stock)
  values ('Winter jacket', 90000, 'coming_soon', null)
  returning id into v_soon;

  insert into public.products (name, price_minor, status, stock)
  values ('Sticker pack', 5000, 'in_stock', null)
  returning id into v_sticker;

  -- ---------------------------------------------------------------------
  -- The catalogue.
  -- ---------------------------------------------------------------------
  -- Scoped to this fixture's own products. The seed stocks a real catalogue,
  -- so a global count here measures the seed rather than the behaviour.
  perform tests.act_as(v_a);
  perform tests.assert_eq(
    (select count(*)::int from public.products
      where id in (v_shirt, v_sticker, v_soon) and status = 'in_stock'), 2,
    'a member sees what is on sale');
  perform tests.assert_eq(
    (select count(*)::int from public.products
      where id in (v_shirt, v_sticker, v_soon) and status = 'coming_soon'), 1,
    'and a coming-soon item is listed but not buyable');

  perform tests.assert_rejects(
    format('select public.place_order(%L, 1)', v_soon),
    'a coming-soon item cannot be bought yet');

  -- Apparel needs a size, and one the club actually stocks.
  perform tests.assert_rejects(
    format('select public.place_order(%L, 1)', v_shirt),
    'apparel cannot be ordered without a size');
  perform tests.assert_rejects(
    format('select public.place_order(%L, 1, ''XXL'')', v_shirt),
    'nor in a size the club does not carry');

  -- A sticker pack has no sizes, so it must not demand one.
  v_order := public.place_order(v_sticker, 1);
  perform tests.assert(v_order is not null,
    'an item with no sizes does not ask for one');
  perform public.cancel_order(v_order);

  -- ---------------------------------------------------------------------
  -- Points come off the price, and leave the ledger.
  --
  -- The ledger is the only place a balance lives, so spending has to be an
  -- event in it. A separate "points balance" column would be a second number
  -- to drift.
  -- ---------------------------------------------------------------------
  perform tests.act_as_system();
  v_points := public.points_total(v_a);
  perform tests.assert_eq(v_points, 500, 'ama starts with 500 points');

  perform tests.act_as(v_a);
  v_order := public.place_order(v_shirt, 1, 'M', 500);
  perform tests.act_as_system();

  select total_minor, points_spent into v_total, v_points from public.orders where id = v_order;
  -- 10 piastres a point (0035): 500 points is EGP 50 off a EGP 250 shirt.
  perform tests.assert_eq(v_total, 20000,
    '500 points takes EGP 50 off a EGP 250 shirt');
  perform tests.assert_eq(v_points, 500, 'and the order records what was spent');
  perform tests.assert_eq(public.points_total(v_a), 0,
    'the points have actually left the member''s balance');

  -- The same points cannot be spent again.
  perform tests.act_as(v_a);
  v_gift := public.place_order(v_shirt, 1, 'L', 500);
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select points_spent from public.orders where id = v_gift), 0,
    'a second order cannot spend points that are already gone');
  perform tests.assert_eq(
    (select total_minor from public.orders where id = v_gift), 25000,
    'so it is charged in full');

  -- Points never buy more than the order is worth.
  perform tests.act_as(v_admin);
  perform public.admin_adjust_points(v_b, 99999, 'more points than anything in the shop costs');
  perform tests.act_as(v_b);
  v_order := public.place_order(v_sticker, 1, null, 99999);
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select total_minor from public.orders where id = v_order), 0,
    'points cover the whole price when there are enough');
  -- The sticker pack is EGP 50 = 5000 piastres, so 500 points clears it. The
  -- member must not be charged the 99,999 they offered: spending points that
  -- bought nothing is the quiet way a loyalty scheme robs somebody.
  perform tests.assert_eq(
    (select points_spent from public.orders where id = v_order), 500,
    'and only the points the discount actually used are taken — not all of them');
  perform tests.assert_eq(public.points_total(v_b), 99999 - 500,
    'the rest stays in their balance');

  -- The invariant behind all of the above, stated once: what a member is
  -- charged in points must be exactly what bought the discount they got.
  -- Setting the two from each other without converting is how a rate change
  -- silently bills ten times the points.
  perform tests.assert_eq(
    (select points_spent * 10 from public.orders where id = v_order),
    (select discount_minor from public.orders where id = v_order),
    'points charged and money saved always agree at the stated rate');

  -- ---------------------------------------------------------------------
  -- Stock.
  --
  -- Two members buying the last shirt is the same problem as two members
  -- taking the last place on a capped run, and it has the same answer: the
  -- row is locked before the count is read.
  -- ---------------------------------------------------------------------
  select stock into v_stock from public.products where id = v_shirt;
  perform tests.assert_eq(v_stock, 0, 'two shirts ordered, none left');

  perform tests.act_as(v_c);
  perform tests.assert_rejects(
    format('select public.place_order(%L, 1, ''M'')', v_shirt),
    'the third member cannot buy a shirt that is gone');

  -- Cancelling puts it back.
  perform tests.act_as(v_a);
  perform public.cancel_order(v_gift);
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select stock from public.products where id = v_shirt), 1,
    'cancelling returns the stock');
  perform tests.assert_eq(
    (select status from public.products where id = v_shirt),
    'in_stock'::public.product_status,
    'and puts a sold-out item back on sale');

  -- ---------------------------------------------------------------------
  -- Gifts go only to people you added in person.
  --
  -- Without this the gift flow is a way to send an unsolicited item, and a
  -- notification, to any member whose id can be obtained — exactly the
  -- unsolicited contact the QR-only friends design exists to prevent.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_a);
  perform tests.assert_rejects(
    format('select public.place_order(%L, 1, ''M'', 0, %L)', v_shirt, v_c),
    'you cannot gift to somebody who is not your friend');

  perform tests.assert_rejects(
    format('select public.place_order(%L, 1, ''M'', 0, %L)', v_shirt, v_a),
    'nor to yourself');

  -- Make them friends the only way the app allows, then try again.
  perform tests.act_as(v_c);
  select token into v_tok from public.my_friend_qr();
  perform tests.act_as(v_a);
  perform public.add_friend_by_token(v_tok);

  v_gift := public.place_order(v_shirt, 1, 'M', 0, v_c, 'Congrats on the 50');
  perform tests.act_as_system();
  perform tests.assert(
    (select is_gift from public.orders where id = v_gift),
    'a gift to a real friend goes through');

  -- ---------------------------------------------------------------------
  -- The recipient is told, and only once it is paid for.
  --
  -- A gift announced before the money cleared is a gift that might evaporate,
  -- and there is no good way to take that message back.
  -- ---------------------------------------------------------------------
  perform tests.assert_eq(
    (select count(*)::int from public.notification_events
      where type = 'gift_received' and target_user_id = v_c), 0,
    'nothing is sent while the order is still unpaid');

  perform tests.act_as(v_a);
  perform public.dev_mark_paid(v_gift);
  perform tests.act_as_system();

  perform tests.assert_eq(
    (select count(*)::int from public.notification_events
      where type = 'gift_received' and target_user_id = v_c), 1,
    'paying for it tells the recipient');
  perform tests.assert(
    (select title from public.notification_events
      where type = 'gift_received' and target_user_id = v_c)
      like '%sent you something',
    'and the message names the person who sent it');

  -- ---------------------------------------------------------------------
  -- Redeeming it.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_b);
  perform tests.assert_rejects(
    format('select public.redeem_gift(%L, ''M'')', v_gift),
    'somebody else cannot redeem your gift');

  perform tests.act_as(v_c);
  perform tests.assert_rejects(
    format('select public.redeem_gift(%L, ''XXL'')', v_gift),
    'a size the club does not carry is refused at redemption too');

  perform public.redeem_gift(v_gift, 'S', 'Leave it at the gate');
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select status from public.orders where id = v_gift), 'ready'::public.order_status,
    'redeeming moves it to ready for the club to hand over');
  perform tests.assert_eq(
    (select size from public.orders where id = v_gift), 'S',
    'and the recipient''s own size wins over whatever the buyer guessed');

  perform tests.act_as(v_c);
  perform tests.assert_rejects(
    format('select public.redeem_gift(%L, ''S'')', v_gift),
    'and it cannot be redeemed twice');

  -- ---------------------------------------------------------------------
  -- Both sides can see it; nobody else can.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_c);
  perform tests.assert_eq(
    (select direction from public.my_orders() where id = v_gift), 'received',
    'the recipient sees it as received');
  perform tests.act_as(v_a);
  perform tests.assert_eq(
    (select direction from public.my_orders() where id = v_gift), 'bought',
    'and the buyer as bought');
  perform tests.act_as(v_b);
  perform tests.assert_eq(
    (select count(*)::int from public.my_orders() where id = v_gift), 0,
    'and an unrelated member sees nothing of it');

  -- ---------------------------------------------------------------------
  -- The payment stand-in refuses to pretend it is a gateway.
  -- ---------------------------------------------------------------------
  perform tests.act_as_system();
  perform tests.assert(
    (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'dev_mark_paid')
      like '%mvmnt.test%',
    'dev_mark_paid checks it is on a development database before doing anything');

  -- ---------------------------------------------------------------------
  -- Sponsor reach cannot be inflated.
  --
  -- These numbers leave the club and become a commercial claim, so the limit
  -- has to be structural rather than a client behaving well.
  -- ---------------------------------------------------------------------
  v_run := tests.make_run(v_admin, null, v_now + interval '2 hours');

  insert into public.sponsors (name, url, active_from)
  values ('Local Coffee', 'https://example.test', current_date - 1)
  returning id into v_sponsor;

  insert into public.sponsor_placements (sponsor_id, type)
  values (v_sponsor, 'home_banner')
  returning id into v_placement;

  perform tests.act_as(v_a);
  perform tests.assert_eq(
    (select count(*)::int from public.active_placements() where placement_id = v_placement), 1,
    'an active sponsor is shown');

  -- The same member, hammering it.
  perform public.record_placement_seen(v_placement);
  perform public.record_placement_seen(v_placement);
  perform public.record_placement_seen(v_placement);

  perform tests.act_as(v_b);
  perform public.record_placement_seen(v_placement);

  perform tests.act_as(v_admin);
  select reach, taps into v_reach, v_taps
  from public.admin_sponsor_report(v_sponsor) limit 1;

  perform tests.assert_eq(v_reach, 2,
    'reach counts members, not renders — three views by one member is still one person');
  perform tests.assert_eq(v_taps, 0, 'and a view is not a tap');

  perform tests.act_as(v_a);
  perform public.record_placement_tap(v_placement);
  perform public.record_placement_tap(v_placement);

  perform tests.act_as(v_admin);
  select reach, taps into v_reach, v_taps
  from public.admin_sponsor_report(v_sponsor) limit 1;
  perform tests.assert_eq(v_taps, 2,
    'taps are counted per tap — there is no reason to want that number inflated');
  perform tests.assert_eq(v_reach, 2, 'and tapping does not invent a new person');

  -- Members must not be able to read who saw what. It is a behavioural profile.
  perform tests.act_as(v_a);
  perform tests.assert_eq(
    (select count(*)::int from public.sponsor_impressions), 0,
    'a member cannot read the impression log at all — it says who saw which sponsor when');
  perform tests.assert_rejects(
    format('select * from public.admin_sponsor_report(%L)', v_sponsor),
    'nor run the sponsor report');

  -- An expired sponsorship disappears without anybody taking the banner down.
  perform tests.act_as_system();
  update public.sponsors set active_to = current_date - 1 where id = v_sponsor;
  perform tests.act_as(v_a);
  perform tests.assert_eq(
    (select count(*)::int from public.active_placements() where placement_id = v_placement), 0,
    'a sponsorship that has ended stops showing on its own');

  perform tests.act_as(v_admin);
  perform tests.assert_rejects(
    format('select public.admin_send_sponsor_shoutout(%L, ''Free coffee today'')', v_sponsor),
    'and cannot be used to message the club after it has ended');

  perform tests.act_as_system();
  raise notice 'PASS 08_shop';
end $$;

rollback;
