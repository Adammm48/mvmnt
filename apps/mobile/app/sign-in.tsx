import { useEffect, useState } from 'react';
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
import { adamSays, colors, radius, spacing, toMemberMessage, MIN_TOUCH_TARGET, SIGNATURE, TAGLINE } from '@mvmnt/shared';

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
  const [newHere, setNewHere] = useState(false);
  const [oauthReady, setOauthReady] = useState(false);

  useEffect(() => {
    supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'oauth_sign_in')
      .maybeSingle()
      .then(({ data }) => setOauthReady(data?.enabled ?? false));
  }, []);

  /**
   * Two deliberate steps instead of one silent one.
   *
   * This used to send shouldCreateUser: true for every address, which meant a
   * TYPO became an account: mistype your own email and you are quietly signed
   * into a fresh, empty profile with no points, no history and no hint of what
   * happened — it looks exactly like the club wiped your record. Two ghost
   * accounts existed within weeks, one of them the developer's own.
   *
   * Now an unknown email is said out loud: "No account yet — join?". A member
   * who mistyped sees the typo in front of them; a genuinely new member taps
   * once more and is in. Joining stays one tap — the club is open — it is
   * only no longer an accident.
   */
  async function sendCode(createIfNew = false) {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }

    setBusy(true);
    setError(null);
    setNewHere(false);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { shouldCreateUser: createIfNew },
    });
    setBusy(false);

    if (sendError) {
      // Supabase's "no such user" refusal, worded by the server as a signup
      // restriction. Anything else is a real failure and reports as one.
      if (/signup|not allowed|not found/i.test(sendError.message)) {
        setEmail(trimmed);
        setNewHere(true);
        return;
      }
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
            <Text style={styles.tagline}>{TAGLINE}</Text>
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
                onSubmitEditing={() => sendCode()}
                returnKeyType="go"
                editable={!busy}
              />
              <Button
                label="Send me a code"
                onPress={() => sendCode()}
                loading={busy}
                accessibilityHint="Sends a six digit sign-in code to your email"
              />

              {/* The unknown-email fork, said in the open. One extra tap for a
                  genuinely new member; a saved account for anyone who slipped
                  a letter. */}
              {newHere && (
                <View style={styles.newHere}>
                  <Text style={styles.newHereText}>
                    No account uses {email} yet. If that is a typo, fix it above — if you are new,
                    welcome.
                  </Text>
                  <Button
                    label="I'm new — create my account"
                    variant="secondary"
                    onPress={() => sendCode(true)}
                    loading={busy}
                  />
                </View>
              )}
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

          {/* The OAuth pair renders only when the club's OAuth apps actually
              exist (the oauth_sign_in flag, flipped from the console — no app
              release needed). Rendering them earlier as dead stubs was a
              store-rejectable lie; hiding them entirely lost a sign-in the
              owner wants. The flag is the honest middle. They ship as a PAIR
              because Apple requires its own sign-in wherever Google's is
              offered. */}
          {oauthReady && (
            <>
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>
              <View style={styles.social}>
                <Button label="Continue with Apple" variant="secondary" onPress={() => socialSignIn('apple')} />
                <Button label="Continue with Google" variant="secondary" onPress={() => socialSignIn('google')} />
              </View>
            </>
          )}

          {/* The signature, on the front door — same string everywhere it
              appears (SIGNATURE), so the credit is one edit, not a search. */}
          {/* One line a day, before anyone is signed in — the door has a
              doorman. Daily-stable, so it does not reshuffle on every keystroke. */}
          <Text style={styles.voiceLine}>{adamSays('sign_in', { stability: 'daily' })}</Text>
          <Text style={styles.credit}>Developed by {SIGNATURE.name}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  newHere: { gap: spacing.sm, marginTop: spacing.xs },
  newHereText: { color: colors.textOnDarkMuted, fontSize: 14, lineHeight: 20 },
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
    borderColor: colors.border,
  },
  codeInput: { fontSize: 24, letterSpacing: 8, textAlign: 'center', fontVariant: ['tabular-nums'] },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textOnDarkMuted, fontSize: 13 },
  social: { gap: spacing.sm },
  socialNote: { textAlign: 'center', color: colors.textOnDarkMuted, fontSize: 13 },
  voiceLine: {
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  credit: {
    textAlign: 'center',
    color: colors.textOnDarkMuted,
    fontSize: 12,
    marginTop: spacing.lg,
  },
});
