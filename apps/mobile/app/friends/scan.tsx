import { useCallback, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { extractToken } from '@/lib/friends';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Feedback';
import {
  colors,
  radius,
  spacing,
  toMemberMessage,
  adamSays,
  MIN_TOUCH_TARGET,
} from '@mvmnt/shared';

/**
 * Scanning a friend's code.
 *
 * The camera is the intended path, and typing the code is kept as a real
 * fallback rather than a hidden one — a scanner that fails in low light at 6am
 * with no alternative is a feature that does not work when it is needed. The
 * code is short-lived and single-use either way, so the typed route is no
 * weaker than the scanned one.
 */
export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  // A camera fires onBarcodeScanned many times a second. Without this latch the
  // first scan is followed by a dozen more, each hitting a token the first one
  // has already burned — and the member sees "that code is not valid any more"
  // for a code that just worked.
  const claiming = useRef(false);

  const redeem = useCallback(
    async (raw: string) => {
      const token = extractToken(raw);
      if (!token) {
        setError('That does not look like an MVMNT code — it should be 8 characters.');
        claiming.current = false;
        return;
      }

      setBusy(true);
      setError(null);

      const { data, error: rpcError } = await supabase.rpc('add_friend_by_token', {
        p_token: token,
      });

      if (rpcError) {
        setBusy(false);
        claiming.current = false;
        setError(toMemberMessage(rpcError));
        return;
      }

      // The RPC returns the owner's id only. Their name comes from my_friends,
      // which is the one function allowed to hand a member another member's
      // name — reading profiles directly would be denied, correctly.
      const { data: friends } = await supabase.rpc('my_friends', {});
      const match = (friends ?? []).find((f) => f.friend_id === data);

      setBusy(false);
      setAdded(match?.display_name ?? 'Added');
    },
    [],
  );

  if (added) {
    return (
      <View style={styles.done}>
        <Text style={styles.doneEmoji}>🤝</Text>
        <Text style={styles.doneTitle}>You and {added} are friends</Text>
        <Text style={styles.doneBody}>
          You will see each other on the friends list before the next run — and you can nudge each
          other about it.
        </Text>
        <Text style={styles.doneVoice}>{adamSays('friend_added')}</Text>
        <Button label="Back to friends" onPress={() => router.replace('/friends')} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {error && <Notice tone="error" message={error} />}

      {permission?.granted ? (
        <View style={styles.viewfinder}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (claiming.current || busy) return;
              claiming.current = true;
              redeem(data);
            }}
          />
          <View style={styles.reticle} pointerEvents="none" />
        </View>
      ) : (
        <View style={styles.permission}>
          <Text style={styles.permissionTitle}>Point your camera at their code</Text>
          <Text style={styles.permissionBody}>
            MVMNT uses the camera only to read a friend&apos;s code. Nothing is recorded or uploaded.
          </Text>
          <Button
            label={permission?.canAskAgain === false ? 'Open settings to allow the camera' : 'Allow camera'}
            onPress={() => requestPermission()}
          />
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Or type the code</Text>
        <Text style={styles.body}>
          {Platform.OS === 'web'
            ? 'Scanning works best in the app. On the web, ask them to read their code out.'
            : 'If the light is bad or the camera will not focus, they can read it out instead.'}{' '}
          Spaces and capitals do not matter.
        </Text>
        <TextInput
          style={styles.input}
          value={manual}
          onChangeText={setManual}
          placeholder="8-character code"
          placeholderTextColor={colors.textOnDarkMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Friend code"
          editable={!busy}
        />
        {/*
          Secondary, not primary. App Spec §2 allows exactly one primary action
          per screen, and while the camera is still waiting on permission that
          one belongs to Allow camera — the camera is the intended path and
          typing is the fallback. Once permission is granted the viewfinder
          replaces that block and the screen's primary action is simply pointing
          the phone, which needs no button at all.
        */}
        <Button
          label="Add friend"
          variant="secondary"
          onPress={() => redeem(manual)}
          loading={busy}
          disabled={manual.trim().length === 0}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
  viewfinder: {
    height: 320,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  reticle: {
    position: 'absolute',
    top: 60,
    left: 60,
    right: 60,
    bottom: 60,
    borderWidth: 3,
    borderColor: colors.action,
    borderRadius: radius.lg,
  },
  permission: {
    gap: spacing.sm,
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  permissionTitle: { fontSize: 18, fontWeight: '700', color: colors.textOnDark },
  permissionBody: { fontSize: 14, color: colors.textOnDarkMuted, lineHeight: 21 },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.textOnDark },
  body: { fontSize: 14, color: colors.textOnDarkMuted, lineHeight: 21 },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.baseElevated,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.textOnDark,
    borderWidth: 1,
    borderColor: '#3A4152',
  },
  done: {
    flex: 1,
    backgroundColor: colors.base,
    padding: spacing.xl,
    justifyContent: 'center',
    gap: spacing.md,
  },
  doneEmoji: { fontSize: 56, textAlign: 'center' },
  doneTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textOnDark,
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  doneBody: {
    fontSize: 15,
    color: colors.textOnDarkMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  doneVoice: {
    fontSize: 14,
    color: colors.success,
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: spacing.md,
  },
});
