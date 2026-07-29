import { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { CoverFallback } from '@/components/CoverFallback';
import { EmptyState, Loading, Notice } from '@/components/Feedback';
import {
  colors,
  radius,
  spacing,
  typography,
  describeStock,
  formatMoney,
  PIASTRES_PER_POINT,
  isBuyable,
  toMemberMessage,
  type Product,
} from '@mvmnt/shared';

/**
 * The shop.
 *
 * Coming-soon items are listed alongside what is buyable rather than hidden
 * (App Spec §4.6) — an item nobody can see is an item nobody is waiting for,
 * and the waitlist is the whole point of announcing it early.
 */
export default function ShopScreen() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);

    const [items, standing] = await Promise.all([
      supabase.from('products').select('*').neq('status', 'retired').order('sort_order'),
      supabase.rpc('my_standing', { p_window: 'all_time' }),
    ]);

    if (items.error) setError(toMemberMessage(items.error));
    else setProducts(items.data ?? []);
    setPoints((standing.data ?? [])[0]?.points ?? 0);

    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading) return <Loading label="Loading the shop" />;

  return (
    <FlatList
      style={styles.screen}
      data={products}
      keyExtractor={(p) => p.id}
      numColumns={2}
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load(true)}
          tintColor={colors.textOnDarkMuted}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {error && <Notice tone="error" message={error} />}
          {/*
            Points are shown here rather than only at checkout: knowing what you
            can knock off changes whether you open an item at all.
          */}
          <View style={styles.pointsCard}>
            <Text style={styles.pointsValue}>{points.toLocaleString()}</Text>
            <Text style={styles.pointsLabel}>
              points to spend — worth {formatMoney(points * PIASTRES_PER_POINT)} off anything here
            </Text>
          </View>

          <Pressable
            onPress={() => router.push('/orders')}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text style={styles.ordersLink}>Your orders and gifts →</Text>
          </Pressable>
        </View>
      }
      renderItem={({ item }) => (
        <ProductCard product={item} onPress={() => router.push(`/shop/${item.id}`)} />
      )}
      ListEmptyComponent={
        <EmptyState
          title="Nothing in the shop yet"
          body="The club is putting the first drop together. It lands here when it does."
        />
      }
    />
  );
}

function ProductCard({ product, onPress }: { product: Product; onPress: () => void }) {
  const stock = describeStock(product);
  const buyable = isBuyable(product);

  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatMoney(product.price_minor, product.currency)}${stock ? `, ${stock}` : ''}`}
    >
      <View style={styles.image}>
        {product.image_url ? (
          <Image source={{ uri: product.image_url }} style={StyleSheet.absoluteFill} />
        ) : (
          <CoverFallback seed={product.id} />
        )}
        {stock && (
          <View style={[styles.stockPill, !buyable && styles.stockPillMuted]}>
            <Text style={styles.stockText}>{stock}</Text>
          </View>
        )}
      </View>

      <Text style={styles.name} numberOfLines={2}>
        {product.name}
      </Text>
      <Text style={styles.price}>{formatMoney(product.price_minor, product.currency)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  list: { padding: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 },
  row: { gap: spacing.sm },
  header: { gap: spacing.sm, marginBottom: spacing.md },
  pointsCard: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 2,
  },
  pointsValue: { ...typography.dataLarge, fontSize: 30, color: colors.highlight },
  pointsLabel: { fontSize: 13, color: colors.textOnDarkMuted, lineHeight: 19 },
  ordersLink: { fontSize: 14, fontWeight: '700', color: colors.action },

  card: { flex: 1, marginBottom: spacing.md, gap: 4 },
  image: {
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.baseElevated,
  },
  stockPill: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: colors.action,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  stockPillMuted: { backgroundColor: '#4A5165' },
  stockText: { fontSize: 11, fontWeight: '800', color: colors.textOnAction },
  name: { fontSize: 15, fontWeight: '700', color: colors.textOnDark },
  price: { ...typography.data, fontSize: 14, color: colors.textOnDarkMuted },
});
