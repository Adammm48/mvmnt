import { useState , useEffect, useRef } from 'react';
import { Animated, ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { adamSays, colors, radius, spacing, type VoiceSlot } from '@mvmnt/shared';

/**
 * Loading, empty and error states.
 *
 * Principles §14 lists loading and empty states as part of "done", and App Spec
 * §2 asks for encouragement rather than blankness — so an empty list is an
 * invitation, not an apology.
 */

export function Loading({ label = 'Loading' }: { label?: string }) {
  // A line under the spinner, fresh each time. Loading is the one moment where
  // a member is doing nothing but looking at the screen, so it is the cheapest
  // place in the app to be a person rather than a progress indicator.
  const [line] = useState(() => adamSays('loading'));

  return (
    <View style={styles.centered} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.action} />
      <Text style={styles.loadingLine}>{line}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  body,
  /** Adds a line in the author's voice. Omit where a joke would not land. */
  voice,
  userId,
}: {
  title: string;
  body?: string;
  voice?: VoiceSlot;
  userId?: string;
}) {
  const [line] = useState(() => (voice ? adamSays(voice, { userId }) : null));

  return (
    <View style={styles.centered} accessibilityRole="summary">
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {line ? <Text style={styles.emptyVoice}>{line}</Text> : null}
    </View>
  );
}

type NoticeTone = 'error' | 'info' | 'success';

export function Notice({
  tone,
  message,
  /**
   * Renders a visible close control. Tap-to-dismiss on the notice itself was
   * tried first and was the wrong idea twice over: nothing indicated it was
   * pressable, and it did not reliably register anyway.
   */
  onDismiss,
}: {
  tone: NoticeTone;
  message: string;
  onDismiss?: () => void;
}) {
  /**
   * A soft entrance instead of an abrupt pop. Feedback appearing in one frame
   * reads as a glitch (the owner's words: the save output should be smoother);
   * 220ms of fade-and-settle reads as the app responding. Native driver, so
   * it stays smooth even while the JS thread is busy with the save itself.
   */
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    entrance.setValue(0);
    Animated.timing(entrance, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
    // Re-run when the message changes so a NEW notice also eases in.
  }, [message, tone, entrance]);

  return (
    <Animated.View
      style={[
        styles.notice,
        styles[`${tone}Notice`],
        {
          opacity: entrance,
          transform: [
            { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) },
          ],
        },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={[styles.noticeText, tone === 'error' && styles.errorText, onDismiss && styles.noticeTextInset]}>
        {message}
      </Text>
      {onDismiss && (
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={12}
          style={styles.noticeClose}
        >
          <Text style={styles.noticeCloseText}>×</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  // Every screen sits on the dark base, so the light-surface text colours render
  // charcoal on charcoal — the empty state was there but invisible. Same class of
  // bug as the button variants (see Button.tsx).
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.textOnDark, textAlign: 'center' },
  emptyBody: { fontSize: 15, color: colors.textOnDarkMuted, textAlign: 'center', lineHeight: 22 },
  emptyVoice: {
    fontSize: 14,
    color: colors.textOnDarkMuted,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },
  loadingLine: {
    fontSize: 13,
    color: colors.textOnDarkMuted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  notice: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  errorNotice: { backgroundColor: '#FDECEA', borderColor: '#F5C6C0' },
  // baseElevated, not surfaceSunken: the rebrand turned surfaceSunken into a
  // DARK panel token, and ink text on it was black-on-black — "We sent a code
  // to…" was invisible at the exact moment a member needed to read it.
  infoNotice: { backgroundColor: colors.baseElevated, borderColor: colors.border },
  successNotice: { backgroundColor: '#E8FBF0', borderColor: '#A9EFC8' },
  noticeText: { fontSize: 15, color: colors.textPrimary, lineHeight: 21 },
  noticeTextInset: { paddingRight: spacing.lg },
  noticeClose: { position: 'absolute', top: 6, right: 10, padding: 4 },
  noticeCloseText: { fontSize: 20, lineHeight: 22, color: colors.textSecondary },
  errorText: { color: '#8A1C12' },
});
