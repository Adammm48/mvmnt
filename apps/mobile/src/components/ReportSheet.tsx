import { useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing, toMemberMessage } from '@mvmnt/shared';
import { supabase } from '@/lib/supabase';
import { Button } from './Button';

/**
 * Reporting content to the organisers — App Store guideline 1.2 and Google
 * Play's UGC policy both require that members can flag objectionable content
 * from inside the app, not merely that the club can act when asked in person.
 * The audit council found the app rejectable without it.
 *
 * One sheet for every reportable kind (photos, gift messages). The reason is
 * required because it is what the organiser acts on; the server enforces the
 * same rule, so an empty submission fails identically everywhere.
 */
export function ReportSheet({
  kind,
  targetId,
  what,
  onClose,
}: {
  kind: 'photo' | 'gift_message';
  targetId: string;
  /** Shown in the title: "this photo", "this message". */
  what: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('report_content', {
      p_kind: kind,
      p_target_id: targetId,
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (rpcError) {
      setError(toMemberMessage(rpcError));
      return;
    }
    setSent(true);
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {sent ? (
            <>
              <Text style={styles.title}>Sent to the organisers</Text>
              <Text style={styles.body}>
                They see every report and can remove content on the spot. If it is about a person
                rather than a picture, you can also remove them as a friend from the Friends screen —
                that stops anything further reaching you.
              </Text>
              <Button label="Done" onPress={onClose} />
            </>
          ) : (
            <>
              <Text style={styles.title}>Report {what}</Text>
              <Text style={styles.body}>
                Tell the organisers what is wrong. They read every report.
              </Text>
              <TextInput
                style={styles.input}
                value={reason}
                onChangeText={setReason}
                placeholder="What should the organisers know?"
                placeholderTextColor={colors.textSecondary}
                multiline
                maxLength={500}
                accessibilityLabel="Reason for the report"
              />
              {error && <Text style={styles.error}>{error}</Text>}
              <Button
                label={busy ? 'Sending…' : 'Send report'}
                onPress={submit}
                disabled={busy || reason.trim().length < 3}
              />
              <Button label="Cancel" variant="quiet" onPress={onClose} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.base,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { fontSize: 19, fontWeight: '800', color: colors.textPrimary },
  body: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 88,
    fontSize: 15,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  error: { fontSize: 13, color: colors.alert },
});
