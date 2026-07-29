import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  formatRunDate,
  toMemberMessage,
  describePointKind,
  TIER_LABEL,
  type MemberTier,
} from '@mvmnt/shared';
import { useToast } from './Toast';
import { useConfirm } from './Confirm';

/**
 * Everything the database knows about one member.
 *
 * The owner's instruction (2026-07-29) was "the organiser has all the trust —
 * don't hide anything from him", so this holds nothing back: their friends by
 * name, every point they have earned and whether it still counts, every
 * notification the club has sent them, and every organiser action ever taken on
 * their account.
 *
 * The last of those is the one that matters most. An audit log nobody can read
 * is a log that exists to be pointed at rather than used — so it is on screen,
 * next to the buttons that write to it.
 */

type Detail = {
  profile: {
    user_id: string;
    display_name: string;
    email: string;
    role: 'member' | 'admin';
    is_founder: boolean;
    joined_at: string;
    leaderboard_opt_out: boolean;
    points: number;
    tier: MemberTier;
    runs_attended: number;
    streak_weeks: number;
  };
  badges: { key: string; label: string; earned_at: string }[];
  friends: { user_id: string; display_name: string; since: string; they_initiated: boolean }[];
  friend_code: { active: boolean; shown_count: number };
  devices: { platform: string; last_seen_at: string }[];
  recent_runs: {
    run_id: string;
    title: string;
    starts_at: string;
    state: string | null;
    check_in_method: string | null;
    has_location_evidence: boolean;
  }[];
  points_ledger: {
    kind: string;
    points: number;
    source: string;
    note: string | null;
    awarded_at: string;
    still_counting: boolean;
  }[];
  notifications: { title: string; type: string; status: string; created_at: string }[];
  admin_actions: { action: string; at: string; by: string | null; metadata: unknown }[];
};

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function MemberDetail({
  userId,
  onChanged,
  onClose,
}: {
  userId: string;
  /** Called after anything that changes what the directory row should say. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_member_detail', { p_user_id: userId });
    if (error) {
      toast.error("Couldn't load that member", toMemberMessage(error));
      return;
    }
    setDetail(data as unknown as Detail);
  }, [userId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (!detail?.profile) {
    return (
      <div className="modal-backdrop drawer-backdrop" onClick={onClose}>
        <div className="drawer" onClick={(e) => e.stopPropagation()}>
          Loading…
        </div>
      </div>
    );
  }
  const p = detail.profile;

  // PromiseLike, not Promise: supabase-js returns a thenable query builder that
  // only becomes a real Promise when awaited.
  async function run(label: string, fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      toast.error(`${label} didn't work`, toMemberMessage(error));
      return false;
    }
    await load();
    onChanged();
    return true;
  }

  async function disableCode() {
    const ok = await confirm({
      title: `Disable ${p.display_name}'s friend code?`,
      message:
        'Every code they have shown stops working immediately. Friendships they already have are ' +
        'untouched — and they can show a fresh code straight afterwards, so this stops a code that ' +
        'is circulating right now rather than stopping them adding friends.\n\n' +
        'Recorded in the audit log.',
      confirmLabel: 'Disable the code',
      tone: 'danger',
    });
    if (!ok) return;
    if (await run('Disabling the code', () =>
      supabase.rpc('admin_disable_member_qr', { p_user_id: userId }),
    )) {
      toast.success(`${p.display_name}'s friend code is off`);
    }
  }

  async function adjustPoints() {
    const amount = Number.parseInt(points, 10);
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error('Enter an amount', 'Positive adds points, negative takes them away.');
      return;
    }
    // The database requires a reason too. Checking here as well means the
    // organiser is told before the round trip rather than by a raised exception.
    if (!note.trim()) {
      toast.error('Say why', 'A correction with no reason is impossible to explain six months later.');
      return;
    }
    if (await run('The adjustment', () =>
      supabase.rpc('admin_adjust_points', {
        p_user_id: userId,
        p_points: amount,
        p_note: note.trim(),
      }),
    )) {
      toast.success(`${amount > 0 ? '+' : ''}${amount} points for ${p.display_name}`);
      setPoints('');
      setNote('');
    }
  }

  async function setRole(role: 'admin' | 'member') {
    const ok = await confirm({
      title:
        role === 'admin'
          ? `Make ${p.display_name} an organiser?`
          : `Remove ${p.display_name} as an organiser?`,
      message:
        role === 'admin'
          ? 'They will be able to create and cancel runs, check people in, see every member, ' +
            'correct points, and make other people organisers too.\n\n' +
            'There is one level of organiser — there is no limited version.'
          : 'They go back to being an ordinary member and lose access to this console. ' +
            'Their runs, points and history are untouched.',
      confirmLabel: role === 'admin' ? 'Make organiser' : 'Remove access',
      tone: role === 'admin' ? 'normal' : 'danger',
    });
    if (!ok) return;
    if (await run('That change', () =>
      supabase.rpc('admin_set_member_role', { p_user_id: userId, p_role: role }),
    )) {
      toast.success(
        role === 'admin' ? `${p.display_name} is now an organiser` : `${p.display_name} is a member again`,
      );
    }
  }

  return (
    <div
      className="modal-backdrop drawer-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${p.display_name} — full record`}
    >
      {/* stopPropagation so a click inside the drawer does not read as a click
          on the backdrop, which closes it. */}
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <strong style={{ fontSize: 17 }}>{p.display_name}</strong>
            {p.is_founder && <span className="pill" style={{ marginLeft: 8 }}>club owner</span>}
            {p.role === 'admin' && !p.is_founder && (
              <span className="pill" style={{ marginLeft: 8 }}>organiser</span>
            )}
            <div className="subtitle" style={{ fontSize: 13 }}>
              {p.email} · joined {shortDate(p.joined_at)}
            </div>
          </div>
          <div className="stats">
            <div>
              <div className="stat">{p.points.toLocaleString()}</div>
              <div className="stat-label">{TIER_LABEL[p.tier]}</div>
            </div>
            <div>
              <div className="stat">{p.runs_attended}</div>
              <div className="stat-label">Runs</div>
            </div>
            <div>
              <div className="stat">{p.streak_weeks}</div>
              <div className="stat-label">Week streak</div>
            </div>
            <button className="link" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <Section title="Recent runs">
          <MiniTable
            empty="They have never signed up for a run."
            rows={detail.recent_runs.map((r) => [
              r.title,
              formatRunDate(r.starts_at),
              r.state === 'checked_in'
                ? r.check_in_method === 'admin'
                  ? 'Checked in by an organiser'
                  : 'Checked in at the meeting point'
                : r.state === 'signed_up'
                  ? 'Signed up'
                  : r.state === 'waitlisted'
                    ? 'Waitlisted'
                    : 'Withdrew',
              // Coordinates are purged at 30 days, so a blank here on an older run
              // is the retention rule working rather than something missing.
              r.has_location_evidence ? 'Location on file' : '—',
            ])}
          />
        </Section>

        <Section title={`Points — ${p.points.toLocaleString()} counting`}>
          <MiniTable
            empty="No points yet."
            rows={detail.points_ledger.map((e) => [
              describePointKind(e.kind),
              `${e.points > 0 ? '+' : ''}${e.points}`,
              shortDate(e.awarded_at),
              // A revoked check-in leaves its ledger row in place and stops it
              // counting, so a total that looks short is explainable from here.
              e.still_counting ? (e.note ?? '') : 'No longer counts — check-in removed',
            ])}
          />
        </Section>

        <Section title={`Friends (${detail.friends.length})`}>
          <MiniTable
            empty="They have not added anyone."
            rows={detail.friends.map((f) => [
              f.display_name,
              f.they_initiated ? 'They scanned' : 'Was scanned',
              shortDate(f.since),
              '',
            ])}
          />
        </Section>

        {detail.badges.length > 0 && (
          <Section title="Badges">
            <MiniTable
              empty=""
              rows={detail.badges.map((b) => [b.label, shortDate(b.earned_at), '', ''])}
            />
          </Section>
        )}

        <Section title="Notifications sent">
          <MiniTable
            empty="Nothing has been sent to them yet."
            rows={detail.notifications.map((n) => [
              n.title,
              shortDate(n.created_at),
              n.status === 'skipped' ? 'No device registered' : n.status,
              '',
            ])}
          />
          <div className="hint">
            {detail.devices.length === 0
              ? 'No phone registered, so they receive nothing until they open the app and allow notifications.'
              : `${detail.devices.length} device${detail.devices.length === 1 ? '' : 's'} registered.`}
          </div>
        </Section>

        <Section title="Organiser actions on this account">
          <MiniTable
            empty="Nothing has been done to this account."
            rows={detail.admin_actions.map((a) => [
              a.action.replace(/_/g, ' '),
              shortDate(a.at),
              a.by ?? 'system',
              JSON.stringify(a.metadata) === '{}' ? '' : JSON.stringify(a.metadata),
            ])}
          />
        </Section>

        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '22px 0' }} />

        <div className="field">
          <label>Friend code</label>
          <div className="hint">
            {detail.friend_code.active
              ? 'They have a live code right now. Turning it off stops anyone using it.'
              : 'No live code at the moment — codes expire after three minutes on their own, so there may be nothing to turn off.'}{' '}
            Note that they can show a fresh code immediately afterwards; this stops a code that is
            circulating, not their ability to add friends.
          </div>
          <button className="danger" onClick={disableCode} disabled={busy} style={{ marginTop: 8 }}>
            Disable their friend code
          </button>
        </div>

        <div className="field">
          <label htmlFor={`points-${userId}`}>Points correction</label>
          <div className="hint">
            For settling a dispute — a check-in that was missed, or one that should not have counted.
          </div>
          <div className="inline" style={{ marginTop: 8 }}>
            <input
              id={`points-${userId}`}
              type="number"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder="e.g. 10"
              style={{ maxWidth: 110 }}
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why — this is kept on the record"
              style={{ flex: 1, minWidth: 220 }}
            />
            <button onClick={adjustPoints} disabled={busy}>
              Apply
            </button>
          </div>
        </div>

        <div className="field">
          <label>Organiser access</label>
          {p.is_founder ? (
            <div className="hint">
              This is the club owner&apos;s original account. It cannot be removed as an organiser by
              anyone — including itself — so there is always a guaranteed way into this console.
            </div>
          ) : (
            <>
              <div className="hint">
                There is one level of organiser. Anyone made an organiser can do everything you can,
                including making other people organisers.
              </div>
              <button
                className={p.role === 'admin' ? 'danger' : 'primary'}
                onClick={() => setRole(p.role === 'admin' ? 'member' : 'admin')}
                disabled={busy}
                style={{ marginTop: 8 }}
              >
                {p.role === 'admin' ? 'Remove as organiser' : 'Make organiser'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="field" style={{ marginTop: 20 }}>
      <label>{title}</label>
      {children}
    </div>
  );
}

/** Four columns, no header — these are lists to scan, not tables to compare. */
function MiniTable({ rows, empty }: { rows: (string | number)[][]; empty: string }) {
  if (rows.length === 0) {
    return <div className="hint">{empty}</div>;
  }
  return (
    <div className="scroll" style={{ maxHeight: 260, overflowY: 'auto' }}>
      <table>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((c, j) => (
                <td
                  key={j}
                  style={{
                    fontSize: 13,
                    color: j === 0 ? 'var(--text)' : 'var(--muted)',
                    fontWeight: j === 0 ? 600 : 400,
                  }}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
