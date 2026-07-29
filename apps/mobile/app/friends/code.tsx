import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '@/lib/supabase';
import { Loading, Notice } from '@/components/Feedback';
import {
  colors,
  radius,
  spacing,
  typography,
  formatFriendCode,
  secondsUntil,
  toMemberMessage,
  adamSays,
} from '@mvmnt/shared';

/**
 * Your friend code.
 *
 * Two ways to hand it over, both on screen at once:
 *
 *   · the QR, for the camera
 *   · **the code itself, in text**, for reading out
 *
 * The second was missing, which quietly broke the fallback the whole feature
 * leans on. A camera that will not focus in low light is the normal case at a
 * winter meeting point, and until now the only answer was a code the member
 * could not see.
 *
 * It rolls every 60 seconds for as long as this screen is open. That is the
 * entire safety mechanism — a code read out over the phone to somebody at home
 * is dead before they can type it — and it also replaces the old "turn off my
 * code" button: waiting a minute now does the same job, and a button that
 * duplicates the passage of time only adds doubt.
 */
export default function FriendCodeScreen() {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const fetchCode = useCallback(async () => {
    // The timer and the first load can both fire at the boundary. Without this
    // latch the screen mints two codes and shows the older one, which is the
    // one that has already been revoked.
    if (inFlight.current) return;
    inFlight.current = true;

    const { data, error: rpcError } = await supabase.rpc('my_friend_qr');
    inFlight.current = false;

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
    fetchCode();
  }, [fetchCode]);

  useEffect(() => {
    if (!expiresAt) return;

    const timer = setInterval(() => {
      const left = secondsUntil(expiresAt);
      setRemaining(left);
      // Roll a beat early, so there is never a moment where the code on screen
      // has quietly stopped working.
      if (left <= 1) fetchCode();
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAt, fetchCode]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {error && <Notice tone="error" message={error} />}

      {token ? (
        <>
          <View style={styles.codeCard}>
            {/*
              White plate behind the code: scanners want dark modules on a light
              field, and the app's dark base would make this slow to read across
              a table.
            */}
            {/* Ink modules, not base-coloured: the base is white now, and a QR
                drawn in the base colour is a white square nobody can scan. */}
            <QRCode value={token} size={216} backgroundColor="#FFFFFF" color={colors.textPrimary} />
          </View>

          <View style={styles.textCode}>
            <Text style={styles.textCodeLabel}>Or read this out</Text>
            <Text style={styles.textCodeValue} selectable accessibilityLabel={`Your code is ${token.split('').join(' ')}`}>
              {formatFriendCode(token)}
            </Text>
          </View>

          <View style={styles.countdownRow}>
            <Text style={[styles.countdown, remaining <= 10 && styles.countdownLow]}>
              {remaining}s
            </Text>
            <Text style={styles.countdownLabel}>until a new code replaces this one</Text>
      <Text style={styles.voiceLine}>{adamSays('friend_code', { stability: 'daily' })}</Text>
          </View>
        </>
      ) : (
        <View style={styles.placeholder}>
          <Loading label="Making your code" />
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>How this works</Text>
        <Text style={styles.body}>
          Let them scan the square, or read the eight characters out. It works once, and only for a
          minute — so a screenshot sent to somebody who was not there is already dead when it
          arrives. That is what keeps your friends to people you have actually met.
        </Text>
        <Text style={styles.body}>
          A fresh code replaces this one every minute, and the old one stops working the moment it
          does. If you think somebody captured your screen, just wait a minute — there is nothing to
          switch off.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  voiceLine: {
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
  codeCard: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  placeholder: { minHeight: 220, justifyContent: 'center' },
  textCode: {
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  textCodeLabel: {
    fontSize: 12,
    color: colors.textOnDarkMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
  },
  textCodeValue: {
    ...typography.dataLarge,
    fontSize: 34,
    color: colors.textOnDark,
    letterSpacing: 4,
  },
  countdownRow: { alignItems: 'center', gap: 2 },
  countdown: { ...typography.dataLarge, fontSize: 26, color: colors.textOnDark },
  // The last ten seconds go amber, so somebody mid-way through reading it out
  // knows to wait for the next one rather than being cut off.
  countdownLow: { color: colors.highlight },
  countdownLabel: { fontSize: 13, color: colors.textOnDarkMuted },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.textOnDark },
  body: { fontSize: 14, color: colors.textOnDarkMuted, lineHeight: 21 },
});
