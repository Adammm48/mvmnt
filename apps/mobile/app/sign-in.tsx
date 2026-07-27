import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Feedback';
import { colors, radius, spacing, toMemberMessage, MIN_TOUCH_TARGET } from '@mvmnt/shared';

type Step = 'email' | 'code';

/**
 * Sign-in.
 *
 * Email one-time code is the working path. Apple and Google are wired to
 * Supabase's OAuth flow but cannot function until MVMNT owns an Apple Developer
 * account and a Firebase project, so they are shown as unavailable rather than
 * as dead buttons that fail silently when tapped.
 */
export default function SignIn() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function sendCode() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }

    setBusy(true);
    setError(null);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { shouldCreateUser: true },
    });
    setBusy(false);

    if (sendError) {
      setError(toMemberMessage(sendError));
      return;
    }
    setEmail(trimmed);
    setInfo(`We sent a 6-digit code to ${trimmed}`);
    setStep('code');
  }

  async function verifyCode() {
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);

    // No navigation here: the auth listener in AuthProvider notices the new
    // session and the root layout redirects. One place decides where a signed-in
    // member lands.
    if (verifyError) setError(toMemberMessage(verifyError, 'That code was not right. Try again.'));
  }

  async function socialSignIn(provider: 'apple' | 'google') {
    setError(
      `${provider === 'apple' ? 'Apple' : 'Google'} sign-in is not available yet — it needs MVMNT's developer accounts. Use your email for now.`,
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Text style={styles.wordmark}>MVMNT</Text>
            <Text style={styles.tagline}>Run together.</Text>
          </View>

          {error && <Notice tone="error" message={error} />}
          {info && !error && <Notice tone="info" message={info} />}

          {step === 'email' ? (
            <View style={styles.form}>
              <Text style={styles.label} nativeID="email-label">
                Email
              </Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.textOnDarkMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                accessibilityLabelledBy="email-label"
                accessibilityLabel="Email address"
                onSubmitEditing={sendCode}
                returnKeyType="go"
                editable={!busy}
              />
              <Button
                label="Send me a code"
                onPress={sendCode}
                loading={busy}
                accessibilityHint="Sends a six digit sign-in code to your email"
              />
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={styles.label} nativeID="code-label">
                6-digit code
              </Text>
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor={colors.textOnDarkMuted}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={6}
                accessibilityLabelledBy="code-label"
                accessibilityLabel="Six digit code"
                onSubmitEditing={verifyCode}
                editable={!busy}
                autoFocus
              />
              <Button label="Sign in" onPress={verifyCode} loading={busy} />
              <Button
                label="Use a different email"
                variant="quiet"
                onPress={() => {
                  setStep('email');
                  setCode('');
                  setInfo(null);
                  setError(null);
                }}
              />
            </View>
          )}

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.social}>
            <Button label="Continue with Apple" variant="secondary" onPress={() => socialSignIn('apple')} />
            <Button label="Continue with Google" variant="secondary" onPress={() => socialSignIn('google')} />
            <Text style={styles.socialNote}>Coming soon</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base },
  flex: { flex: 1 },
  container: { padding: spacing.lg, gap: spacing.lg, flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md },
  wordmark: { fontSize: 40, fontWeight: '800', color: colors.textOnDark, letterSpacing: 2 },
  tagline: { fontSize: 16, color: colors.textOnDarkMuted },
  form: { gap: spacing.sm },
  label: { fontSize: 14, fontWeight: '600', color: colors.textOnDarkMuted },
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
  codeInput: { fontSize: 24, letterSpacing: 8, textAlign: 'center', fontVariant: ['tabular-nums'] },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#3A4152' },
  dividerText: { color: colors.textOnDarkMuted, fontSize: 13 },
  social: { gap: spacing.sm },
  socialNote: { textAlign: 'center', color: colors.textOnDarkMuted, fontSize: 13 },
});
