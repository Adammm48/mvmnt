import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from '@mvmnt/shared';

type AuthValue = {
  session: Session | null;
  profile: Profile | null;
  /** Distinguishes "still checking" from "definitely signed out". */
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string | undefined) {
    if (!userId) {
      setProfile(null);
      return;
    }
    // RLS restricts this to the caller's own row, so no filter is needed for
    // correctness — but being explicit documents the intent at the call site.
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    setProfile(data ?? null);
  }

  useEffect(() => {
    let active = true;

    /**
     * Restoring the session must ALWAYS finish, successfully or not.
     *
     * This had no error path, and `loading` starts true — so any rejection
     * here (a storage read that throws, an unreachable backend, a malformed
     * stored session) left the app on its spinner for ever, saying nothing.
     * Found on a release build that hung at launch with no log line to explain
     * it, which is precisely the silent-failure shape this project keeps
     * meeting: the code ran, and nobody was told.
     *
     * A failure is treated as signed-out. That is the only safe reading — an
     * app that cannot confirm who you are must not assume it knows — and the
     * member lands on sign-in, which is a screen they can act on rather than
     * a spinner they cannot.
     */
    const settle = async (next: Session | null) => {
      if (!active) return;
      setSession(next);
      try {
        await loadProfile(next?.user.id);
      } catch (error) {
        // A missing profile must not block the app either: the member is
        // signed in, and every screen already handles a null profile.
        console.warn('could not load the profile', error);
      }
      setLoading(false);
    };

    supabase.auth
      .getSession()
      .then(({ data }) => settle(data.session))
      .catch((error) => {
        console.warn('could not restore the session', error);
        settle(null);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      void settle(next);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value: AuthValue = {
    session,
    profile,
    loading,
    signOut: async () => {
      await supabase.auth.signOut();
      setProfile(null);
    },
    refreshProfile: () => loadProfile(session?.user.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
