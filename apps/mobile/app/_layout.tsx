import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppState } from 'react-native';
import { AuthProvider, useAuth } from '@/lib/auth';
import { Loading } from '@/components/Feedback';
import { flush } from '@/lib/checkInQueue';
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

    flush().catch(() => {});
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') flush().catch(() => {});
    });
    return () => subscription.remove();
  }, [session]);

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
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
