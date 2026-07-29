/**
 * Every screen must be reachable from inside the app.
 *
 *   npm run check:reachable
 *
 * WHY
 *
 * A published photo gallery was permitted, correct, tested — and unreachable.
 * The only route to it was a push notification the club cannot send yet, so a
 * feature the owner had switched on could not be opened by anybody. No test
 * caught it because every test navigated by URL, which is exactly the thing a
 * member cannot do.
 *
 * This walks the expo-router file tree and, for each route, looks for somewhere
 * in the source that actually navigates there. A tab counts. A `router.push`
 * counts. A `<Link href>` counts. Nothing else does — and a route with no
 * inbound navigation fails the check, because that is the bug.
 *
 * Deliberately a grep, not a graph. It cannot prove a path is *usable* (the
 * gallery link could be behind a condition that never fires) — it proves a path
 * was written, which is the difference between an oversight and a decision. The
 * e2e suite covers usability for the flows that matter.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const APP_DIR = 'apps/mobile/app';
const SOURCE_DIRS = ['apps/mobile/app', 'apps/mobile/src'];

/** Routes that are entered by the framework or the OS, not by our navigation. */
const ENTRY_POINTS = new Set([
  'index', // the app's own front door
  'sign-in', // the auth redirect in _layout
  '(tabs)/index', // the tab bar's first screen
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** `apps/mobile/app/photos/[runId].tsx` → `photos/[runId]` */
function toRoute(file) {
  return relative(APP_DIR, file).replace(/\.tsx$/, '');
}

const files = walk(APP_DIR);
const routes = files
  .map(toRoute)
  .filter((r) => !r.endsWith('_layout'))
  .filter((r) => !ENTRY_POINTS.has(r));

// Every line of app source, to search for navigation.
const haystack = SOURCE_DIRS.flatMap((d) => walk(d))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/** The strings that would navigate to this route, in any of our styles. */
function navigationPatterns(route) {
  // Group segments — (tabs) — are invisible in URLs.
  let url = route.replace(/\([^)]+\)\//g, '');
  const patterns = [`'/${url}'`, `"/${url}"`, `\`/${url}\``];

  // An index route is served at its parent path: friends/index → /friends.
  if (url.endsWith('/index')) {
    const parent = url.slice(0, -'/index'.length);
    patterns.push(`'/${parent}'`, `"/${parent}"`, `\`/${parent}\``);
    url = parent;
  }

  // A dynamic route is navigated with a template literal: /run/${id}
  const dynamic = url.replace(/\[[^\]]+\]/g, '${');
  if (dynamic !== url) patterns.push(`\`/${dynamic}`);

  // Tabs are declared by name rather than path.
  const leaf = url.split('/').pop();
  if (route.startsWith('(tabs)/')) {
    patterns.push(`name="${leaf}"`);
  }
  return patterns;
}

const unreachable = routes.filter((route) =>
  !navigationPatterns(route).some((p) => haystack.includes(p)),
);

if (unreachable.length > 0) {
  console.error('\nScreens nothing navigates to:\n');
  for (const route of unreachable) {
    console.error(`  ${route}`);
    console.error(`      nothing in the app pushes, links or tabs to /${route.replace(/\([^)]+\)\//g, '')}`);
  }
  console.error(
    '\nA screen with no way in is the shape of the unreachable-gallery bug.\n' +
      'Add the navigation, make it a tab, or delete the screen.\n',
  );
  process.exit(1);
}

console.log(`Every screen is reachable (${routes.length} routes checked).`);
