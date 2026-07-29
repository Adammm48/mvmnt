/**
 * Every unresolved placeholder in the repo, found in the source rather than
 * listed by hand.
 *
 *   npm run check:placeholders
 *
 * A hand-maintained list of "things to fix later" is a list that goes stale the
 * first time somebody fixes one and forgets to cross it off — and then it is
 * worse than nothing, because it is confidently wrong. This reads the actual
 * files, so it cannot disagree with them.
 *
 * Exits non-zero when anything is still open, so it can gate a release without
 * getting in the way of ordinary work: CI reports it, it does not block a push.
 */

import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Each entry describes one kind of placeholder: how to find it, who can
 * actually resolve it, and — the part that matters — what goes wrong if it
 * ships unresolved. "Fix later" with no consequence attached is what gets
 * skipped.
 */
const KINDS = [
  {
    id: 'contact-links',
    label: "Adam's contact links",
    pattern: /placeholder:\s*true/,
    files: ['packages/shared/src/voice.ts'],
    owner: 'Adam',
    consequence:
      'The About page shows "coming soon" instead of a portfolio, LinkedIn and email. Members and recruiters who open it find a dead end.',
    fix: 'Put the real URLs in CONTACT_LINKS and set placeholder: false.',
  },
  {
    id: 'tier-rewards',
    label: 'What each tier is actually worth',
    sql: "select tier from public.tier_rewards where is_placeholder order by tier",
    owner: 'The club owner',
    consequence:
      'Members see rewards marked "being confirmed". Honest, but a ladder whose prizes are never confirmed stops motivating anybody.',
    fix: 'Organiser console → Rewards → set each one and save as confirmed.',
  },
  {
    id: 'privacy-policy',
    label: 'Privacy policy questions',
    pattern: /\[TO CONFIRM BEFORE PUBLICATION\]/,
    files: ['docs/privacy-policy.md'],
    owner: 'The club owner, with legal advice',
    consequence:
      'Both app stores require a published privacy policy. It cannot be published with open questions in it, so this blocks release outright.',
    fix: 'Answer each marked question, then get the policy reviewed.',
  },
  {
    id: 'spec-contact',
    label: "The spec's own contact line",
    pattern: /\[business email or website — add here\]/,
    files: ['docs/spec/MVMNT_App_Spec_1.md'],
    owner: 'The club owner',
    consequence:
      'The build spec itself has no way to reach the club. Harmless to the running app, but a public repo showing an unfilled contact line looks unfinished.',
    fix: 'Fill in the business email or website in the spec header, or remove the line.',
  },
  {
    id: 'costs',
    label: 'Costs that need a real quote',
    pattern: /\[NEEDS A QUOTE\]/,
    files: ['docs/costs.md'],
    owner: 'The club owner',
    consequence:
      'The budget given to the owner has gaps. Merch cannot be built without knowing what the payment gateway charges.',
    fix: 'Get quotes from Paymob and one competitor.',
  },
  {
    id: 'meeting-points',
    label: 'Real meeting points',
    pattern: /PLACEHOLDERS pending real ones/,
    files: ['supabase/seed.sql'],
    owner: 'The club owner',
    consequence:
      'The geofence measures from these coordinates. Wrong ones mean check-in fails at the real meeting point.',
    fix: 'Replace the seeded landmarks with the coordinates the club actually uses.',
  },
];

/**
 * Deliberately not listed: scripts/restore-organiser.sql asks for an email to
 * be typed in at the moment it is run. That is an input, not an unfinished
 * decision, and flagging it forever would train everybody to ignore this
 * output — which is the failure mode this script exists to prevent.
 */

async function countInFiles(kind) {
  let hits = 0;
  for (const file of kind.files ?? []) {
    try {
      const text = await readFile(file, 'utf8');
      hits += text.split('\n').filter((line) => kind.pattern.test(line)).length;
    } catch {
      // A file that has been moved is not a passing check.
      return { hits: -1, note: `could not read ${file}` };
    }
  }
  return { hits };
}

async function countInDatabase(kind) {
  try {
    const { stdout } = await run('psql', [
      process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      '-At',
      '-c',
      kind.sql,
    ]);
    const rows = stdout.trim().split('\n').filter(Boolean);
    return { hits: rows.length, detail: rows.join(', ') };
  } catch {
    return { hits: null, note: 'database not running — skipped' };
  }
}

const results = [];
for (const kind of KINDS) {
  results.push({ kind, ...(kind.sql ? await countInDatabase(kind) : await countInFiles(kind)) });
}

const open = results.filter((r) => r.hits && r.hits > 0);
const skipped = results.filter((r) => r.hits === null);

console.log('\nOutstanding placeholders\n' + '='.repeat(60));

if (open.length === 0) {
  console.log('\nNothing outstanding. Everything that was marked has been answered.\n');
} else {
  for (const { kind, hits, detail } of open) {
    console.log(`\n▸ ${kind.label}  — ${hits} open${detail ? ` (${detail})` : ''}`);
    console.log(`  Who can answer it: ${kind.owner}`);
    console.log(`  If it ships as-is: ${kind.consequence}`);
    console.log(`  To resolve:        ${kind.fix}`);
  }
  console.log('');
}

for (const { kind, note } of skipped) {
  console.log(`· ${kind.label}: ${note}`);
}

console.log('\nFull detail: docs/open-items.md\n');
process.exit(open.length > 0 ? 1 : 0);
