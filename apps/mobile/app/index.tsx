import { useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useRuns } from '@/lib/useRuns';
import { RunCard } from '@/components/RunCard';
import { EmptyState, Loading, Notice } from '@/components/Feedback';
import { registerForPush } from '@/lib/push';
import { colors, spacing, toMemberMessage } from '@mvmnt/shared';

export default function Home() {
  const { session, profile } = useAuth();
  const router = useRouter();
  const { items, loading, refreshing, error, reload } = useRuns(session?.user.id);

  // Registering on every launch is what keeps a handed-down device pointed at
  // its current owner — register_push_token() reassigns on conflict.
  useEffect(() => {
    registerForPush();
  }, []);

  // Coming back from a run detail should show the join that just happened.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (loading) return <Loading label="Loading runs" />;

  const firstName = profile?.display_name?.split(' ')[0];

  return (
    <View style={styles.screen}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.run.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => reload(true)}
            tintColor={colors.textOnDarkMuted}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.greeting}>
                  {firstName ? `Hey ${firstName}` : 'Welcome'}
                </Text>
                <Text style={styles.subGreeting}>{encouragement(items.length)}</Text>
              </View>
              <Pressable
                onPress={() => router.push('/profile')}
                accessibilityRole="button"
                accessibilityLabel="Profile and settings"
                hitSlop={12}
              >
                <Text style={styles.profileLink}>Profile</Text>
              </Pressable>
            </View>
            {error && <Notice tone="error" message={toMemberMessage({ message: error })} />}
          </View>
        }
        renderItem={({ item }) => (
          <RunCard
            run={item.run}
            counts={item.counts}
            myState={item.myState}
            onPress={() => router.push(`/run/${item.run.id}`)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <EmptyState
            title="Nothing on the calendar yet"
            body="The moment the organisers drop the next run, it lands here and we'll ping you. Won't be long."
          />
        }
      />
    </View>
  );
}

/**
 * A warm line under the greeting. App Spec §2 asks for momentum framed
 * positively — the copy leans on what is coming up rather than counting what
 * anyone has missed.
 */
function encouragement(count: number): string {
  if (count === 0) return 'Next run drops soon';
  if (count === 1) return 'One run on the horizon';
  return `${count} runs coming up`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  list: { padding: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 },
  header: { marginBottom: spacing.lg, gap: spacing.sm, paddingTop: spacing.xs },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  greeting: { fontSize: 30, fontWeight: '900', color: colors.textOnDark, letterSpacing: -0.5 },
  subGreeting: { fontSize: 15, color: colors.textOnDarkMuted, marginTop: 2 },
  profileLink: { fontSize: 15, fontWeight: '600', color: colors.textOnDarkMuted },
});
