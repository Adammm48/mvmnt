import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { toMemberMessage, SIGNATURE } from '@mvmnt/shared';

/**
 * Same email one-time-code sign-in as the app. There is no separate admin
 * password: an organiser is a member whose profiles.role is 'admin', so there
 * is only one account system and one place authorisation is decided.
 */
export function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (sendError) {
      setError(toMemberMessage(sendError));
      return;
    }
    setSent(true);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (verifyError) setError(toMemberMessage(verifyError, 'That code was not right.'));
  }

  return (
    <main className="center-page">
      <h2>MVMNT Organiser</h2>
      <p className="subtitle">Sign in with the email your organiser account uses.</p>

      {error && <div className="notice error">{error}</div>}

      {!sent ? (
        <form onSubmit={sendCode} className="card">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send me a code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="card">
          <div className="field">
            <label htmlFor="code">6-digit code</label>
            <input
              id="code"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              autoFocus
              required
            />
            <div className="hint">Sent to {email}</div>
          </div>
          <div className="inline">
            <button className="primary" type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button type="button" className="link" onClick={() => setSent(false)}>
              Use a different email
            </button>
          </div>
        </form>
      )}

      {/* Same credit as the member app's front door, same single string. */}
      <p style={{ marginTop: 28, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
        Developed by {SIGNATURE.name}
      </p>
    </main>
  );
}
