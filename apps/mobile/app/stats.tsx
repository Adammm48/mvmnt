import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@mvmnt/shared';
import { adamSays, describeStreakShort, TIER_LABEL } from '@mvmnt/shared';
import type { Database } from '@mvmnt/shared';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { getHealthProvider, type HealthStats } from '@/lib/health';
import { Loading } from '@/components/Feedback';

type Standing = Database['public']['Functions']['my_standing']['Returns'][number];

/**
 * Your stats — the two halves of App Spec §4.7 and §10, on one screen.
 *
 * The CLUB half works everywhere today: runs, kilometres, streak, tier — all
 * derived from attendance the server already holds, nothing new collected.
 *
 * The DEVICE half (steps, pace, heart rate) renders through the health seam
 * in lib/health.ts, which currently reports — honestly — that no health
 * source exists in this build. The section says "coming with the app stores"
 * rather than pretending: HealthKit needs MVMNT's Apple Developer account
 * and Health Connect needs a Play Console declaration, and per ADR 0005 §1
 * the numbers will render on-device only, never stored server-side.
 */
export default function Stats() {
  const { session } = useAuth();
  const [standing, setStanding] = useState<Standing | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [health, setHealth] = useState<HealthStats | null>(null);
  const [loading, setLoading] = useState(true);

  const provider = getHealthProvider();

  useEffect(() => {
    Promise.all([
      supabase.rpc('my_standing', { p_window: 'all_time' }),
      supabase.rpc('my_distance_meters'),
      provider.availability === 'granted' ? provider.read() : Promise.resolve(null),
    ]).then(([mine, dist, device]) => {
      setStanding((mine.data ?? [])[0] ?? null);
      setDistance(dist.data ?? null);
      setHealth(device);
      setLoading(false);
    });
    // provider is a module-level singleton; its identity never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <Loading label="Adding it all up" />;

  const km = distance != null ? Math.round(distance / 1000) : 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.voice}>
        {adamSays('stats_intro', { userId: session?.user.id, stability: 'daily' })}
      </Text>

      <Text style={styles.sectionTitle}>With the club</Text>
      <View style={styles.grid}>
        <StatCard value={`${standing?.runs_attended ?? 0}`} label="runs" />
        {/* "0K with the club" reads like a broken counter, not an invitation
            (owner finding). Before the first check-in the card says what the
            number is waiting for. */}
        <StatCard value={km > 0 ? `${km}K` : '—'} label={km > 0 ? 'with the club' : 'first run pending'} />
        <StatCard value={describeStreakShort(standing?.streak_weeks ?? 0)} label="week streak" />
        <StatCard
          value={standing?.tier ? TIER_LABEL[standing.tier] : '—'}
          label="tier"
        />
      </View>
      <Text style={styles.hint}>
        Counted from runs you actually checked in to, at the club&rsquo;s stated distances. No GPS
        trace, no guesswork — if you were there, it counts.
      </Text>

      <Text style={styles.sectionTitle}>From your phone</Text>
      {provider.availability === 'unavailable' ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Coming with the app stores</Text>
          <Text style={styles.cardBody}>
            Steps, pace and heart rate from Apple Health or Health Connect land here once MVMNT
            ships as a store app. One promise ahead of time: those numbers will show on your
            phone and go nowhere else — the club&rsquo;s servers will never see them.
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          <StatCard
            value={health?.stepsToday != null ? health.stepsToday.toLocaleString() : '—'}
            label="steps today"
          />
          <StatCard
            value={
              health?.distanceTodayMeters != null
                ? `${(health.distanceTodayMeters / 1000).toFixed(1)}K`
                : '—'
            }
            label="today"
          />
          <StatCard
            value={health?.restingHeartRate != null ? `${health.restingHeartRate}` : '—'}
            label="resting HR"
          />
        </View>
      )}
    </ScrollView>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.cardLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: spacing.lg, gap: spacing.md },
  voice: { fontSize: 13, color: colors.textOnDarkMuted, fontStyle: 'italic' },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textOnDark,
    marginTop: spacing.sm,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.md,
    minWidth: '46%',
    flexGrow: 1,
    gap: 4,
  },
  cardValue: { ...typography.data, fontSize: 26, color: colors.textOnDark },
  cardLabel: { fontSize: 13, color: colors.textOnDarkMuted },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textOnDark },
  cardBody: { fontSize: 13, color: colors.textOnDarkMuted, lineHeight: 19 },
  hint: { fontSize: 12, color: colors.textOnDarkMuted, lineHeight: 18 },
});
