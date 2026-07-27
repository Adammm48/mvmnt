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
              <Text style={styles.greeting}>
                {firstName ? `Hey ${firstName}` : 'Upcoming runs'}
              </Text>
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
            title="No runs scheduled yet"
            body="When the organisers publish the next run, it will show up here and you'll get a notification."
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  list: { padding: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 },
  header: { marginBottom: spacing.md, gap: spacing.sm },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  greeting: { fontSize: 26, fontWeight: '800', color: colors.textOnDark },
  profileLink: { fontSize: 15, fontWeight: '600', color: colors.textOnDarkMuted },
});
