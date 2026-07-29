import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CONSENT_VERSION, MINIMUM_AGE, POLICY_URL, colors, radius, spacing } from '@mvmnt/shared';
import { supabase } from '@/lib/supabase';
import { toMemberMessage } from '@mvmnt/shared';
import { useAuth } from '@/lib/auth';
import { Button } from './Button';
import { Notice } from './Feedback';

/**
 * Whether consent is still outstanding.
 *
 * Exported so the welcome modal can stand down while this is up: two modals
 * rendered at once means the later one wins, and the introduction was landing
 * on top of the thing that must be answered first.
 */
export function useConsentNeeded(): boolean {
  const { session, profile } = useAuth();
  if (!session || !profile) return false;
  return profile.consent_version !== CONSENT_VERSION;
}

/**
 * What a member agrees to, before the app collects anything about them.
 *
 * Consent was previously taken verbally at runs. That is real consent — it is
 * not a lesser thing legally — but it is not *demonstrable*, and the burden of
 * showing consent was given sits with the club. This turns it into a record
 * (migration 0048): what was accepted, which version, and when.
 *
 * NOT DISMISSIBLE, unlike the welcome modal it sits next to. A member can close
 * an introduction; they cannot close the question of whether the club may hold
 * their data, because the honest options are "agree" or "do not use the app",
 * and pretending otherwise would make the consent meaningless.
 *
 * The three asks are deliberately separate. Bundling photographs into "accept
 * the terms" is exactly the kind of blanket consent that is not freely given —
 * and photographs are the one people actually feel strongly about.
 */
export function ConsentGate() {
  const { session, profile, refreshProfile } = useAuth();
  const [show, setShow] = useState(false);
  const [age, setAge] = useState(false);
  const [photosOk, setPhotosOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !profile) {
      setShow(false);
      return;
    }
    // Asked again when the version moves, which is the whole point of storing
    // one — a materially changed policy should not be silently inherited.
    setShow(profile.consent_version !== CONSENT_VERSION);
  }, [session, profile]);

  async function accept() {
    setBusy(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc('accept_consent', {
      p_version: CONSENT_VERSION,
      p_age_confirmed: age,
      p_photo_ok: photosOk,
    });

    setBusy(false);

    if (rpcError) {
      setError(toMemberMessage(rpcError));
      return;
    }

    // The gate closes on the refreshed profile rather than optimistically, so
    // a write that silently failed cannot leave somebody inside the app
    // without a consent row.
    await refreshProfile();
  }

  if (!show) return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Before you start</Text>
            <Text style={styles.body}>
              Two quick things, so you know what the club holds about you and what it does with it.
            </Text>

            {error && <Notice tone="error" message={error} />}

            <Check
              checked={age}
              onToggle={() => setAge((v) => !v)}
              title={`I am ${MINIMUM_AGE} or over`}
              body="Under 18s are welcome at every run — an organiser checks you in by hand. The app account itself is for adults."
            />

            <Check
              checked={photosOk}
              onToggle={() => setPhotosOk((v) => !v)}
              title="The club can share photos of me from runs"
              body="Photos go in the app, visible to members only. You can change this any time in your profile, and you can always ask an organiser to take a photo down."
            />

            {/* Said plainly rather than buried, because it is the part a
                checkbox cannot honestly promise. */}
            {!photosOk && (
              <Text style={styles.caveat}>
                Noted — organisers will see this. At a run of three hundred people nobody can
                promise you are in no one&rsquo;s background, but your photos come down whenever you
                ask.
              </Text>
            )}

            <Text style={styles.small}>
              The club never sees your card, never tracks you between runs, and deletes your
              check-in location after 30 days. You can delete your account from your profile at any
              time.
              {POLICY_URL ? '' : ' The full privacy policy is being finalised before launch.'}
            </Text>

            <Button
              label={busy ? 'One moment…' : 'Agree and continue'}
              onPress={accept}
              disabled={busy || !age}
            />

            {!age && (
              <Text style={styles.hint}>
                Confirm your age to continue — it is the one we cannot skip.
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Check({
  checked,
  onToggle,
  title,
  body,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  body: string;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={styles.check}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={title}
    >
      <View style={[styles.box, checked && styles.boxOn]}>
        {checked && <Text style={styles.tick}>✓</Text>}
      </View>
      <View style={styles.checkText}>
        <Text style={styles.checkTitle}>{title}</Text>
        <Text style={styles.checkBody}>{body}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    maxHeight: '88%',
  },
  scroll: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 22, fontWeight: '800', color: colors.textOnDark },
  body: { fontSize: 15, color: colors.textOnDarkMuted, lineHeight: 21 },
  check: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  box: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.textOnDarkMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  boxOn: { backgroundColor: colors.action, borderColor: colors.action },
  tick: { color: '#fff', fontSize: 16, fontWeight: '800' },
  checkText: { flex: 1, gap: 3 },
  checkTitle: { fontSize: 15, fontWeight: '700', color: colors.textOnDark },
  checkBody: { fontSize: 13, color: colors.textOnDarkMuted, lineHeight: 19 },
  caveat: {
    fontSize: 13,
    color: colors.textOnDarkMuted,
    lineHeight: 19,
    fontStyle: 'italic',
  },
  small: { fontSize: 12, color: colors.textOnDarkMuted, lineHeight: 18 },
  hint: { fontSize: 12, color: colors.textOnDarkMuted, textAlign: 'center' },
});
