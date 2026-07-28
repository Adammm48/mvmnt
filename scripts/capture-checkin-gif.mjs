/**
 * Record the check-in flow as frames for the README animation.
 *
 *   node scripts/capture-checkin-gif.mjs
 *   python3 scripts/frames-to-gif.py
 *
 * Two steps because the ffmpeg available here is a stripped build with no image
 * decoders; Pillow assembles the GIF instead. Split so each half is easy to
 * re-run on its own.
 *
 * This drives the real app against the real database — the check-in it performs
 * is a genuine one, written to run_attendance with location evidence.
 */

import { chromium } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';

const API = 'http://127.0.0.1:54321';
const MAIL = 'http://127.0.0.1:54324';
const MOBILE = 'http://127.0.0.1:8081';
const FRAMES = 'docs/screenshots/.frames';

const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

async function signIn(email) {
  await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' });
  await fetch(`${API}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, create_user: false }),
  });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const list = await (await fetch(`${MAIL}/api/v1/messages?limit=1`)).json();
    const id = list.messages?.[0]?.ID;
    if (!id) continue;
    const msg = await (await fetch(`${MAIL}/api/v1/message/${id}`)).json();
    const code = `${msg.Text ?? ''}${msg.HTML ?? ''}`.match(/\b(\d{6})\b/)?.[1];
    if (!code) continue;
    const session = await (
      await fetch(`${API}/auth/v1/verify`, {
        method: 'POST',
        headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token: code, type: 'email' }),
      })
    ).json();
    if (session.access_token) return session;
  }
  throw new Error('sign-in failed');
}

await rm(FRAMES, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });

const session = await signIn('runner7@mvmnt.test');
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

await page.goto(MOBILE);
await page.evaluate((s) => localStorage.setItem('sb-127-auth-token', JSON.stringify(s)), session);

let n = 0;
const frame = async () => page.screenshot({ path: `${FRAMES}/${String(n++).padStart(3, '0')}.png` });
const hold = async (count) => {
  for (let i = 0; i < count; i++) await frame();
};

// 1. Home — the run list.
await page.goto(MOBILE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await hold(6);

// 2. Open the run that is happening now.
await page.getByRole('button', { name: /Saturday 6K/ }).first().click();
await page.waitForTimeout(1200);
await hold(5);

// 3. Tap check in, then capture the celebration densely — the confetti only
//    lasts about a second, so frames are taken as fast as the page renders.
await page.getByRole('button', { name: 'Check in', exact: true }).click();
for (let i = 0; i < 22; i++) {
  await frame();
  await page.waitForTimeout(60);
}
await hold(10);

await browser.close();
console.log(`captured ${n} frames to ${FRAMES}`);
