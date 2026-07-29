import { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@mvmnt/shared';
import { Button } from './Button';

/**
 * The floor under the whole tree.
 *
 * Before this existed, one render throw anywhere was a blank white screen
 * with no way back — and on a member's phone, no console for anyone to read.
 * The audit council ranked its absence the most expensive gap in the app
 * because its cost is unbounded and unmeasurable: you simply never hear about
 * the crashes.
 *
 * This is the half that needs no account: catch, show something human, offer
 * a way back, and log locally. The other half — shipping the stack trace to a
 * crash service — needs a Sentry (or similar) account and lives in
 * docs/dev-todo.md with the other account-gated work.
 */
export class CrashBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // The one place console.error is the right tool: locally it reaches the
    // developer, and the crash-service hook slots in here later.
    console.error('MVMNT crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.screen}>
        <Text style={styles.wordmark}>MVMNT</Text>
        <Text style={styles.title}>That wasn&rsquo;t supposed to happen.</Text>
        <Text style={styles.body}>
          Something broke on our side — not yours. Your points, sign-ups and everything else are
          safe on the server.
        </Text>
        <Button label="Take me back" onPress={() => this.setState({ error: null })} />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.base,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  wordmark: { fontSize: 28, fontWeight: '900', letterSpacing: 6, color: colors.textPrimary },
  title: { fontSize: 19, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  body: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
});
