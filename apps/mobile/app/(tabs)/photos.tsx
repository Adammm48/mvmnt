import { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { colors, radius, spacing } from '@mvmnt/shared';
import { useAuth } from '@/lib/auth';
import { loadGalleries, galleryDateLabel, type GalleryCard } from '@/lib/galleries';
import { EmptyState, Loading } from '@/components/Feedback';

/**
 * The Photos tab: every published gallery, newest first, as labelled cards —
 * a real photo as the cover, the run's name, the date and the count. The
 * owner's words on the previous text-only version: photos deserve better
 * placement than a "see the photos" line. They do.
 *
 * "Find me in photos" lives at the top because this is the room where the
 * question occurs to you — scrolling a hundred crowd shots is the moment a
 * member wants the app to do the scrolling.
 */
export default function PhotosTab() {
  const { session } = useAuth();
  const router = useRouter();
  const [galleries, setGalleries] = useState<GalleryCard[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadGalleries().then(setGalleries);
    }, []),
  );

  if (galleries === null) return <Loading label="Fetching the good ones" />;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.list}
      data={galleries}
      keyExtractor={(g) => g.id}
      ListHeaderComponent={
        <Pressable
          onPress={() => router.push('/photos/find-me')}
          style={styles.findMe}
          accessibilityRole="button"
          accessibilityLabel="Find me in photos"
        >
          <Text style={styles.findMeTitle}>Find me in photos</Text>
          <Text style={styles.findMeBody}>
            One selfie, and galleries grow a &ldquo;You&rdquo; tab so you skip the scrolling.
          </Text>
        </Pressable>
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push(`/photos/${item.id}`)}
          style={styles.card}
          accessibilityRole="button"
          accessibilityLabel={`Photos from ${item.title}, ${item.count} photos`}
        >
          {item.coverUrl !== '' && (
            <Image source={{ uri: item.coverUrl }} style={styles.cover} resizeMode="cover" />
          )}
          <View style={styles.caption}>
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.meta}>
              {galleryDateLabel(item.starts_at)} · {item.count}{' '}
              {item.count === 1 ? 'photo' : 'photos'}
            </Text>
          </View>
        </Pressable>
      )}
      ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      ListEmptyComponent={
        <EmptyState
          title="No photos yet"
          body="When the club publishes a run's photos, every gallery lands here — newest at the top."
          voice="photos_published"
          userId={session?.user.id}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  findMe: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  findMeTitle: { fontSize: 15, fontWeight: '800', color: colors.action },
  findMeBody: { fontSize: 13, color: colors.textOnDarkMuted, lineHeight: 18 },
  card: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  cover: { width: '100%', aspectRatio: 16 / 9 },
  caption: { padding: spacing.md, gap: 2 },
  title: { fontSize: 17, fontWeight: '800', color: colors.textOnDark },
  meta: { fontSize: 13, color: colors.textOnDarkMuted },
});
