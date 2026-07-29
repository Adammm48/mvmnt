/**
 * Capture the README screenshots from the running apps.
 *
 *   npm run db:start && npm run db:reset
 *   npm run --workspace @mvmnt/admin dev     # :5173
 *   npm run --workspace @mvmnt/mobile web    # :8081
 *   node scripts/screenshots.mjs
 *
 * Scripted rather than hand-captured so the images in the README can be
 * regenerated after a UI change instead of quietly going stale — a README
 * showing an interface that no longer exists is worse than one showing none.
 *
 * It signs in through the real auth flow (requesting an OTP and reading it back
 * from the local mail catcher), so these are screenshots of the actual app
 * against the actual database, not mockups.
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const API = 'http://127.0.0.1:54321';
const MAIL = 'http://127.0.0.1:54324';
const MOBILE = 'http://127.0.0.1:8081';
const ADMIN = 'http://127.0.0.1:5173';
const OUT = 'docs/screenshots';

// Local demo key, published in Supabase's own docs and identical on every
// machine. Never a real credential.
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

async function signIn(email) {
  await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' });
  await fetch(`${API}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, create_user: false }),
  });

  let code = null;
  for (let attempt = 0; attempt < 30 && !code; attempt++) {
    await new Promise((r) => setTimeout(r, 500));
    const list = await (await fetch(`${MAIL}/api/v1/messages?limit=1`)).json();
    const id = list.messages?.[0]?.ID;
    if (!id) continue;
    const message = await (await fetch(`${MAIL}/api/v1/message/${id}`)).json();
    code = `${message.Text ?? ''}${message.HTML ?? ''}`.match(/\b(\d{6})\b/)?.[1] ?? null;
  }
  if (!code) throw new Error(`no sign-in code arrived for ${email}`);

  const session = await (
    await fetch(`${API}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token: code, type: 'email' }),
    })
  ).json();

  if (!session.access_token) throw new Error(`sign-in failed for ${email}`);
  return session;
}

/** Hand the page a ready session so the shots start on the screen that matters. */
async function seedSession(page, origin, session) {
  await page.goto(origin);
  await page.evaluate((s) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify(s));
  }, session);
}

async function shoot(page, path, name) {
  await page.goto(path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200); // let images and the map settle
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}.png`);
}

const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });

try {
  // --- the member's app --------------------------------------------------
  const member = await signIn('runner7@mvmnt.test');
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const phonePage = await phone.newPage();
  await seedSession(phonePage, MOBILE, member);

  // A fresh browser context counts as a first open, so the welcome modal is up
  // and covering the home screen — which made the README's flagship shot a
  // picture of a dialog. Dismiss it before anything is captured.
  await phonePage.goto(MOBILE, { waitUntil: 'networkidle' });
  await phonePage.waitForTimeout(1500);
  const welcomeModal = phonePage.getByRole('button', { name: 'Let\u2019s go' });
  if (await welcomeModal.isVisible().catch(() => false)) {
    await welcomeModal.click();
    await phonePage.waitForTimeout(800);
  }

  await shoot(phonePage, MOBILE, 'app-home');

  // The *next* run, not just any run with that title. The seed carries a year
  // of finished ones under the same names, and without the ordering this shot
  // was quietly of a run from last summer — check-in gone, route section gone,
  // "This run has finished" where the interesting half of the screen should be.
  const runId = await (
    await fetch(
      `${API}/rest/v1/runs?select=id&status=eq.published&order=starts_at.asc&limit=1`,
      { headers: { apikey: ANON, Authorization: `Bearer ${member.access_token}` } },
    )
  ).json();
  if (!runId[0]) throw new Error('no upcoming published run — run npm run db:reset');
  await shoot(phonePage, `${MOBILE}/run/${runId[0].id}`, 'app-run-detail');
  await shoot(phonePage, `${MOBILE}/leaderboard`, 'app-leaderboard');

  // The photo gallery, on the finished run whose gallery the seed publishes.
  const galleryRun = await (
    await fetch(`${API}/rest/v1/runs?select=id&title=eq.Last%20Saturday%206K&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${member.access_token}` },
    })
  ).json();
  if (galleryRun[0]) {
    await shoot(phonePage, `${MOBILE}/photos/${galleryRun[0].id}`, 'app-gallery');
  }

  // The friend code. The QR is live data, so the shot has to be taken from the
  // running app rather than mocked — which also means the countdown underneath
  // it is real, and that countdown is the whole safety argument.
  await shoot(phonePage, `${MOBILE}/friends/code`, 'app-friend-code');

  await shoot(phonePage, `${MOBILE}/shop`, 'app-shop');

  // The profile, scrolled to the badges — including any hidden one this member
  // has actually earned.
  await phonePage.goto(`${MOBILE}/profile`, { waitUntil: 'networkidle' });
  await phonePage.waitForTimeout(1500);
  await phonePage.screenshot({ path: `${OUT}/app-profile.png` });
  console.log('  app-profile.png');
  await phone.close();

  // --- the chest -----------------------------------------------------------
  // Its own context, because it fires for a member with an unclaimed tier and
  // claiming it is a one-way door — capturing it in the main session would
  // consume the seed's only demoable chest before the other shots are taken.
  const chestMember = await signIn('runner9@mvmnt.test');
  const chestPhone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const chestPage = await chestPhone.newPage();
  await seedSession(chestPage, MOBILE, chestMember);
  await chestPage.goto(MOBILE, { waitUntil: 'networkidle' });
  await chestPage.waitForTimeout(2500);

  // The welcome modal shows once on a fresh profile and would cover the chest.
  const welcome = chestPage.getByRole('button', { name: 'Let’s go' });
  if (await welcome.isVisible().catch(() => false)) {
    await welcome.click();
    await chestPage.waitForTimeout(700);
  }
  if (await chestPage.getByText('Tap to open').isVisible().catch(() => false)) {
    await chestPage.getByText('🎁').click();
    await chestPage.waitForTimeout(1100);
    await chestPage.screenshot({ path: `${OUT}/app-chest.png` });
    console.log('  app-chest.png');
  } else {
    console.log('  app-chest.png SKIPPED — no unclaimed tier; run npm run db:reset first');
  }
  await chestPhone.close();

  // --- the organiser's console -------------------------------------------
  const organiser = await signIn('organiser@mvmnt.test');
  const desktop = await browser.newContext({
    viewport: { width: 1180, height: 900 },
    deviceScaleFactor: 2,
  });
  const desktopPage = await desktop.newPage();
  await seedSession(desktopPage, ADMIN, organiser);

  await shoot(desktopPage, ADMIN, 'admin-runs');

  // The members directory — organiser-only, and the screen that answers "who is
  // this person and what have they done".
  await desktopPage.getByRole('button', { name: 'Members', exact: true }).click();
  await desktopPage.waitForTimeout(1400);
  await desktopPage.screenshot({ path: `${OUT}/admin-members.png` });
  console.log('  admin-members.png');

  // The shop from the club's side: the order queue is the top half because an
  // organiser standing at a run with a box of shirts needs that, not the
  // catalogue editor.
  await desktopPage.getByRole('button', { name: 'Merch', exact: true }).click();
  await desktopPage.waitForTimeout(1400);
  await desktopPage.screenshot({ path: `${OUT}/admin-merch.png` });
  console.log('  admin-merch.png');

  // The editor, scrolled to the map — the part worth showing.
  await desktopPage.goto(ADMIN, { waitUntil: 'networkidle' });
  await desktopPage.getByRole('button', { name: 'Edit' }).first().click();
  await desktopPage.waitForTimeout(2500);
  await desktopPage.getByText('Where do you meet?').scrollIntoViewIfNeeded();
  await desktopPage.waitForTimeout(1500);
  await desktopPage.screenshot({ path: `${OUT}/admin-editor.png` });
  console.log('  admin-editor.png');

  // The route drawer, on the published run — that is the one the seed draws a
  // route on, and the publish control only appears once the run itself is out.
  await desktopPage.goto(ADMIN, { waitUntil: 'networkidle' });
  await desktopPage
    .locator('.card', { hasText: 'Saturday 6K' })
    .first()
    .getByRole('button', { name: 'Edit' })
    .click();
  await desktopPage.waitForTimeout(2500);
  // scrollIntoView rather than Playwright's if-needed variant: the drawer sits
  // low in a long card and 'centre' is what actually frames it.
  await desktopPage
    .getByText('The route', { exact: true })
    .evaluate((el) => el.scrollIntoView({ block: 'center' }));
  // Tiles come from OpenStreetMap over the network, so this one needs longer
  // than a layout settle — an empty grey map is a screenshot of nothing.
  await desktopPage.waitForTimeout(3000);
  await desktopPage.screenshot({ path: `${OUT}/admin-route.png` });
  console.log('  admin-route.png');

  await desktop.close();
} finally {
  await browser.close();
}

console.log(`\nWrote screenshots to ${OUT}/`);
