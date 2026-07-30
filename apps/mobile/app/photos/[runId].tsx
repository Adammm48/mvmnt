import { useCallback, useEffect, useState, useRef } from 'react';
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
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Loading, EmptyState, Notice } from '@/components/Feedback';
import { ReportSheet } from '@/components/ReportSheet';
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
  const router = useRouter();
  const { session } = useAuth();

  const [photos, setPhotos] = useState<Photo[]>([]);
  // 'you' is a virtual folder over the same photos: the ids the matcher thinks
  // this member appears in. It grants nothing — it filters what is already
  // visible (migration 0049).
  const [matchIds, setMatchIds] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<PhotoCategory | 'you'>('run');
  const [reporting, setReporting] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Photo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!runId) return;

    const [{ data: run }, { data: rows, error: loadError }, { data: matches }] =
      await Promise.all([
        supabase.from('runs').select('title').eq('id', runId).maybeSingle(),
        supabase
          .from('run_photos')
          .select('*')
          .eq('run_id', runId)
          .order('created_at'),
        supabase.rpc('my_photo_matches', { p_run_id: runId }),
      ]);

    setMatchIds(new Set((matches ?? []).map((m) => m.photo_id)));

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

  // A stable callback ref: FlatList refuses onViewableItemsChanged changing
  // between renders.
  const onViewablePhoto = useRef(
    ({ viewableItems }: { viewableItems: { item: Photo; isViewable: boolean }[] }) => {
      const visible = viewableItems.find((v) => v.isViewable)?.item;
      if (visible) setViewing((prev) => (prev && prev.id !== visible.id ? visible : prev));
    },
  ).current;

  if (loading) return <Loading />;

  const matching = (c: PhotoCategory | 'you') =>
    c === 'you' ? photos.filter((p) => matchIds.has(p.id)) : photos.filter((p) => p.category === c);
  const inCategory = matching(category);
  const countFor = (c: PhotoCategory | 'you') => matching(c).length;

  // Hide empty folders instead of offering four tabs where two do nothing —
  // most runs will have photos in one or two of them. "You" appears only when
  // the matcher has actually found something: an empty tab promising photos of
  // you is a broken promise, and matching may not be live yet.
  const visibleCategories: { value: PhotoCategory | 'you'; label: string }[] = [
    ...(countFor('you') > 0 ? [{ value: 'you' as const, label: 'You' }] : []),
    ...CATEGORIES.filter((c) => countFor(c.value) > 0),
  ];

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
  const shown = effective === category ? inCategory : matching(effective);

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

      <Pressable
        onPress={() => router.push('/photos/find-me')}
        style={styles.findMe}
        accessibilityRole="button"
        accessibilityLabel="Find me in photos"
      >
        <Text style={styles.findMeText}>
          {matchIds.size > 0 ? 'Manage “find me in photos”' : 'Find me in photos →'}
        </Text>
      </Pressable>

      {/*
        The viewer pages horizontally through the open category (owner ask:
        swipe left and right between photos). One FlatList with paging rather
        than a gesture library — momentum, edge bounce and the wide-image case
        all come from the platform, and there is no new dependency to justify.
        Tapping the photo closes, as before.
      */}
      <Modal visible={viewing !== null} transparent animationType="fade">
        {viewing && (
          <View style={styles.viewer}>
            <FlatList
              data={inCategory}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(p) => p.id}
              // Every page is exactly one screen wide, so layouts are knowable
              // without measuring — required for initialScrollIndex to work.
              getItemLayout={(_, index) => ({
                length: SCREEN_WIDTH,
                offset: SCREEN_WIDTH * index,
                index,
              })}
              initialScrollIndex={Math.max(
                inCategory.findIndex((p) => p.id === viewing.id),
                0,
              )}
              // Viewability, not momentum: onMomentumScrollEnd never fires on
              // web, so the counter froze at 1/N there while working on
              // phones. "Which photo is mostly on screen" is also simply the
              // truer question.
              onViewableItemsChanged={onViewablePhoto}
              viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
              // A plain page, not a tap-to-close one. Tap-anywhere-to-close
              // fought the swipe — any touch the list did not claim closed the
              // viewer mid-gesture. With paging, closing is the ✕'s job.
              renderItem={({ item }) => (
                <View style={{ width: SCREEN_WIDTH, height: '100%', justifyContent: 'center' }}>
                  <Image source={{ uri: item.url }} style={styles.full} resizeMode="contain" />
                </View>
              )}
            />

            <Pressable
              onPress={() => setViewing(null)}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close photos"
              hitSlop={12}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>

            {/* Where you are in the roll. */}
            <Text style={styles.pagePosition}>
              {Math.max(inCategory.findIndex((p) => p.id === viewing.id), 0) + 1} /{' '}
              {inCategory.length}
            </Text>

            {/* Reporting, on the photo itself — the store guideline (Apple 1.2,
                Play UGC) and plain decency both want the flag where the problem
                is, not buried in a settings page. */}
            <Pressable
              onPress={() => setReporting(viewing.id)}
              style={styles.reportBtn}
              accessibilityRole="button"
              accessibilityLabel="Report this photo"
              hitSlop={10}
            >
              <Text style={styles.reportText}>Report this photo</Text>
            </Pressable>
          </View>
        )}
      </Modal>

      {reporting && (
        <ReportSheet
          kind="photo"
          targetId={reporting}
          what="this photo"
          onClose={() => {
            setReporting(null);
            setViewing(null);
          }}
        />
      )}
    </View>
  );
}

const GAP = 3;
const COLUMNS = 3;
const CELL = (Dimensions.get('window').width - GAP * (COLUMNS - 1)) / COLUMNS;

const SCREEN_WIDTH = Dimensions.get('window').width;

const styles = StyleSheet.create({
  closeBtn: {
    position: 'absolute',
    top: 58,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  pagePosition: {
    position: 'absolute',
    top: 64,
    alignSelf: 'center',
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  reportBtn: {
    position: 'absolute',
    bottom: 44,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  reportText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  screen: { flex: 1, backgroundColor: colors.base },
  findMe: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  findMeText: { color: colors.action, fontSize: 14, fontWeight: '700' },
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
  // textOnAction, not textOnDark: the active pill is filled with `action`
  // (ink since the rebrand) and `textOnDark` is now also ink — the selected
  // tab's own label was invisible. The leaderboard's segmented control had
  // this right; this was the one place that did not.
  tabTextActive: { color: colors.textOnAction },
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
