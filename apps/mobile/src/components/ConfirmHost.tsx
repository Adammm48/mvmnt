import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '@mvmnt/shared';
import { Button } from './Button';
import { registerConfirmHost, type ConfirmRequest } from '@/lib/confirm';

/**
 * The "are you sure?" dialog, in the app.
 *
 * Mounted once at the root. It exists because both platform dialogs let us
 * down in the same way — silently:
 *
 *   · react-native-web's Alert is literally `static alert() {}`, so on web it
 *     showed nothing and resolved nothing.
 *   · window.confirm, the fallback that replaced it, is suppressed by browsers
 *     in embedded contexts and returns **false** when suppressed — which the
 *     caller reads as "the member said no". The button appears dead.
 *
 * That second one is why "Turn off my code" did nothing, and it was quietly
 * breaking "Delete my account" and "Remove friend" on the web build too. A
 * confirmation the app draws itself works everywhere and can be tested.
 */
export function ConfirmHost() {
  const [request, setRequest] = useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(
    null,
  );

  useEffect(() => registerConfirmHost((req, resolve) => setRequest({ ...req, resolve })), []);

  if (!request) return null;

  const settle = (ok: boolean) => {
    request.resolve(ok);
    setRequest(null);
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => settle(false)}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal accessibilityRole="alert">
          <Text style={styles.title}>{request.title}</Text>
          <Text style={styles.message}>{request.message}</Text>
          <View style={styles.actions}>
            <Button label="Cancel" variant="secondary" onPress={() => settle(false)} />
            <Button label={request.confirmLabel} variant="destructive" onPress={() => settle(true)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 12, 18, 0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    width: '100%',
    maxWidth: 380,
  },
  title: { fontSize: 19, fontWeight: '800', color: colors.textOnDark },
  message: { fontSize: 15, color: colors.textOnDarkMuted, lineHeight: 22 },
  actions: { gap: spacing.sm, marginTop: spacing.md },
});
