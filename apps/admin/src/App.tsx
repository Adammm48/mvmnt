import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { SignIn } from './screens/SignIn';
import { RunList } from './screens/RunList';
import { RunEditor } from './screens/RunEditor';
import { RunDay } from './screens/RunDay';
import { Members } from './screens/Members';
import { Rewards } from './screens/Rewards';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/Confirm';
import { SIGNATURE } from '@mvmnt/shared';

export type View =
  | { name: 'list' }
  | { name: 'editor'; runId: string | null }
  | { name: 'runday'; runId: string }
  | { name: 'members' }
  | { name: 'rewards' };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [view, setView] = useState<View>({ name: 'list' });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setIsAdmin(null);
      return;
    }
    // Ask the database, never a local claim. is_admin() is the single source of
    // truth and the same function every RPC checks (Principles §2). Hiding the
    // UI is a courtesy; the server is what actually refuses.
    supabase.rpc('is_admin').then(({ data }) => setIsAdmin(data === true));
  }, [session]);

  if (!session) return <SignIn />;

  if (isAdmin === null) {
    return <main className="center-page">Checking your access…</main>;
  }

  if (!isAdmin) {
    return (
      <main className="center-page">
        <div className="notice error">
          This account is not an organiser. Ask an existing organiser to give you access.
        </div>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </main>
    );
  }

  return (
    <ToastProvider>
      <ConfirmProvider>
        <header className="app-header">
          <h1>MVMNT · ORGANISER</h1>
          <nav className="app-nav">
            <button
              className={`link ${view.name === 'members' || view.name === 'rewards' ? '' : 'current'}`}
              onClick={() => setView({ name: 'list' })}
            >
              Runs
            </button>
            <button
              className={`link ${view.name === 'members' ? 'current' : ''}`}
              onClick={() => setView({ name: 'members' })}
            >
              Members
            </button>
            <button
              className={`link ${view.name === 'rewards' ? 'current' : ''}`}
              onClick={() => setView({ name: 'rewards' })}
            >
              Rewards
            </button>
          </nav>
          <div className="who">
            <span>{session.user.email}</span>
            <button className="link" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        </header>
        <main>
          {view.name === 'list' && <RunList onNavigate={setView} />}
          {view.name === 'editor' && (
            <RunEditor runId={view.runId} onDone={() => setView({ name: 'list' })} />
          )}
          {view.name === 'runday' && (
            <RunDay runId={view.runId} onBack={() => setView({ name: 'list' })} />
          )}
          {view.name === 'members' && <Members />}
          {view.name === 'rewards' && <Rewards />}
        </main>
        {/* The organisers open this every week, and it is the screen a sponsor
            is most likely to be shown. One line, at the very bottom. */}
        <footer className="app-footer">{SIGNATURE.footer}</footer>
      </ConfirmProvider>
    </ToastProvider>
  );
}
