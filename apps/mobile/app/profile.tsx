import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Feedback';
import { registerForPush } from '@/lib/push';
import { pendingCount } from '@/lib/checkInQueue';
import { colors, radius, spacing, toMemberMessage, MIN_TOUCH_TARGET } from '@mvmnt/shared';

export default function ProfileScreen() {
  const { session, profile, signOut, refreshProfile } = useAuth();
  const router = useRouter();

  const [name, setName] = useState(profile?.display_name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [queued, setQueued] = useState(0);
  const [pushState, setPushState] = useState<string | null>(null);

  useEffect(() => {
    pendingCount().then(setQueued);
  }, []);

  useEffect(() => {
    if (profile?.display_name) setName(profile.display_name);
  }, [profile?.display_name]);

  async function saveName() {
    setBusy(true);
    setError(null);
    setSuccess(null);

    const { error: saveError } = await supabase
      .from('profiles')
      .update({ display_name: name.trim() })
      .eq('id', session!.user.id);

    setBusy(false);
    if (saveError) {
      setError(toMemberMessage(saveError));
      return;
    }
    setSuccess('Saved.');
    await refreshProfile();
  }

  async function enableNotifications() {
    const result = await registerForPush();
    setPushState(result.ok ? 'Notifications are on.' : result.message);
  }

  /**
   * Account deletion.
   *
   * Reachable from the app rather than by emailing an organiser: Principles §4
   * requires that a member always understands how to delete their data, and a
   * deletion path that needs a human is not one.
   *
   * erase_member() destroys personal data and anonymises past attendance so
   * historical headcounts stay correct — see ADR 0002 §6.
   */
  function confirmDelete() {
    Alert.alert(
      'Delete your account?',
      'This removes your profile, your devices and any location data we hold. Your past attendance stays in the club’s totals, but is no longer linked to you. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const { error: deleteError } = await supabase.rpc('erase_member', {
              p_user_id: session!.user.id,
            });
            setBusy(false);

            if (deleteError) {
              setError(toMemberMessage(deleteError));
              return;
            }
            await signOut();
            router.replace('/sign-in');
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {error && <Notice tone="error" message={error} />}
      {success && !error && <Notice tone="success" message={success} />}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your name</Text>
        <Text style={styles.hint}>This is what other members see on the leaderboard later.</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          accessibilityLabel="Display name"
          placeholder="Your name"
          placeholderTextColor={colors.textOnDarkMuted}
          maxLength={60}
          editable={!busy}
        />
        <Button label="Save" onPress={saveName} loading={busy} disabled={!name.trim()} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <Text style={styles.hint}>
          New runs, a reminder the night before and on the morning, and a nudge if a waitlist spot
          opens up.
        </Text>
        <Button label="Turn on notifications" variant="secondary" onPress={enableNotifications} />
        {pushState && <Text style={styles.hint}>{pushState}</Text>}
      </View>

      {queued > 0 && (
        <Notice
          tone="info"
          message={`${queued} check-in${queued === 1 ? '' : 's'} waiting to sync. This happens automatically when you have signal.`}
        />
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your data</Text>
        <Text style={styles.hint}>
          MVMNT stores your name, the runs you attend, and — only when you check in — where you were
          at that moment. Location is deleted after 30 days. It is never shared with other members.
        </Text>
      </View>

      <View style={styles.footer}>
        <Button label="Sign out" variant="secondary" onPress={signOut} />
        <Button label="Delete my account" variant="destructive" onPress={confirmDelete} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.textOnDark },
  hint: { fontSize: 14, color: colors.textOnDarkMuted, lineHeight: 20 },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.baseElevated,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 17,
    color: colors.textOnDark,
    borderWidth: 1,
    borderColor: '#3A4152',
  },
  footer: { gap: spacing.sm, marginTop: spacing.lg },
});
