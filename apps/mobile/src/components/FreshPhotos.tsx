import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '@mvmnt/shared';
import { supabase } from '@/lib/supabase';

type PublishedGallery = {
  id: string;
  title: string;
  starts_at: string;
  photos_published_at: string;
};

/**
 * Recently published galleries, on the home screen.
 *
 * This is the front door the feature was missing. The only other path to a
 * gallery was the run detail of that specific run — and the home screen lists
 * upcoming runs, so a gallery on a *finished* run was published, permitted,
 * and unreachable. The push notification that deep-links members there exists
 * but is off until the club owns push credentials, which made this hole
 * invisible in every test that followed a notification. Found by the owner
 * pressing "publish" and then not being able to find their own photos.
 *
 * Two weeks of shelf life: photo galleries are news, not an archive, and a
 * home screen that grows a permanent history section stops being about
 * Saturday. Older galleries stay reachable through their run.
 */
export function FreshPhotos() {
  const router = useRouter();
  const [galleries, setGalleries] = useState<PublishedGallery[]>([]);

  useEffect(() => {
    supabase
      .from('runs')
      .select('id, title, starts_at, photos_published_at')
      .not('photos_published_at', 'is', null)
      .gte('photos_published_at', new Date(Date.now() - 14 * 86400_000).toISOString())
      .order('photos_published_at', { ascending: false })
      .limit(3)
      .then(({ data }) => setGalleries((data as PublishedGallery[]) ?? []));
  }, []);

  if (galleries.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Fresh photos</Text>
      {galleries.map((g) => (
        <Pressable
          key={g.id}
          style={styles.card}
          onPress={() => router.push(`/photos/${g.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Photos from ${g.title}`}
        >
          <Text style={styles.cardTitle}>{g.title}</Text>
          <Text style={styles.cardMeta}>
            {new Date(g.starts_at).toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'short',
            })}
            {'  ·  '}See the photos →
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  title: { fontSize: 18, fontWeight: '800', color: colors.textOnDark },
  card: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textOnDark },
  cardMeta: { fontSize: 13, color: colors.textOnDarkMuted },
});
