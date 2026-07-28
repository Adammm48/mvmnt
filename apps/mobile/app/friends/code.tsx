import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/Button';
import { Loading, Notice } from '@/components/Feedback';
import { confirmDestructive } from '@/lib/confirm';
import {
  colors,
  radius,
  spacing,
  typography,
  formatCountdown,
  secondsUntil,
  toMemberMessage,
} from '@mvmnt/shared';

/**
 * Your friend code.
 *
 * The countdown under the code is not decoration. A permanent friend code would
 * be a username you could paste into WhatsApp, and "QR only" would mean nothing;
 * the three-minute life is the entire mechanism that makes adding someone an
 * in-person act. So the member sees it running down, and the copy says why.
 *
 * The code refreshes itself when it expires rather than going dead, because a
 * member holding their phone out at a meeting point should not have to notice
 * and re-tap.
 */
export default function FriendCodeScreen() {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stopped = useRef(false);

  const fetchCode = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('my_friend_qr');
    if (rpcError) {
      setError(toMemberMessage(rpcError));
      return;
    }
    const row = (data ?? [])[0];
    if (!row) return;
    setToken(row.token);
    setExpiresAt(row.expires_at);
    setRemaining(secondsUntil(row.expires_at));
    setError(null);
  }, []);

  useEffect(() => {
    stopped.current = false;
    fetchCode();
    return () => {
      stopped.current = true;
    };
  }, [fetchCode]);

  useEffect(() => {
    if (!expiresAt) return;

    const timer = setInterval(() => {
      const left = secondsUntil(expiresAt);
      setRemaining(left);
      // Roll over a beat early, so there is never a moment where the code on
      // screen has quietly stopped working.
      if (left <= 1 && !stopped.current && !busy) fetchCode();
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAt, fetchCode, busy]);

  async function turnOff() {
    const confirmed = await confirmDestructive({
      title: 'Turn off your code?',
      message:
        'Any code you have already shown stops working straight away. Friends you already have are not affected — this only stops new people adding you until you show a fresh code.',
      confirmLabel: 'Turn it off',
    });
    if (!confirmed) return;

    setBusy(true);
    const { error: revokeError } = await supabase.rpc('revoke_my_friend_qr');
    setBusy(false);

    if (revokeError) {
      setError(toMemberMessage(revokeError));
      return;
    }
    setToken(null);
    setExpiresAt(null);
    setNote('Your old codes no longer work. Tap below when you want a new one.');
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {error && <Notice tone="error" message={error} />}
      {note && !error && <Notice tone="info" message={note} />}

      {token ? (
        <>
          <View style={styles.codeCard}>
            {/*
              White plate behind the code on purpose: QR scanners want dark
              modules on a light field, and the app's dark base would make this
              slow or impossible to read across a table.
            */}
            <QRCode value={token} size={228} backgroundColor="#FFFFFF" color={colors.base} />
          </View>

          <View style={styles.countdownRow}>
            <Text style={styles.countdown}>{formatCountdown(remaining)}</Text>
            <Text style={styles.countdownLabel}>until this code refreshes</Text>
          </View>
        </>
      ) : (
        <View style={styles.placeholder}>
          {error || note ? (
            <Button label="Show a new code" onPress={fetchCode} />
          ) : (
            <Loading label="Making your code" />
          )}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>How this works</Text>
        <Text style={styles.body}>
          Hold this up and let the other person scan it with MVMNT. It works once, and only for a
          few minutes — so a screenshot sent to someone who was not there is useless by the time it
          arrives. That is what keeps this to people you have actually met.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>If your code got out</Text>
        <Text style={styles.body}>
          Turn it off and nobody can use a code you have already shown. Friends you already have stay
          exactly as they are.
        </Text>
        <Button
          label="Turn off my code"
          variant="destructive"
          onPress={turnOff}
          loading={busy}
          disabled={!token && !expiresAt}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
  codeCard: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  placeholder: { minHeight: 220, justifyContent: 'center' },
  countdownRow: { alignItems: 'center', gap: 2 },
  countdown: { ...typography.dataLarge, color: colors.textOnDark },
  countdownLabel: { fontSize: 13, color: colors.textOnDarkMuted },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.textOnDark },
  body: { fontSize: 14, color: colors.textOnDarkMuted, lineHeight: 21 },
});
