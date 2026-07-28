import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { toMemberMessage } from '@mvmnt/shared';
import { useToast } from './Toast';

/**
 * The two organiser actions that are about a member rather than a run.
 *
 * They live on the run-day attendee list because that is where an organiser
 * actually encounters a member: a complaint about unwanted friend adds and a
 * dispute about points both surface at a run, from someone standing in front of
 * you. A separate members directory would be the obvious home, and would also
 * be the one screen in this app that lets an organiser browse the membership —
 * which App Spec §4.4 spent the whole friends design avoiding.
 */
export function MemberModeration({
  userId,
  displayName,
  onDone,
}: {
  userId: string;
  displayName: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');

  async function disableCode() {
    const ok = window.confirm(
      `Disable ${displayName}'s friend code?\n\nEvery code they have shown stops working immediately, ` +
        `so nobody can add them from one. Friendships they already have are untouched, and they can ` +
        `show a fresh code themselves whenever they want.\n\nThis is recorded in the audit log.`,
    );
    if (!ok) return;

    setBusy(true);
    const { error } = await supabase.rpc('admin_disable_member_qr', { p_user_id: userId });
    setBusy(false);

    if (error) {
      toast.error("Couldn't disable that code", toMemberMessage(error));
      return;
    }
    toast.success(`${displayName}'s friend code is off`, 'Their existing friendships are unchanged.');
    onDone();
  }

  async function adjustPoints() {
    const amount = Number.parseInt(points, 10);
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error('Enter an amount', 'A positive number adds points, a negative one takes them away.');
      return;
    }
    // The database requires a reason too. Checking here as well means the
    // organiser is told before the round trip rather than by a raised exception.
    if (note.trim().length === 0) {
      toast.error('Say why', 'A correction with no reason is impossible to explain six months later.');
      return;
    }

    setBusy(true);
    const { error } = await supabase.rpc('admin_adjust_points', {
      p_user_id: userId,
      p_points: amount,
      p_note: note.trim(),
    });
    setBusy(false);

    if (error) {
      toast.error("Couldn't adjust their points", toMemberMessage(error));
      return;
    }
    toast.success(
      `${amount > 0 ? '+' : ''}${amount} points for ${displayName}`,
      'Recorded as an organiser adjustment, with your note.',
    );
    setPoints('');
    setNote('');
    onDone();
  }

  return (
    <div className="card" style={{ marginTop: 0, background: 'var(--sunken)' }}>
      <div className="row">
        <strong>{displayName}</strong>
        <button className="link" onClick={onDone}>
          Close
        </button>
      </div>

      <div className="field" style={{ marginTop: 14 }}>
        <label>Friend code</label>
        <div className="hint">
          If they have reported that someone is adding them without consent, turning the code off
          stops any code already in circulation.
        </div>
        <button className="danger" onClick={disableCode} disabled={busy} style={{ marginTop: 8 }}>
          Disable their friend code
        </button>
      </div>

      <div className="field">
        <label htmlFor={`points-${userId}`}>Points correction</label>
        <div className="hint">
          For settling a dispute — a check-in that was missed, or one that should not have counted.
          Positive adds, negative removes.
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
    </div>
  );
}
