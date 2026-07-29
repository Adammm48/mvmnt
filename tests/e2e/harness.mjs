/**
 * The end-to-end harness.
 *
 * WHY THIS EXISTS
 *
 * Every silent-failure bug in this project's history was found by a human
 * using the app, never by a test — four platform calls that did nothing on
 * web, notification taps that opened nothing, a published gallery with no
 * route to it, dead sign-in buttons. The database suites are thorough and
 * caught none of them, because they assert that a function returned; the bugs
 * were all "the code ran and the member was told nothing".
 *
 * So these tests assert the opposite thing: what is ON SCREEN after an action.
 * Every check in this suite is a question a member could answer by looking.
 *
 * No new dependency: `playwright` is already here for the screenshots, and the
 * runner below is thirty lines rather than a test framework. The SQL suites
 * are hand-rolled assertions too — this matches.
 */

import { chromium } from 'playwright';

export const API = 'http://127.0.0.1:54321';
export const MAIL = 'http://127.0.0.1:54324';
export const MOBILE = 'http://127.0.0.1:8081';
export const ADMIN = 'http://127.0.0.1:5173';

/** Local demo key, identical on every machine. Never a real credential. */
export const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

/**
 * Sign in through the real OTP flow, reading the code from the mail catcher.
 *
 * Cached per email for the life of the run. The local auth config allows two
 * sign-in emails an HOUR (config.toml, `email_sent`), and a suite that signs
 * the same member in for every block silently runs the later blocks with no
 * session at all — which looks exactly like a broken app. One sign-in per
 * member, reused.
 */
const sessions = new Map();

export async function signIn(email) {
  const cached = sessions.get(email);
  if (cached) return cached;
  const fresh = await requestSession(email);
  sessions.set(email, fresh);
  return fresh;
}

async function requestSession(email) {
  await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' });
  await fetch(`${API}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, create_user: false }),
  });

  let code = null;
  for (let attempt = 0; attempt < 40 && !code; attempt++) {
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

export async function rest(path, session) {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}` },
  });
  return res.json();
}

/**
 * A phone-sized page, signed in, past the first-open dialogs.
 *
 * The consent gate and welcome modal appear on every fresh browser context and
 * have silently eaten clicks in three separate throwaway scripts this project
 * has written. Handled once, here.
 */
export async function openApp(browser, email, { width = 390, height = 844 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  const session = await signIn(email);
  await page.goto(MOBILE);
  await page.evaluate((s) => localStorage.setItem('sb-127-auth-token', JSON.stringify(s)), session);
  await page.goto(MOBILE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  if (await page.getByText('Before you start').isVisible().catch(() => false)) {
    await page.getByText('I am 18 or over').click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Agree and continue' }).click();
    await page.waitForTimeout(1800);
  }
  const welcome = page.getByRole('button', { name: 'Let’s go' });
  if (await welcome.isVisible().catch(() => false)) {
    await welcome.click();
    await page.waitForTimeout(700);
  }

  return { context, page, session, consoleErrors };
}

/** A desktop-sized console page, signed in as an organiser. */
export async function openConsole(browser, email = 'organiser@mvmnt.test') {
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  const session = await signIn(email);
  await page.goto(ADMIN);
  await page.evaluate((s) => localStorage.setItem('sb-127-auth-token', JSON.stringify(s)), session);
  await page.goto(ADMIN, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  return { context, page, session, consoleErrors };
}

// ---------------------------------------------------------------------------
// Assertions. Deliberately few and deliberately about the screen.
// ---------------------------------------------------------------------------

const results = [];

/**
 * The core assertion: this text is visible to the member.
 *
 * `seen` rather than `ok` because that is the whole point — not "the call
 * succeeded" but "a person looking at the phone can read this".
 */
export async function seen(page, text, description, { timeout = 8000 } = {}) {
  const locator =
    typeof text === 'string' || text instanceof RegExp ? page.getByText(text) : text;
  let visible = false;
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    visible = true;
  } catch {
    visible = false;
  }
  // A failing assertion that will not say what WAS on screen is the same
  // species of unhelpfulness this whole suite exists to stamp out. Capture it.
  const context = visible ? null : await visibleText(page);
  results.push({ pass: visible, description, context });
  return visible;
}

/** What a person would actually read on this screen right now, trimmed. */
async function visibleText(page) {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    return text.replace(/\n{2,}/g, '\n').trim().slice(0, 400);
  } catch {
    return '(the page was closed or navigated away)';
  }
}

/** The opposite: this must NOT be on screen (stale success, dead control). */
export async function notSeen(page, text, description, { timeout = 2000 } = {}) {
  const locator =
    typeof text === 'string' || text instanceof RegExp ? page.getByText(text) : text;
  let visible = true;
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    visible = true;
  } catch {
    visible = false;
  }
  results.push({ pass: !visible, description });
  return !visible;
}

export function check(condition, description) {
  results.push({ pass: !!condition, description });
  return !!condition;
}

export function record(pass, description) {
  results.push({ pass, description });
}

export function report(suiteName) {
  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`    ${r.pass ? 'ok  ' : 'FAIL'}  ${r.description}`);
    if (!r.pass && r.context) {
      console.log('          on screen instead:');
      for (const line of r.context.split('\n').slice(0, 8)) {
        console.log(`            ${line}`);
      }
    }
  }
  console.log(
    `  ${suiteName}: ${results.length - failed.length}/${results.length} assertions passed`,
  );
  return failed.length === 0;
}

export { chromium };
