import { Alert, Platform } from 'react-native';

/**
 * Ask before something irreversible.
 *
 * Exists because react-native-web's Alert is a literal no-op — its whole
 * implementation is `static alert() {}`. On web, `Alert.alert` therefore shows
 * nothing and invokes nothing, so a destructive button wired straight to it
 * silently does nothing at all. That is both a dead end for anyone running the
 * web build and a hole in what can be tested there.
 *
 * Native keeps the real system dialog; web falls back to window.confirm.
 */
export function confirmDestructive({
  title,
  message,
  confirmLabel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
}): Promise<boolean> {
  if (Platform.OS === 'web') {
    // window.confirm has no notion of a "destructive" button, so the title has
    // to carry the weight the red styling would on native.
    return Promise.resolve(
      typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`),
    );
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
