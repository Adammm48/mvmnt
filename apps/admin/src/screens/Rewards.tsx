import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  toMemberMessage,
  TIER_FLOOR,
  TIER_LABEL,
  TIER_ORDER,
  type MemberTier,
  type TierReward,
} from '@mvmnt/shared';
import { useToast } from '../components/Toast';

/**
 * What each tier is worth.
 *
 * Editable here rather than hardcoded because these will change — a sponsor
 * offers something, a trial does not work, Legend gets argued about for a
 * month. Every one of those is a text edit, and a text edit that needs a
 * developer and an App Store review is a text edit that does not happen.
 *
 * "Still deciding" is a real state, not a nicety. A placeholder that reads like
 * a firm offer is a promise the club has not agreed to make, and members will
 * hold them to it.
 */
export function Rewards() {
  const toast = useToast();
  const [rewards, setRewards] = useState<Record<string, TierReward>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<MemberTier | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('tier_rewards').select('*');
    if (error) {
      toast.error("Couldn't load the rewards", toMemberMessage(error));
      return;
    }
    const byTier = Object.fromEntries((data ?? []).map((r) => [r.tier, r]));
    setRewards(byTier);
    setDrafts(Object.fromEntries((data ?? []).map((r) => [r.tier, r.reward])));
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(tier: MemberTier, confirmed: boolean) {
    const reward = (drafts[tier] ?? '').trim();
    if (!reward) {
      toast.error('Say what it is worth', 'A tier with a blank reward tells a member nothing.');
      return;
    }

    setBusy(tier);
    const { error } = await supabase.rpc('admin_set_tier_reward', {
      p_tier: tier,
      p_reward: reward,
      p_is_placeholder: !confirmed,
    });
    setBusy(null);

    if (error) {
      toast.error("Couldn't save that", toMemberMessage(error));
      return;
    }
    toast.success(
      `${TIER_LABEL[tier]} updated`,
      confirmed ? 'Members see this as a firm offer.' : 'Members see this marked "being confirmed".',
    );
    await load();
  }

  if (loading) return <p>Loading…</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Tier rewards</h2>
          <p className="subtitle">
            What a member gets for reaching each tier. Members see all five, so they know what they
            are working towards.
          </p>
        </div>
      </div>

      <div className="notice info">
        Nothing here is redeemed by the app — it is a promise the club keeps in person. Changes are
        live for members immediately, and each one is recorded in the audit log.
      </div>

      {TIER_ORDER.map((tier) => {
        const current = rewards[tier];
        return (
          <div className="card" key={tier}>
            <div className="row">
              <div>
                <strong style={{ fontSize: 17 }}>{TIER_LABEL[tier]}</strong>
                <div className="subtitle" style={{ fontSize: 13 }}>
                  {TIER_FLOOR[tier] === 0
                    ? 'Where everybody starts'
                    : `Reached at ${TIER_FLOOR[tier]} points`}
                </div>
              </div>
              {current?.is_placeholder && <span className="pill">still deciding</span>}
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor={`reward-${tier}`}>The reward</label>
              <input
                id={`reward-${tier}`}
                value={drafts[tier] ?? ''}
                onChange={(e) => setDrafts({ ...drafts, [tier]: e.target.value })}
                placeholder="e.g. a free club shirt"
                maxLength={120}
              />
              <div className="inline" style={{ marginTop: 10 }}>
                <button
                  className="primary"
                  onClick={() => save(tier, true)}
                  disabled={busy === tier}
                >
                  Save as confirmed
                </button>
                <button onClick={() => save(tier, false)} disabled={busy === tier}>
                  Save as still deciding
                </button>
              </div>
              <div className="hint">
                &ldquo;Still deciding&rdquo; shows members the idea without promising it. Use it
                until the club has actually agreed.
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
