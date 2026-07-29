import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toMemberMessage, TIER_LABEL, type Database } from '@mvmnt/shared';
import { MemberDetail } from '../components/MemberDetail';

type Member = Database['public']['Functions']['admin_members']['Returns'][number];

/**
 * The members directory.
 *
 * Organiser-only, and the only screen in MVMNT that lists the whole membership.
 * The member-facing app has no equivalent and must not grow one: App Spec §4.4
 * makes QR-only friend adding a safety measure, and a searchable directory in
 * the app would make that worthless.
 *
 * Everything here an organiser could already assemble by hand from the run-day
 * lists, one run at a time. What it adds is reaching somebody who is *not* on
 * today's run — which is the case a complaint usually arrives as.
 */
export function Members() {
  const [search, setSearch] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async (term: string) => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_members', {
      p_search: term.trim() || undefined,
      p_limit: 200,
    });

    if (rpcError) setError(toMemberMessage(rpcError));
    else setMembers(data ?? []);
    setLoading(false);
  }, []);

  // Debounced, because this searches every member on every keystroke otherwise.
  useEffect(() => {
    const timer = setTimeout(() => load(search), 250);
    return () => clearTimeout(timer);
  }, [search, load]);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Members</h2>
          <p className="subtitle">
            Everyone who has signed up. Search by name or email.
          </p>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}

      <div className="card">
        <div className="field">
          <label htmlFor="member-search">Find a member</label>
          <input
            id="member-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or email"
            autoComplete="off"
          />
          <div className="hint">
            This list is for organisers. Members cannot search or browse each other — they can only
            add a friend by scanning a code in person.
          </div>
        </div>

        {loading ? (
          <p>Loading…</p>
        ) : members.length === 0 ? (
          <div className="empty">
            {search.trim() ? 'Nobody matches that.' : 'No members yet.'}
          </div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th style={{ textAlign: 'right' }}>Points</th>
                  <th style={{ textAlign: 'right' }}>Runs</th>
                  <th>Last run</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td>
                      {m.display_name}
                      {m.role === 'admin' && <span className="pill" style={{ marginLeft: 8 }}>organiser</span>}
                      {/*
                        Shown because it explains a member's absence from the
                        board. Without it an organiser fielding "why am I not
                        listed?" has no way to see that the member turned
                        themselves off.
                      */}
                      {m.leaderboard_opt_out && (
                        <span className="pill" style={{ marginLeft: 8 }}>off the board</span>
                      )}
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>{m.email}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {m.points.toLocaleString()}
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {TIER_LABEL[m.tier]}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {m.runs_attended}
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                      {m.last_run_at
                        ? new Date(m.last_run_at).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })
                        : 'Never'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="link"
                        onClick={() => setOpenId(openId === m.user_id ? null : m.user_id)}
                      >
                        {openId === m.user_id ? 'Close' : 'Manage'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openId && (
        <MemberDetail
          userId={openId}
          onChanged={() => load(search)}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
