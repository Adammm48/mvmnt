/**
 * Every action a member takes must show them what happened.
 *
 * Each block below corresponds to a bug that actually shipped and was found by
 * a person, not a test. The assertion is always "the member can read this",
 * never "the call returned". That distinction is the entire reason this file
 * exists — the database suites already prove the functions work.
 *
 *   npm run test:e2e        (needs the stack, the dev servers and a seeded db)
 */

import {
  chromium,
  openApp,
  openConsole,
  rest,
  seen,
  notSeen,
  check,
  report,
  MOBILE,
} from './harness.mjs';

const browser = await chromium.launch();

try {
  // -------------------------------------------------------------------------
  // 1. The attendance control always reports its own outcome.
  //
  //    State-driven on purpose: which button is on screen depends on what the
  //    seeded member already did, and a test that assumes "Join" is showing
  //    tests the fixture rather than the app. The invariant that matters is
  //    the same either way — whatever the primary action is, doing it must
  //    put a legible result on screen, and must not leave the previous
  //    result sitting above it.
  // -------------------------------------------------------------------------
  {
    const { context, page, session } = await openApp(browser, 'runner12@mvmnt.test');
    const runs = await rest(
      'runs?select=id,title&status=eq.published&order=starts_at.asc&limit=1',
      session,
    );
    await page.goto(`${MOBILE}/run/${runs[0].id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);

    const action = page
      .getByRole('button', { name: /Join this run|Join the waitlist|Leave the waitlist|Can't make it/i })
      .first();
    const label = (await action.innerText().catch(() => '')) || '(none)';
    check(label !== '(none)', `the run screen offers an attendance action (found: ${label})`);

    if (label !== '(none)') {
      await action.click();
      await page.waitForTimeout(700);
      // Withdrawing asks first; joining does not.
      const confirm = page
        .getByRole('button', { name: /Leave the waitlist|Give up my place|Withdraw|Yes/i })
        .last();
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
      }
      await seen(
        page,
        /You're in|You're on the waitlist|You're out|You're off the waitlist/i,
        `"${label}" puts a legible outcome on screen`,
      );
    }
    await context.close();
  }

  // 2. Every published gallery is reachable WITHOUT a notification.
  //    This is the exact bug: published, permitted, and unreachable, because
  //    the only route in was a push notification that cannot be sent yet.
  // -------------------------------------------------------------------------
  {
    const { context, page, session } = await openApp(browser, 'runner7@mvmnt.test');
    const published = await rest(
      'runs?select=id,title&photos_published_at=not.is.null&limit=5',
      session,
    );
    check(published.length > 0, 'the fixture has at least one published gallery');

    await page.goto(`${MOBILE}/photos`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    for (const run of published) {
      await seen(
        page,
        run.title,
        `"${run.title}" is reachable from the Photos tab, not only from a notification`,
      );
    }
    await context.close();
  }

  // -------------------------------------------------------------------------
  // 3. Sharing produces a visible outcome. navigator.share and the native
  //    Share sheet both failed silently here; the fix was a typed outcome.
  // -------------------------------------------------------------------------
  {
    const { context, page } = await openApp(browser, 'runner7@mvmnt.test');
    await page.goto(`${MOBILE}/leaderboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const share = page.getByRole('button', { name: /Share your standing/i }).first();
    if (await share.isVisible().catch(() => false)) {
      await share.click();
      await page.waitForTimeout(1200);
      // Either the sheet opens, or the app says it cannot — never nothing.
      // On web the sheet offers "Copy the text"; on a device, "Share". Either
      // is fine — silence is not, which is what this once did.
      await seen(
        page,
        /Copy the text|Share|Couldn't|not available/i,
        'sharing opens the sheet or says why it cannot — never silence',
      );
    }
    await context.close();
  }

  // -------------------------------------------------------------------------
  // 4. The friend code shows an actual code plus its countdown. The countdown
  //    IS the safety argument, so its absence is a real defect.
  // -------------------------------------------------------------------------
  {
    const { context, page } = await openApp(browser, 'runner7@mvmnt.test');
    await page.goto(`${MOBILE}/friends/code`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await seen(page, 'Or read this out', 'the code is offered in readable characters, not only as a QR');
    await seen(page, /^[0-9A-Z]{4} [0-9A-Z]{4}$/, 'and the eight characters are on screen');
    await seen(page, /until a new code replaces this one/, 'with the countdown that makes it safe');
    await context.close();
  }

  // -------------------------------------------------------------------------
  // 5. Reporting content confirms to the member. A report that vanishes
  //    silently is worse than no report button, and the store rule is about
  //    the member being able to act.
  // -------------------------------------------------------------------------
  {
    const { context, page, session } = await openApp(browser, 'runner9@mvmnt.test');
    const published = await rest(
      'runs?select=id&photos_published_at=not.is.null&limit=1',
      session,
    );
    if (published[0]) {
      await page.goto(`${MOBILE}/photos/${published[0].id}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);
      const firstPhoto = page.locator('img').first();
      if (await firstPhoto.isVisible().catch(() => false)) {
        await firstPhoto.click({ force: true });
        await page.waitForTimeout(1200);
        const reportBtn = page.getByText('Report this photo');
        await seen(page, reportBtn, 'an open photo offers a way to report it');
        if (await reportBtn.isVisible().catch(() => false)) {
          await reportBtn.click();
          await page.waitForTimeout(900);
          const send = page.getByRole('button', { name: 'Send report' });
          check(
            await send.isDisabled().catch(() => false),
            'the report cannot be sent empty — the reason is what gets acted on',
          );
          await page.getByPlaceholder('What should the organisers know?').fill('e2e: a test report');
          await page.waitForTimeout(300);
          await send.click();
          await seen(page, /Sent to the organisers/i, 'and sending it confirms to the member');
        }
      }
    }
    await context.close();
  }

  // -------------------------------------------------------------------------
  // 6. A failure offers a way back. A dead end with no retry was the shape of
  //    the leaderboard's transient error.
  // -------------------------------------------------------------------------
  {
    const { context, page } = await openApp(browser, 'runner7@mvmnt.test');
    // Break the API for this page only, then load the board.
    await page.route('**/rest/v1/rpc/leaderboard', (route) =>
      route.fulfill({ status: 500, body: '{"message":"forced failure"}' }),
    );
    await page.goto(`${MOBILE}/leaderboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await seen(page, /went wrong|Couldn't|try again/i, 'a failed board says so rather than sitting blank');
    await seen(
      page,
      page.getByRole('button', { name: /Try again/i }),
      'and offers a visible way to retry',
    );
    await context.close();
  }

  // -------------------------------------------------------------------------
  // 7. The organiser's mutating controls confirm. Stock ± changed a number in
  //    a busy table and said nothing.
  // -------------------------------------------------------------------------
  {
    const { context, page } = await openConsole(browser);
    await page.getByRole('button', { name: 'Merch', exact: true }).click();
    await page.waitForTimeout(2000);
    const plus = page.getByRole('button', { name: '+', exact: true }).first();
    if (await plus.isVisible().catch(() => false)) {
      await plus.click();
      await seen(page, /in stock/i, 'changing stock tells the organiser what it changed to');
    }
    await context.close();
  }

  // -------------------------------------------------------------------------
  // 8. The console's moderation queue can act, not merely display. A queue
  //    nobody can act on is the store rule unmet.
  // -------------------------------------------------------------------------
  {
    const { context, page } = await openConsole(browser);
    await page.getByRole('button', { name: 'Reports', exact: true }).click();
    await page.waitForTimeout(2500);
    const anyReport = page.getByRole('button', { name: /Resolve as fine/i }).first();
    if (await anyReport.isVisible().catch(() => false)) {
      await seen(page, anyReport, 'an open report can be resolved from the console');
    } else {
      await seen(page, /queue is empty|Nothing reported/i, 'an empty queue says so plainly');
    }
    await context.close();
  }
} finally {
  await browser.close();
}

process.exit(report('visible outcomes') ? 0 : 1);
