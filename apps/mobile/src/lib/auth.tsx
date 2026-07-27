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

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!active) return;
      setSession(next);
      await loadProfile(next?.user.id);
      setLoading(false);
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
