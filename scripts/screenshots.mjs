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

  await shoot(phonePage, MOBILE, 'app-home');

  const runId = await (
    await fetch(`${API}/rest/v1/runs?select=id&title=eq.Saturday%206K`, {
      headers: { apikey: ANON, Authorization: `Bearer ${member.access_token}` },
    })
  ).json();
  await shoot(phonePage, `${MOBILE}/run/${runId[0].id}`, 'app-run-detail');
  await shoot(phonePage, `${MOBILE}/leaderboard`, 'app-leaderboard');

  // The friend code. The QR is live data, so the shot has to be taken from the
  // running app rather than mocked — which also means the countdown underneath
  // it is real, and that countdown is the whole safety argument.
  await shoot(phonePage, `${MOBILE}/friends/code`, 'app-friend-code');
  await phone.close();

  // --- the organiser's console -------------------------------------------
  const organiser = await signIn('organiser@mvmnt.test');
  const desktop = await browser.newContext({
    viewport: { width: 1180, height: 900 },
    deviceScaleFactor: 2,
  });
  const desktopPage = await desktop.newPage();
  await seedSession(desktopPage, ADMIN, organiser);

  await shoot(desktopPage, ADMIN, 'admin-runs');

  // The editor, scrolled to the map — the part worth showing.
  await desktopPage.goto(ADMIN, { waitUntil: 'networkidle' });
  await desktopPage.getByRole('button', { name: 'Edit' }).first().click();
  await desktopPage.waitForTimeout(2500);
  await desktopPage.getByText('Where do you meet?').scrollIntoViewIfNeeded();
  await desktopPage.waitForTimeout(1500);
  await desktopPage.screenshot({ path: `${OUT}/admin-editor.png` });
  console.log('  admin-editor.png');

  await desktop.close();
} finally {
  await browser.close();
}

console.log(`\nWrote screenshots to ${OUT}/`);
