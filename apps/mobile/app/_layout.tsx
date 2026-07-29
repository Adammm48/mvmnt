import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppState } from 'react-native';
import { AuthProvider, useAuth } from '@/lib/auth';
import { Loading } from '@/components/Feedback';
import { ConfirmHost } from '@/components/ConfirmHost';
import { flush } from '@/lib/checkInQueue';
import { publishSync } from '@/lib/syncStatus';
import { useNotificationRouting } from '@/lib/notificationRouting';
import { colors } from '@mvmnt/shared';

function RootNavigator() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthFlow = segments[0] === 'sign-in';
    if (!session && !inAuthFlow) router.replace('/sign-in');
    if (session && inAuthFlow) router.replace('/');
  }, [session, loading, segments, router]);

  /**
   * Replay any check-ins queued while offline, on every foreground.
   *
   * This is where a check-in tapped at a congested mass start actually lands.
   * check_in() is idempotent, so replaying one that already succeeded is a
   * no-op rather than a duplicate.
   */
  useEffect(() => {
    if (!session) return;

    // The result is published rather than discarded. `.catch(() => {})` here
    // meant a member whose queued check-in synced on the drive home was never
    // told — they spent the week believing they had missed a run they attended.
    const run = () =>
      flush()
        .then((result) => {
          if (result.synced > 0 || result.remaining > 0) publishSync(result);
        })
        .catch(() => publishSync({ synced: 0, remaining: 0, failed: true }));

    run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => subscription.remove();
  }, [session]);

  // Signed in and settled: a tapped notification may now route somewhere.
  // Gated on that, because routing to a run before auth resolves would bounce
  // off the sign-in redirect above and the tap would be lost.
  useNotificationRouting(!loading && !!session);

  if (loading) return <Loading label="Starting MVMNT" />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.base },
        headerTintColor: colors.textOnDark,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.base },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'MVMNT' }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="run/[id]" options={{ title: 'Run' }} />
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
      <Stack.Screen name="leaderboard" options={{ title: 'The board' }} />
      <Stack.Screen name="friends/index" options={{ title: 'Friends' }} />
      <Stack.Screen name="friends/code" options={{ title: 'Your code' }} />
      <Stack.Screen name="friends/scan" options={{ title: 'Scan a code' }} />
      <Stack.Screen name="about" options={{ title: 'About' }} />
      <Stack.Screen name="shop/index" options={{ title: 'Shop' }} />
      <Stack.Screen name="shop/[id]" options={{ title: '' }} />
      <Stack.Screen name="orders" options={{ title: 'Your orders' }} />
      <Stack.Screen name="photos/[runId]" options={{ title: 'Photos' }} />
      <Stack.Screen name="photos/find-me" options={{ title: 'Find me in photos' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <RootNavigator />
        {/* One host for every confirmation in the app. See lib/confirm.ts for
            why neither platform dialog could be trusted with this. */}
        <ConfirmHost />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
