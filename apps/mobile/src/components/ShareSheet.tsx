import { useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, type Standing } from '@mvmnt/shared';
import { ShareCard } from './ShareCard';
import { Button } from './Button';
import { shareStandingCard } from '@/lib/share';

/**
 * Sharing, designed so the button can never do nothing.
 *
 * The first version handed the card straight to the platform share sheet. On
 * web there is no share sheet — `navigator.share` is undefined outside a couple
 * of browsers — so pressing the button produced no sheet, no card and no error.
 *
 * Showing the card is now the primary act, and handing it to the OS is the
 * bonus. That inverts the failure: the worst case is a member looking at a
 * finished card they can screenshot, which is what most people do with these
 * anyway. It also means the feature works identically on a locked-down browser
 * and a brand-new iPhone.
 */
export function ShareSheet({
  standing,
  displayName,
  onClose,
}: {
  standing: Standing;
  displayName: string;
  onClose: () => void;
}) {
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function hand() {
    setBusy(true);
    setNote(null);

    const outcome = await shareStandingCard(
      cardRef,
      `${standing.points} points and ${standing.runs_attended} runs with MVMNT. ` +
        'Powered by MVMNT — built by Adam Elbasiony.',
    );

    setBusy(false);
    // Every outcome says something. Silence is what made the old version look
    // broken even when it had worked.
    if (outcome.kind === 'shared') onClose();
    else if (outcome.kind === 'copied' || outcome.kind === 'failed') setNote(outcome.message);
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.cardWrap}>
            <ShareCard ref={cardRef} standing={standing} displayName={displayName} />
          </View>

          <Text style={styles.hint}>
            {Platform.OS === 'web'
              ? 'Screenshot this to post it. The button below copies the text.'
              : 'Post it, or screenshot it — whichever is quicker.'}
          </Text>

          {note && <Text style={styles.note}>{note}</Text>}

          <View style={styles.actions}>
            <Button
              label={Platform.OS === 'web' ? 'Copy the text' : 'Share'}
              onPress={hand}
              loading={busy}
            />
            <Button label="Done" variant="secondary" onPress={onClose} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Nearly opaque. At 0.92 the leaderboard behind showed through the caption
  // and the two sets of text fought each other.
  backdrop: { flex: 1, backgroundColor: 'rgba(10, 12, 18, 0.985)' },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  // The card renders at its real size here rather than scaled, so what the
  // member screenshots is what the capture would have produced.
  cardWrap: { borderRadius: radius.lg, overflow: 'hidden' },
  hint: { fontSize: 14, color: colors.textOnDarkMuted, textAlign: 'center', lineHeight: 20 },
  note: { fontSize: 14, color: colors.success, textAlign: 'center', lineHeight: 20 },
  actions: { alignSelf: 'stretch', maxWidth: 360, gap: spacing.sm },
});
