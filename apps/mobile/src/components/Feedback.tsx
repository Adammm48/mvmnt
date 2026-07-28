import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '@mvmnt/shared';

/**
 * Loading, empty and error states.
 *
 * Principles §14 lists loading and empty states as part of "done", and App Spec
 * §2 asks for encouragement rather than blankness — so an empty list is an
 * invitation, not an apology.
 */

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <View style={styles.centered} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.action} />
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.centered} accessibilityRole="summary">
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

type NoticeTone = 'error' | 'info' | 'success';

export function Notice({ tone, message }: { tone: NoticeTone; message: string }) {
  return (
    <View
      style={[styles.notice, styles[`${tone}Notice`]]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={[styles.noticeText, tone === 'error' && styles.errorText]}>{message}</Text>
    </View>
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
  notice: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  errorNotice: { backgroundColor: '#FDECEA', borderColor: '#F5C6C0' },
  infoNotice: { backgroundColor: colors.surfaceSunken, borderColor: colors.border },
  successNotice: { backgroundColor: '#E8FBF0', borderColor: '#A9EFC8' },
  noticeText: { fontSize: 15, color: colors.textPrimary, lineHeight: 21 },
  errorText: { color: '#8A1C12' },
});
