import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, radius, spacing } from '@mvmnt/shared';
import { loadGalleries, galleryDateLabel, type GalleryCard } from '@/lib/galleries';

/**
 * Recently published galleries, on the home screen.
 *
 * This is the front door the feature was missing: the only other path to a
 * gallery was the run detail of that specific run, and home lists upcoming
 * runs — so a published gallery on a finished run was unreachable. Found by
 * the owner pressing "publish" and not finding their own photos.
 *
 * Labelled cards, not text rows (also the owner's call): a real photo as the
 * cover, the run's name, the count. Two weeks of shelf life — galleries are
 * news here, and the Photos tab is the full archive.
 */
export function FreshPhotos() {
  const router = useRouter();
  const [galleries, setGalleries] = useState<GalleryCard[]>([]);

  useEffect(() => {
    // One card, the newest. Two pushed Saturday's run below the fold, and the
    // home screen's job is the next run — the Photos tab is the archive.
    loadGalleries({ limit: 1, sinceDays: 14 }).then(setGalleries);
  }, []);

  if (galleries.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Fresh photos</Text>
        <Pressable
          onPress={() => router.push('/photos')}
          accessibilityRole="button"
          accessibilityLabel="All photos"
        >
          <Text style={styles.all}>All photos →</Text>
        </Pressable>
      </View>

      {galleries.map((g) => (
        <Pressable
          key={g.id}
          style={styles.card}
          onPress={() => router.push(`/photos/${g.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Photos from ${g.title}, ${g.count} photos`}
        >
          {g.coverUrl !== '' && (
            <Image source={{ uri: g.coverUrl }} style={styles.cover} resizeMode="cover" />
          )}
          <View style={styles.caption}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {g.title}
            </Text>
            <Text style={styles.cardMeta}>
              {galleryDateLabel(g.starts_at)} · {g.count} {g.count === 1 ? 'photo' : 'photos'}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '800', color: colors.textOnDark },
  all: { fontSize: 13, fontWeight: '700', color: colors.action },
  card: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  cover: { width: '100%', aspectRatio: 21 / 9 },
  caption: { padding: spacing.md, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textOnDark },
  cardMeta: { fontSize: 13, color: colors.textOnDarkMuted },
});
