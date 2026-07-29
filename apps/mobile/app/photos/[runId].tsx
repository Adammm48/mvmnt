import { useCallback, useEffect, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Loading, EmptyState, Notice } from '@/components/Feedback';
import { adamSays, colors, radius, spacing, toMemberMessage, typography } from '@mvmnt/shared';
import type { Database } from '@mvmnt/shared';

type PhotoCategory = Database['public']['Enums']['photo_category'];
type PhotoRow = Database['public']['Tables']['run_photos']['Row'];

/** The club's Drive folders, in the order the day happened. */
const CATEGORIES: { value: PhotoCategory; label: string }[] = [
  { value: 'pre_run', label: 'Pre-run' },
  { value: 'run', label: 'The run' },
  { value: 'after', label: 'After' },
  { value: 'camera', label: 'Camera' },
];

type Photo = PhotoRow & { url: string };

/**
 * A run's photo gallery.
 *
 * Only reachable once the organiser has published — before that the rows are
 * invisible to members at the database, so this screen simply finds nothing.
 *
 * The bucket is private, so every image is fetched through a short-lived
 * signed URL minted for this member's session. Nothing here is shareable by
 * copying a link, which for photos of identifiable people is the point.
 */
export default function RunPhotos() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const navigation = useNavigation();
  const { session } = useAuth();

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [category, setCategory] = useState<PhotoCategory>('run');
  const [viewing, setViewing] = useState<Photo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!runId) return;

    const [{ data: run }, { data: rows, error: loadError }] = await Promise.all([
      supabase.from('runs').select('title').eq('id', runId).maybeSingle(),
      supabase
        .from('run_photos')
        .select('*')
        .eq('run_id', runId)
        .order('created_at'),
    ]);

    if (run) navigation.setOptions({ title: `Photos · ${run.title}` });
    if (loadError) {
      setError(toMemberMessage(loadError));
      setLoading(false);
      return;
    }

    const list = rows ?? [];
    if (list.length === 0) {
      setPhotos([]);
      setLoading(false);
      return;
    }

    // One batch call for every URL rather than one round-trip per image.
    // An hour comfortably outlives a scroll through the gallery.
    const { data: signed, error: signError } = await supabase.storage
      .from('gallery-media')
      .createSignedUrls(list.map((p) => p.storage_path), 3600);

    if (signError) {
      setError(toMemberMessage(signError));
      setLoading(false);
      return;
    }

    setPhotos(
      list
        .map((p, i) => ({ ...p, url: signed?.[i]?.signedUrl ?? '' }))
        .filter((p) => p.url !== ''),
    );
    setLoading(false);
  }, [runId, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;

  const inCategory = photos.filter((p) => p.category === category);
  const countFor = (c: PhotoCategory) => photos.filter((p) => p.category === c).length;

  // Hide empty folders instead of offering four tabs where two do nothing —
  // most runs will have photos in one or two of them.
  const visibleCategories = CATEGORIES.filter((c) => countFor(c.value) > 0);

  if (photos.length === 0) {
    return (
      <View style={styles.screen}>
        {error && <Notice tone="error" message={error} />}
        <EmptyState
          title="No photos here yet"
          body="When the club publishes this run's photos, this is where they'll be."
        />
      </View>
    );
  }

  // If the picked folder is empty (or hidden), fall through to the first one
  // that has photos rather than showing a blank grid.
  const effective = visibleCategories.some((c) => c.value === category)
    ? category
    : visibleCategories[0]!.value;
  const shown = effective === category ? inCategory : photos.filter((p) => p.category === effective);

  return (
    <View style={styles.screen}>
      {error && <Notice tone="error" message={error} />}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabs}
        contentContainerStyle={styles.tabsContent}
      >
        {visibleCategories.map((c) => {
          const active = effective === c.value;
          return (
            <Pressable
              key={c.value}
              onPress={() => setCategory(c.value)}
              style={[styles.tab, active && styles.tabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {c.label} · {countFor(c.value)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* One quiet line, stable for the day — flavour, not furniture. */}
      <Text style={styles.voice}>
        {adamSays('photos_published', { userId: session?.user.id, stability: 'daily' })}
      </Text>

      <FlatList
        data={shown}
        keyExtractor={(p) => p.id}
        numColumns={3}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setViewing(item)}
            style={styles.cell}
            accessibilityRole="imagebutton"
            accessibilityLabel="Open photo"
          >
            <Image source={{ uri: item.url }} style={styles.thumb} />
          </Pressable>
        )}
      />

      {/*
        The viewer is a plain modal rather than a pager: tap to look, tap to
        leave. Swiping between photos can come with the face-matching phase if
        the gallery grows past what a grid handles.
      */}
      <Modal visible={viewing !== null} transparent animationType="fade">
        <Pressable
          style={styles.viewer}
          onPress={() => setViewing(null)}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
        >
          {viewing && (
            <Image source={{ uri: viewing.url }} style={styles.full} resizeMode="contain" />
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

const GAP = 3;
const COLUMNS = 3;
const CELL = (Dimensions.get('window').width - GAP * (COLUMNS - 1)) / COLUMNS;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  tabs: { flexGrow: 0 },
  tabsContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.baseElevated,
  },
  tabActive: { backgroundColor: colors.action },
  tabText: { ...typography.label, color: colors.textOnDarkMuted },
  tabTextActive: { color: colors.textOnDark },
  voice: {
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.textOnDarkMuted,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  grid: { paddingBottom: spacing.xl },
  row: { gap: GAP, marginBottom: GAP },
  cell: { width: CELL, height: CELL },
  thumb: { width: '100%', height: '100%', backgroundColor: colors.baseElevated },
  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center',
  },
  full: { width: '100%', height: '80%' },
});
