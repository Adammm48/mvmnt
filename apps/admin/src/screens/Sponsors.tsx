import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toMemberMessage, type Database, SIGNATURE, CONTACT_LINKS } from '@mvmnt/shared';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

type Sponsor = Database['public']['Tables']['sponsors']['Row'];
type ReportRow = Database['public']['Functions']['admin_sponsor_report']['Returns'][number];

/**
 * Sponsors, their placements, and the numbers that go back to them.
 *
 * The reporting is the part that matters commercially, so the screen is
 * explicit about what the numbers mean. "Reach" here is distinct members, not
 * renders — a sponsor told "2,000 impressions" who later learns it was 300
 * people refreshing has been misled, and it is the club that has to have that
 * conversation.
 */
export function Sponsors() {
  const toast = useToast();
  const confirm = useConfirm();

  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [report, setReport] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [activeTo, setActiveTo] = useState('');
  const [busy, setBusy] = useState(false);

  const [shoutSponsor, setShoutSponsor] = useState<string | null>(null);
  const [shoutMessage, setShoutMessage] = useState('');

  const load = useCallback(async () => {
    const [list, rows] = await Promise.all([
      supabase.from('sponsors').select('*').order('created_at', { ascending: false }),
      supabase.rpc('admin_sponsor_report'),
    ]);
    if (list.error) toast.error("Couldn't load sponsors", toMemberMessage(list.error));
    setSponsors(list.data ?? []);
    setReport(rows.data ?? []);
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function addSponsor() {
    if (!name.trim()) {
      toast.error('Give it a name', 'Members see this, so it should be the sponsor’s real name.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.from('sponsors').insert({
      name: name.trim(),
      url: url.trim() || null,
      logo_url: logoUrl.trim() || null,
      active_to: activeTo || null,
    });
    setBusy(false);
    if (error) {
      toast.error("Couldn't add that sponsor", toMemberMessage(error));
      return;
    }
    toast.success(`${name.trim()} added`, 'Add a placement to start showing them.');
    setName('');
    setUrl('');
    setLogoUrl('');
    setActiveTo('');
    load();
  }

  async function addBanner(sponsor: Sponsor) {
    const { error } = await supabase
      .from('sponsor_placements')
      .insert({ sponsor_id: sponsor.id, type: 'home_banner' });
    if (error) {
      // The unique constraint is doing its job: a second identical banner would
      // double every number in this sponsor's report.
      toast.error(
        /duplicate|unique/i.test(error.message)
          ? 'They already have a home banner'
          : "Couldn't add that placement",
        /duplicate|unique/i.test(error.message) ? 'One per sponsor.' : toMemberMessage(error),
      );
      return;
    }
    toast.success('Home banner live', 'Members see it on their next app open.');
    load();
  }

  async function endSponsorship(sponsor: Sponsor) {
    const ok = await confirm({
      title: `End ${sponsor.name}'s sponsorship today?`,
      message:
        'Their banner stops showing immediately. Nothing is deleted — the reporting for the period ' +
        'they paid for stays exactly as it is, and you can extend them again later.',
      confirmLabel: 'End it',
      tone: 'danger',
    });
    if (!ok) return;

    const { error } = await supabase
      .from('sponsors')
      .update({ active_to: new Date().toISOString().slice(0, 10) })
      .eq('id', sponsor.id);
    if (error) {
      toast.error("Couldn't end that sponsorship", toMemberMessage(error));
      return;
    }
    toast.info(`${sponsor.name} is no longer showing`);
    load();
  }

  async function sendShoutout() {
    if (!shoutSponsor || !shoutMessage.trim()) {
      toast.error('Pick a sponsor and write the message', 'Members see the message exactly as typed.');
      return;
    }
    const ok = await confirm({
      title: 'Send this to every member?',
      message: `They will get a push notification saying:\n\n"${shoutMessage.trim()}"\n\nOne per sponsor per day — this cannot be sent twice today.`,
      confirmLabel: 'Send it',
    });
    if (!ok) return;

    setBusy(true);
    const { error } = await supabase.rpc('admin_send_sponsor_shoutout', {
      p_sponsor_id: shoutSponsor,
      p_message: shoutMessage.trim(),
    });
    setBusy(false);
    if (error) {
      toast.error("Couldn't send that", toMemberMessage(error));
      return;
    }
    toast.success('Sent to the club', 'It goes out on the next scheduler tick.');
    setShoutMessage('');
  }

  /**
   * CSV, because a sponsor report is something an organiser forwards rather
   * than screenshots. Built in the browser: sending it via a server round trip
   * would be a whole endpoint for a file that is already fully on screen.
   */
  function exportCsv() {
    const header = ['Sponsor', 'Placement', 'Run', 'Reach (members)', 'Taps', 'First seen', 'Last seen'];
    const rows = report.map((r) => [
      r.sponsor_name,
      r.type.replace(/_/g, ' '),
      r.run_title ?? '—',
      r.reach,
      r.taps,
      r.first_seen ?? '—',
      r.last_seen ?? '—',
    ]);
    // A footer line, because this file leaves the building: it is emailed to
    // sponsors, who are the businesses most likely to ask who built the thing
    // producing numbers this clean. Two lines at the bottom of a spreadsheet
    // nobody has to read.
    const footer = [
      [],
      ['Reach counts distinct members once per day — not impressions.'],
      [`MVMNT · generated ${new Date().toISOString().slice(0, 10)}`],
      [`Platform built by ${SIGNATURE.name} · ${CONTACT_LINKS[0]?.url ?? ''}`],
    ];

    const csv = [header, ...rows, ...footer]
      // Quote everything and double any inner quotes: a sponsor named
      // "Baker, Smith & Co" would otherwise split into two columns.
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `mvmnt-sponsor-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Report downloaded');
  }

  if (loading) return <p>Loading…</p>;

  const today = new Date().toISOString().slice(0, 10);
  const isActive = (s: Sponsor) =>
    s.active_from <= today && (s.active_to === null || s.active_to >= today);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Sponsors</h2>
          <p className="subtitle">Who is supporting the club, where they show, and what they got.</p>
        </div>
        {report.length > 0 && <button onClick={exportCsv}>Export report</button>}
      </div>

      <div className="card">
        <h3 className="section-title">Add a sponsor</h3>
        <div className="grid2">
          <div className="field">
            <label htmlFor="sponsor-name">Name</label>
            <input
              id="sponsor-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cairo Runners Supply"
            />
          </div>
          <div className="field">
            <label htmlFor="sponsor-url">Link</label>
            <input
              id="sponsor-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="field">
            <label htmlFor="sponsor-logo">Logo URL</label>
            <input
              id="sponsor-logo"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="Optional — their name is shown if blank"
            />
          </div>
          <div className="field">
            <label htmlFor="sponsor-to">Paid until</label>
            <input
              id="sponsor-to"
              type="date"
              value={activeTo}
              onChange={(e) => setActiveTo(e.target.value)}
            />
            <div className="hint">
              Leave blank for open-ended. On this date their banner stops on its own — nobody has to
              remember to take it down.
            </div>
          </div>
        </div>
        <button className="primary" onClick={addSponsor} disabled={busy}>
          Add sponsor
        </button>
      </div>

      {sponsors.length > 0 && (
        <div className="card">
          <h3 className="section-title">Current sponsors</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Window</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sponsors.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                      {s.active_from} → {s.active_to ?? 'open'}
                    </td>
                    <td>
                      <span className={`pill ${isActive(s) ? 'published' : 'completed'}`}>
                        {isActive(s) ? 'showing' : 'ended'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="link" onClick={() => addBanner(s)} style={{ marginRight: 10 }}>
                        Add home banner
                      </button>
                      {isActive(s) && (
                        <button className="link" onClick={() => endSponsorship(s)}>
                          End
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="section-title">Send a shoutout</h3>
        <div className="notice info">
          This goes to every member as a push notification, from the club. Once per sponsor per day.
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="shout-sponsor">Sponsor</label>
          <select
            id="shout-sponsor"
            value={shoutSponsor ?? ''}
            onChange={(e) => setShoutSponsor(e.target.value || null)}
          >
            <option value="">Choose…</option>
            {sponsors.filter(isActive).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="shout-message">Message</label>
          <textarea
            id="shout-message"
            value={shoutMessage}
            onChange={(e) => setShoutMessage(e.target.value)}
            placeholder="Free coffee at the finish for anyone in a club tee."
            maxLength={200}
          />
          <div className="hint">Members read this exactly as written.</div>
        </div>
        <button className="primary" onClick={sendShoutout} disabled={busy}>
          Send to the club
        </button>
      </div>

      <div className="card">
        <h3 className="section-title">Reporting</h3>
        <div className="hint" style={{ marginBottom: 14 }}>
          <strong>Reach is distinct members, not views.</strong> One member who opens the app eight
          times counts once. It is a smaller number than an advertising “impression” count and a
          defensible one — worth saying plainly when you send it to a sponsor.
        </div>

        {report.length === 0 ? (
          <div className="empty">No placements yet.</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Sponsor</th>
                  <th>Placement</th>
                  <th style={{ textAlign: 'right' }}>Reach</th>
                  <th style={{ textAlign: 'right' }}>Taps</th>
                  <th>Period</th>
                </tr>
              </thead>
              <tbody>
                {report.map((r) => (
                  <tr key={r.placement_id}>
                    <td>{r.sponsor_name}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                      {r.type.replace(/_/g, ' ')}
                      {r.run_title ? ` · ${r.run_title}` : ''}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {r.reach.toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {r.taps.toLocaleString()}
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                      {r.first_seen ? `${r.first_seen} → ${r.last_seen}` : 'not seen yet'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
