import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Feedback';
import { StandingCard } from '@/components/StandingCard';
import { pushStatus, registerForPush } from '@/lib/push';
import { pendingCount } from '@/lib/checkInQueue';
import { confirmDestructive } from '@/lib/confirm';
import {
  colors,
  radius,
  spacing,
  toMemberMessage,
  adamSays,
  seasonalLine,
  MIN_TOUCH_TARGET,
  SIGNATURE,
  type Database,
  type Standing,
} from '@mvmnt/shared';

type EarnedBadge = Database['public']['Functions']['my_badges']['Returns'][number];

export default function ProfileScreen() {
  const { session, profile, signOut, refreshProfile } = useAuth();
  const router = useRouter();

  const [name, setName] = useState(profile?.display_name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [queued, setQueued] = useState(0);
  const [pushState, setPushState] = useState<string | null>(null);
  const [standing, setStanding] = useState<Standing | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [onBoard, setOnBoard] = useState(!(profile?.leaderboard_opt_out ?? false));

  useEffect(() => {
    pendingCount().then(setQueued);

    // Read-only. A member who declined notifications months ago had no way to
    // find that out from inside the app — the only feedback was pressing the
    // button, and the button looks like it is offering something new.
    pushStatus().then((status) => {
      if (status === 'denied') {
        setPushState('Notifications are switched off for MVMNT in your phone settings.');
      } else if (status === 'granted') {
        setPushState('Notifications are on.');
      }
    });
  }, []);

  useEffect(() => {
    supabase
      .rpc('my_standing', { p_window: 'all_time' })
      .then(({ data }) => setStanding((data ?? [])[0] ?? null));

    // Kilometres with the club — attendance times each run's stated distance.
    // No GPS trace behind it; see migration 0044.
    supabase.rpc('my_distance_meters').then(({ data }) => setDistance(data ?? null));

    // my_badges() returns the visible catalogue plus any hidden badge this
    // member has actually earned. Showing the unearned visible ones is the
    // point — a milestone you cannot see is not one you are working towards —
    // while an unearned secret is absent entirely, which is what makes it a
    // surprise rather than a to-do list.
    supabase.rpc('my_badges').then(({ data }) => setBadges(data ?? []));
  }, []);

  useEffect(() => {
    setOnBoard(!(profile?.leaderboard_opt_out ?? false));
  }, [profile?.leaderboard_opt_out]);

  /**
   * Leaderboard visibility.
   *
   * Default on, because the club chose a public board and quietly defaulting
   * everyone to hidden would undo that decision. The switch exists because
   * publishing a member's name against how often they attend a known place at a
   * known time is personal-data processing, and under Egypt's PDPL — and GDPR,
   * for any member in the EU or UK — a person needs a way to object. See
   * ADR 0003.
   */
  async function setVisibility(visible: boolean) {
    setOnBoard(visible);
    const { error: rpcError } = await supabase.rpc('set_leaderboard_visibility', {
      p_visible: visible,
    });
    if (rpcError) {
      setOnBoard(!visible);
      setError(toMemberMessage(rpcError));
      return;
    }
    await refreshProfile();
  }

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
  async function confirmDelete() {
    // Deletion is a right and is never blocked — not even for the account that
    // runs the club. But the founding account is the one thing that cannot be
    // demoted, which makes it the guaranteed way into the organiser console;
    // deleting it can leave the club locked out of its own records. Refusing
    // would be wrong, saying nothing would be worse.
    const runsTheClub = profile?.is_founder || profile?.role === 'admin';

    const confirmed = await confirmDestructive({
      title: 'Delete your account?',
      message:
        'This removes your profile, your devices and any location data we hold. Your past attendance stays in the club’s totals, but is no longer linked to you. This cannot be undone.' +
        (profile?.is_founder
          ? '\n\nThis is the club’s founding organiser account. It is the one account that can always get into the organiser console — delete it and nobody may be able to get back in. Make someone else an organiser first.'
          : runsTheClub
            ? '\n\nYou are an organiser. You will lose access to the organiser console, and if you are the only one left the club will have nobody who can run it.'
            : ''),
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

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
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {error && <Notice tone="error" message={error} />}
      {success && !error && <Notice tone="success" message={success} />}

      {standing && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Where you are</Text>
          <StandingCard standing={standing} distanceMeters={distance} />
          <Pressable
            onPress={() => router.push('/leaderboard')}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text style={styles.link}>See the whole board →</Text>
          </Pressable>
        </View>
      )}

      {badges.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Badges</Text>
          <View style={styles.badgeGrid}>
            {badges.map((badge) => (
              <View
                key={badge.key}
                style={[styles.badge, badge.earned_at ? styles.badgeEarned : styles.badgeLocked]}
                accessibilityRole="text"
                accessibilityLabel={
                  badge.earned_at
                    ? `${badge.label}, earned`
                    : `${badge.label}, ${badge.runs_required} runs to earn`
                }
              >
                {/* A locked badge must not wear the reward colour, or the grid
                    reads as four things already won. */}
                <Text style={[styles.badgeMark, !badge.earned_at && styles.badgeMarkLocked]}>
                  {badge.earned_at ? '★' : '☆'}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.badgeLabel, !badge.earned_at && styles.badgeLabelLocked]}
                    numberOfLines={2}
                  >
                    {badge.label}
                  </Text>
                  {/* Only ever shown once earned — my_badges() does not return
                      an unearned secret at all. */}
                  {badge.is_secret && badge.hint ? (
                    <Text style={styles.badgeHint}>{badge.hint}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your name</Text>
        <Text style={styles.hint}>This is what other members see on the board.</Text>
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
        <Text style={styles.voice}>{adamSays('push_permission', { stability: 'daily' })}</Text>
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
        <Text style={styles.sectionTitle}>Appearing on the board</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Show my name on the leaderboard</Text>
          <Switch
            value={onBoard}
            onValueChange={setVisibility}
            accessibilityLabel="Show my name on the leaderboard"
            trackColor={{ false: '#3A4152', true: colors.success }}
          />
        </View>
        <Text style={styles.hint}>
          Turn this off and other members will not see you listed. You keep your points, your badges
          and your own position — you just are not on the public board.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your data</Text>
        <Text style={styles.hint}>
          MVMNT stores your name, the runs you attend, and — only when you check in — where you were
          at that moment. Location is deleted after 30 days. It is never shared with other members.
        </Text>
        <Text style={styles.hint}>
          Other members can see your name and your points on the leaderboard unless you turn that
          off above, and the friends you have added in person can see whether you are coming to the
          next run. Nobody can see which runs you have been to.
        </Text>
      </View>

      <View style={styles.footer}>
        <Button label="Sign out" variant="secondary" onPress={signOut} />
        <Button label="Delete my account" variant="destructive" onPress={confirmDelete} />
      </View>

      {/* The signature. One line, at the bottom, on the screen a member reaches
          when they are already poking around — memorable without being in the
          way of anybody trying to get to a run. */}
      <Text style={styles.seasonal}>{seasonalLine()}</Text>

      <Pressable
        onPress={() => router.push('/about')}
        accessibilityRole="button"
        accessibilityLabel="About MVMNT and who built it"
        style={styles.madeBy}
      >
        <Text style={styles.madeByText}>{SIGNATURE.footer}</Text>
      </Pressable>
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
  link: { fontSize: 14, fontWeight: '700', color: colors.action },
  voice: { fontSize: 13, color: colors.textOnDarkMuted, fontStyle: 'italic' },
  seasonal: { fontSize: 13, color: colors.textOnDarkMuted, fontStyle: 'italic', textAlign: 'center' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  switchLabel: { flex: 1, fontSize: 16, color: colors.textOnDark },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
  },
  badgeEarned: { backgroundColor: colors.baseElevated, borderColor: colors.highlight },
  badgeLocked: { backgroundColor: 'transparent', borderColor: '#333B4D' },
  badgeMark: { fontSize: 18, color: colors.highlight },
  badgeMarkLocked: { color: colors.textOnDarkMuted },
  badgeHint: { fontSize: 11, color: colors.textOnDarkMuted },
  madeBy: { alignItems: 'center', paddingVertical: spacing.lg },
  madeByText: { fontSize: 13, color: colors.textOnDarkMuted, textDecorationLine: 'underline' },
  badgeLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.textOnDark },
  badgeLabelLocked: { color: colors.textOnDarkMuted, fontWeight: '400' },
});
