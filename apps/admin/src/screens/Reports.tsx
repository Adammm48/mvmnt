import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toMemberMessage } from '@mvmnt/shared';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';

type Report = {
  id: string;
  kind: 'photo' | 'gift_message';
  target_id: string;
  reason: string;
  created_at: string;
  reporter_name: string | null;
  photo_path: string | null;
  run_title: string | null;
  gift_message: string | null;
  buyer_name: string | null;
  recipient_name: string | null;
};

const BUCKET = 'gallery-media';

/**
 * The moderation queue — the organiser's half of content reporting.
 *
 * Members file reports from the app (a photo, a gift message); this is where
 * somebody reads them and acts. Apple's guideline 1.2 requires acting, not
 * merely collecting: each row shows the content itself, and the action that
 * removes it sits next to the one that closes the report — because "looked at
 * it, it's fine" is as legitimate an outcome as removal, and both should be
 * one click.
 */
export function Reports() {
  const toast = useToast();
  const confirm = useConfirm();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_reports');
    if (error) {
      toast.error("Couldn't load the reports", toMemberMessage(error));
      return;
    }
    const rows = (data ?? []) as Report[];
    setReports(rows);

    // Sign one URL per reported photo so the organiser judges the actual
    // image, exactly as the gallery manager does.
    const paths = rows.map((r) => r.photo_path).filter((p): p is string => !!p);
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
      const map: Record<string, string> = {};
      (signed ?? []).forEach((s, i) => {
        if (s.signedUrl) map[paths[i]!] = s.signedUrl;
      });
      setThumbs(map);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(report: Report) {
    setBusyId(report.id);
    const { error } = await supabase.rpc('admin_resolve_report', { p_report_id: report.id });
    setBusyId(null);
    if (error) {
      toast.error("Couldn't resolve it", toMemberMessage(error));
      return;
    }
    toast.success('Report resolved');
    load();
  }

  async function removePhoto(report: Report) {
    if (!report.photo_path) return;
    const ok = await confirm({
      title: 'Remove this photo?',
      message:
        'It disappears from the gallery for every member and the file is deleted. This also resolves the report.',
      confirmLabel: 'Remove the photo',
      tone: 'danger',
    });
    if (!ok) return;

    setBusyId(report.id);
    const { error: rowError } = await supabase.from('run_photos').delete().eq('id', report.target_id);
    if (rowError) {
      setBusyId(null);
      toast.error("Couldn't remove the photo", toMemberMessage(rowError));
      return;
    }
    await supabase.storage.from(BUCKET).remove([report.photo_path]);
    await supabase.rpc('admin_resolve_report', { p_report_id: report.id });
    setBusyId(null);
    toast.success('Photo removed and report resolved');
    load();
  }

  async function clearMessage(report: Report) {
    const ok = await confirm({
      title: 'Clear this gift message?',
      message:
        'The message text is blanked for both members. The gift itself is untouched. This also resolves the report.',
      confirmLabel: 'Clear the message',
      tone: 'danger',
    });
    if (!ok) return;

    setBusyId(report.id);
    const { error } = await supabase.rpc('admin_clear_gift_message', {
      p_order_id: report.target_id,
    });
    if (error) {
      setBusyId(null);
      toast.error("Couldn't clear it", toMemberMessage(error));
      return;
    }
    await supabase.rpc('admin_resolve_report', { p_report_id: report.id });
    setBusyId(null);
    toast.success('Message cleared and report resolved');
    load();
  }

  if (reports === null) return <p className="hint">Loading the reports…</p>;

  return (
    <div>
      <div className="card">
        <h3 className="section-title">Reports</h3>
        <p className="hint">
          What members have flagged from inside the app. Every report deserves one of two answers:
          remove the content, or resolve it as fine — both are one click, and both are logged.
        </p>

        {reports.length === 0 && <p className="hint">Nothing reported. The queue is empty.</p>}

        {reports.map((r) => (
          <div key={r.id} className="report-row" style={{ borderTop: '1px solid var(--border)', padding: '14px 0' }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              {r.kind === 'photo' && r.photo_path && thumbs[r.photo_path] && (
                <img
                  src={thumbs[r.photo_path]}
                  alt="Reported"
                  style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }}
                />
              )}
              <div style={{ flex: 1 }}>
                <strong>
                  {r.kind === 'photo'
                    ? `Photo${r.run_title ? ` — ${r.run_title}` : ''}`
                    : `Gift message${r.buyer_name ? ` — from ${r.buyer_name}` : ''}${r.recipient_name ? ` to ${r.recipient_name}` : ''}`}
                </strong>
                {r.kind === 'gift_message' && (
                  <p style={{ margin: '4px 0', fontStyle: 'italic' }}>
                    {r.gift_message ?? 'The message no longer exists — cleared or erased already.'}
                  </p>
                )}
                {r.kind === 'photo' && !r.photo_path && (
                  <p className="hint" style={{ margin: '4px 0' }}>
                    The photo no longer exists — removed already.
                  </p>
                )}
                <p style={{ margin: '4px 0' }}>
                  &ldquo;{r.reason}&rdquo;
                  <span className="hint">
                    {' '}
                    — {r.reporter_name ?? 'a former member'},{' '}
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </p>
              </div>
              <div className="inline" style={{ flexShrink: 0 }}>
                {r.kind === 'photo' && r.photo_path && (
                  <button className="danger" disabled={busyId === r.id} onClick={() => removePhoto(r)}>
                    Remove photo
                  </button>
                )}
                {r.kind === 'gift_message' && r.gift_message && (
                  <button className="danger" disabled={busyId === r.id} onClick={() => clearMessage(r)}>
                    Clear message
                  </button>
                )}
                <button disabled={busyId === r.id} onClick={() => resolve(r)}>
                  Resolve as fine
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
