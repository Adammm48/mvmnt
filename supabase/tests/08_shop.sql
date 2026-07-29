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

  -- As the system, not as the buyer: dev_mark_paid stands in for a
  -- server-to-server payment webhook and is service_role only (migration 0045).
  perform tests.act_as_system();
  perform public.dev_mark_paid(v_gift);

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

  -- A member must not be able to mark anybody's order paid — not their own,
  -- and certainly not somebody else's. Before migration 0045 the grant was to
  -- `authenticated` and the body never checked the buyer, so a single seeded
  -- @mvmnt.test account on a live database would have handed every member a
  -- free-shirt button.
  perform tests.act_as(v_a);
  perform tests.assert_rejects(
    format('select public.dev_mark_paid(%L)', v_gift),
    'a member cannot mark an order paid — the payment stand-in is service_role only');
  perform tests.act_as_system();

  -- ---------------------------------------------------------------------
  -- The buyer is locked, so points cannot be spent twice (migration 0045).
  --
  -- place_order() locked the product row but never the member, so two orders
  -- for two DIFFERENT products took two different locks, both read the same
  -- full balance, and both spent it. A single-session test cannot reproduce
  -- the race, so this asserts the invariant the lock exists to protect —
  -- spending the balance twice in a row leaves the ledger at zero, not
  -- negative — and that the lock itself is present in the function.
  -- ---------------------------------------------------------------------
  perform tests.assert(
    (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'place_order')
      like '%from public.profiles where id = v_me for update%',
    'place_order takes a lock on the buyer, not only on the product');

  declare
    v_p1 uuid; v_p2 uuid; v_left integer;
  begin
    perform tests.act_as_system();
    insert into public.products (name, price_minor, status, stock)
    values ('Lock Test A', 100000, 'in_stock', 10) returning id into v_p1;
    insert into public.products (name, price_minor, status, stock)
    values ('Lock Test B', 100000, 'in_stock', 10) returning id into v_p2;

    perform tests.act_as(v_admin);
    perform public.admin_adjust_points(v_b, 300, 'points for the double-spend test');

    perform tests.act_as(v_b);
    perform public.place_order(v_p1, 1, null, 300);
    perform public.place_order(v_p2, 1, null, 300);

    perform tests.act_as_system();
    v_left := public.points_total(v_b);
    perform tests.assert(
      v_left >= 0,
      'spending the same balance on two orders cannot drive the ledger negative');
  end;
  perform tests.act_as_system();

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


-- ---------------------------------------------------------------------------
-- The audit council's merch fixes (migrations 0052/0053).
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin uuid; v_a uuid; v_p uuid; v_o uuid;
begin
  perform tests.act_as_system();
  v_admin := tests.make_member('organiser-m', true);
  v_a := tests.make_member('salma');
  perform tests.act_as(v_admin);
  perform public.admin_adjust_points(v_a, 100, 'test points');
  perform tests.act_as_system();
  insert into public.products (name, price_minor, status, stock)
  values ('Audit Cap', 20000, 'in_stock', 1) returning id into v_p;

  -- Selling the last one marks it SOLD OUT, not retired: still visible.
  perform tests.act_as(v_a);
  select public.place_order(v_p, 1, null, 0) into v_o;
  perform tests.assert_eq(
    (select status::text from public.products where id = v_p), 'sold_out',
    'selling the last one marks the item sold out, not retired');
  perform tests.assert(
    exists (select 1 from public.products where id = v_p),
    'and a member can still see it in the shop saying so');

  -- The organiser's real mark-paid path works; a member's does not.
  perform tests.assert_rejects(
    format('select public.admin_mark_paid(%L)', v_o),
    'a member cannot mark their own order paid');
  perform tests.act_as(v_admin);
  perform public.admin_mark_paid(v_o);
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select status::text from public.orders where id = v_o), 'paid',
    'an organiser records an in-person payment — the production path exists');

  -- A retired product stays retired whatever happens to its old orders.
  perform tests.act_as_system();
  update public.products set status = 'retired' where id = v_p;
  update public.orders set status = 'awaiting_payment' where id = v_o;
  perform tests.act_as(v_a);
  perform public.cancel_order(v_o);
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select status::text from public.products where id = v_p), 'retired',
    'cancelling an order no longer resurrects a deliberately retired item');
end $$;

-- ---------------------------------------------------------------------------
-- Content reports (migration 0051): file, dedupe, resolve, and who sees them.
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_r uuid;
begin
  perform tests.act_as_system();
  v_admin := tests.make_member('organiser-r', true);
  v_a := tests.make_member('reporter');
  v_b := tests.make_member('bystander');

  perform tests.act_as(v_a);
  perform public.report_content('photo', 'some-photo-id', 'this photo shows my house number');
  perform public.report_content('photo', 'some-photo-id', 'tapped twice');
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int from public.content_reports where target_id = 'some-photo-id'), 1,
    'reporting twice is a double-tap, not a second grievance');

  perform tests.act_as(v_a);
  perform tests.assert_rejects(
    'select public.report_content(''photo'', ''x'', '''')',
    'a report needs words — it is what the organiser acts on');

  -- Members see none of it, not even their own; organisers see all of it.
  perform tests.act_as(v_b);
  perform tests.assert_eq(
    (select count(*)::int from public.content_reports), 0,
    'reports are a message to the club, not a public thread');
  perform tests.act_as(v_admin);
  -- Scoped to this fixture's own reporter, never a global count: the seeded
  -- database carries demo reports, and a suite that counts every row in the
  -- table fails the moment somebody adds one. Same trap as the product and
  -- badge counts elsewhere in this file.
  perform tests.assert_eq(
    (select count(*)::int from public.content_reports
      where resolved_at is null and reporter_id = v_a), 1,
    'organisers see the open queue');

  select id into v_r from public.content_reports where target_id = 'some-photo-id';
  perform public.admin_resolve_report(v_r);
  perform tests.act_as_system();
  perform tests.assert(
    (select resolved_at is not null and resolved_by is not null
       from public.content_reports where id = v_r),
    'resolving records who and when');

  -- -------------------------------------------------------------------------
  -- The queue itself (migration 0056): enriched, admin-only, and its one
  -- moderation action on gift text.
  -- -------------------------------------------------------------------------
  declare
    v_prod uuid; v_order uuid; v_qr text;
  begin
    -- A gift with a message, then a report against that message.
    perform tests.act_as_system();
    insert into public.products (name, price_minor, status, stock)
    values ('Report Test Shirt', 40000, 'in_stock', 5) returning id into v_prod;
    -- The two members become friends the honest way: one shows a code, the
    -- other scans it. place_order refuses a gift to a stranger.
    perform tests.act_as(v_a);
    select token into v_qr from public.my_friend_qr();
    perform tests.act_as(v_b);
    perform public.add_friend_by_token(v_qr);

    perform tests.act_as(v_a);
    v_order := public.place_order(v_prod, 1, null, 0, v_b, 'a rude message, allegedly');

    perform tests.act_as(v_b);
    perform public.report_content('gift_message', v_order::text, 'the note is unkind');

    -- The queue shows the message text and both names to the organiser…
    perform tests.act_as(v_admin);
    perform tests.assert_eq(
      (select gift_message from public.admin_reports()
        where kind = 'gift_message' and target_id = v_order::text),
      'a rude message, allegedly',
      'the queue carries the reported content so the organiser can judge it');

    -- …and to nobody else.
    perform tests.act_as(v_a);
    perform tests.assert_rejects(
      'select * from public.admin_reports()',
      'the moderation queue is organiser-only');

    -- The one column an organiser may blank.
    perform tests.act_as(v_admin);
    perform public.admin_clear_gift_message(v_order);
    perform tests.act_as_system();
    perform tests.assert(
      (select gift_message is null from public.orders where id = v_order),
      'clearing a reported gift message blanks the text');
    perform tests.assert(
      (select status from public.orders where id = v_order) = 'awaiting_payment',
      'and touches nothing else about the order');
    perform tests.assert(
      exists (select 1 from public.audit_log where action = 'clear_gift_message'),
      'moderation is audited like every other organiser act');
  end;
end $$;

-- Everything above runs inside the single transaction opened at the top of this
-- file. The rollback belongs HERE, at the end — it briefly sat straight after
-- the first block, which left the two blocks below it running in autocommit.
-- They committed their fixture members, so the suite passed once after a reset
-- and failed on a duplicate email every run after that, and the runner's
-- promise to leave the database as it found it was quietly false.
rollback;
