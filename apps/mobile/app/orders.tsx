import { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { ReportSheet } from '@/components/ReportSheet';
import { Button } from '@/components/Button';
import { EmptyState, Loading, Notice } from '@/components/Feedback';
import { confirmDestructive } from '@/lib/confirm';
import { mediaUri } from '@/lib/media';
import {
  adamSays,
  colors,
  radius,
  spacing,
  typography,
  describeOrderStatus,
  formatMoney,
  isCancellable,
  toMemberMessage,
  MIN_TOUCH_TARGET,
  type MyOrder,
} from '@mvmnt/shared';

/**
 * Orders and gifts, in one list.
 *
 * Bought and received live together because a member does not think of them as
 * two things — "where is my stuff" is one question. The direction is a label on
 * the row rather than a separate screen.
 *
 * This is also where a gift gets confirmed (App Spec §4.6): the recipient picks
 * their own size and leaves a delivery note, which is the difference between
 * being sent something and being handed something.
 */
export default function OrdersScreen() {
  const { highlight } = useLocalSearchParams<{ highlight?: string }>();
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [sizes, setSizes] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);

    const [rows, products] = await Promise.all([
      supabase.rpc('my_orders'),
      supabase.from('products').select('id, name, sizes'),
    ]);

    if (rows.error) setError(toMemberMessage(rows.error));
    else setOrders(rows.data ?? []);

    // Sizes are keyed by product name because my_orders() returns the frozen
    // name rather than the product id — the order deliberately does not follow
    // a product that changed after it was placed.
    setSizes(
      Object.fromEntries((products.data ?? []).map((p) => [p.name, p.sizes ?? []])),
    );

    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Arriving straight from checkout: one line in the author's voice, chosen by
  // what just happened. A moment, not a banner that lives here.
  useEffect(() => {
    if (!highlight || note) return;
    const fresh = orders.find((o) => o.id === highlight);
    if (!fresh) return;
    setNote(adamSays(fresh.is_gift ? 'gift_sent' : 'order_reserved'));
    // note is deliberately not in the deps: this fires once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, orders]);

  // Every successful row action lands here, and has to arrive with a sentence.
  // A second copy of cancel() used to live on this screen — dead, but carrying
  // the only message the member ever saw, while the live one in the card
  // reloaded the list in silence and left the checkout banner sitting above a
  // cancelled order saying "It's yours."
  function done(message: string) {
    setError(null);
    setNote(message);
    load();
  }

  if (loading) return <Loading label="Loading your orders" />;

  return (
    <FlatList
      style={styles.screen}
      data={orders}
      keyExtractor={(o) => o.id}
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
          {note && !error && <Notice tone="success" message={note} onDismiss={() => setNote(null)} />}
        </View>
      }
      renderItem={({ item }) => (
        <OrderCard
          order={item}
          sizes={sizes[item.product_name] ?? []}
          highlighted={item.id === highlight}
          onDone={done}
          onError={setError}
        />
      )}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      ListEmptyComponent={
        <EmptyState
          title="Nothing ordered yet"
          body="Anything you buy — or anything a friend sends you — turns up here."
        />
      }
    />
  );
}

function OrderCard({
  order,
  sizes,
  highlighted,
  onDone,
  onError,
}: {
  order: MyOrder;
  sizes: string[];
  highlighted: boolean;
  /** Reports what happened, in words the member reads. Not optional: an action
   *  that succeeds silently is the bug this screen already shipped once. */
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const received = order.direction === 'received';
  // A gift needs confirming once it is paid for and before the club hands it
  // over. Until then there is nothing for the recipient to do.
  const [reporting, setReporting] = useState(false);
  const needsConfirming = received && order.status === 'paid' && !order.redeemed_at;

  const [size, setSize] = useState<string | null>(order.size);
  const [delivery, setDelivery] = useState('');
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const { error } = await supabase.rpc('redeem_gift', {
      p_order_id: order.id,
      p_size: size ?? undefined,
      p_delivery_note: delivery.trim() || undefined,
    });
    setBusy(false);
    if (error) {
      onError(toMemberMessage(error));
      return;
    }
    onDone('Confirmed. The club has it ready for you at the next run.');
  }

  async function cancel() {
    const confirmed = await confirmDestructive({
      title: `Cancel ${order.product_name}?`,
      message:
        order.points_spent > 0
          ? `The ${order.points_spent.toLocaleString()} points you spent come straight back, and the item returns to the shop.`
          : 'The item returns to the shop for someone else.',
      confirmLabel: 'Cancel it',
    });
    if (!confirmed) return;
    setBusy(true);
    const { error } = await supabase.rpc('cancel_order', { p_order_id: order.id });
    setBusy(false);
    if (error) {
      onError(toMemberMessage(error));
      return;
    }
    onDone(
      order.points_spent > 0
        ? 'Cancelled. Your points are back in your balance.'
        : 'Cancelled. The item is back in the shop.',
    );
  }

  return (
    <View style={[styles.card, highlighted && styles.cardNew]}>
      <View style={styles.cardTop}>
        {/* Through mediaUri, like every other product image. Products store a
            PATH now, so handing image_url straight to <Image> renders nothing —
            the order row was the one place still doing that, and it showed a
            blank square on a phone while the shop beside it was correct. */}
        {mediaUri(order.image_url) ? (
          <Image source={{ uri: mediaUri(order.image_url)! }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback]}>
            <Text style={styles.thumbInitial}>{order.product_name.charAt(0)}</Text>
          </View>
        )}

        <View style={styles.cardBody}>
          <Text style={styles.productName} numberOfLines={2}>
            {order.product_name}
            {order.quantity > 1 ? ` × ${order.quantity}` : ''}
          </Text>

          {order.is_gift && (
            <Text style={styles.giftLine}>
              {received ? `From ${order.other_party ?? 'a friend'}` : `For ${order.other_party ?? 'a friend'}`}
            </Text>
          )}

          <Text style={styles.status}>{describeOrderStatus(order.status, received)}</Text>
        </View>

        <View style={styles.priceCol}>
          <Text style={styles.price}>{formatMoney(order.total_minor, order.currency)}</Text>
          {/* A cancelled order gave its points back, so "−280 pts" would be a
              lie about the member's balance. The number is still worth showing
              — it is what the order was worth — but it has to say which way it
              went. */}
          {order.points_spent > 0 && (
            <Text style={styles.pointsUsed}>
              {order.status === 'cancelled'
                ? `${order.points_spent.toLocaleString()} pts back`
                : `−${order.points_spent.toLocaleString()} pts`}
            </Text>
          )}
        </View>
      </View>

      {order.gift_message && (
        <View style={styles.messageBox}>
          <Text style={styles.messageText}>“{order.gift_message}”</Text>
        </View>
      )}

      {needsConfirming && (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmTitle}>Confirm it</Text>
          {sizes.length > 0 && (
            <>
              <Text style={styles.confirmHint}>Your size — not whatever they guessed.</Text>
              <View style={styles.sizeRow}>
                {sizes.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => setSize(s)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: size === s }}
                    style={[styles.size, size === s && styles.sizeOn]}
                  >
                    <Text style={[styles.sizeText, size === s && styles.sizeTextOn]}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <TextInput
            style={styles.input}
            value={delivery}
            onChangeText={setDelivery}
            placeholder="Where should the club leave it? (optional)"
            placeholderTextColor={colors.textOnDarkMuted}
            maxLength={200}
          />
          <Button
            label="Confirm"
            onPress={confirm}
            loading={busy}
            disabled={sizes.length > 0 && !size}
          />
        </View>
      )}

      {!received && isCancellable(order.status) && (
        <Pressable onPress={cancel} disabled={busy} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.cancel}>Cancel this order</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  reportLink: { fontSize: 12, color: colors.textSecondary, textDecorationLine: 'underline', marginTop: 6 },
  screen: { flex: 1, backgroundColor: colors.base },
  list: { padding: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 },
  header: { gap: spacing.sm },

  card: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  // The order just placed, so returning from checkout lands on something
  // recognisable rather than a list where nothing has obviously changed.
  cardNew: { borderColor: colors.success },
  cardTop: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  thumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.border },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  thumbInitial: { fontSize: 22, fontWeight: '800', color: colors.textOnDark },
  cardBody: { flex: 1, gap: 2 },
  productName: { fontSize: 16, fontWeight: '700', color: colors.textOnDark },
  giftLine: { fontSize: 13, color: colors.highlight, fontWeight: '600' },
  status: { fontSize: 13, color: colors.textOnDarkMuted },
  priceCol: { alignItems: 'flex-end', gap: 2 },
  price: { ...typography.data, fontSize: 15, color: colors.textOnDark },
  pointsUsed: { fontSize: 12, color: colors.success },

  messageBox: {
    backgroundColor: colors.base,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  messageText: { fontSize: 14, color: colors.textOnDark, fontStyle: 'italic', lineHeight: 20 },

  confirmBox: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  confirmTitle: { fontSize: 15, fontWeight: '700', color: colors.textOnDark },
  confirmHint: { fontSize: 13, color: colors.textOnDarkMuted },
  sizeRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  size: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET - 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeOn: { borderColor: colors.success, backgroundColor: 'rgba(61,220,132,0.12)' },
  sizeText: { fontSize: 15, fontWeight: '700', color: colors.textOnDarkMuted },
  sizeTextOn: { color: colors.success },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.base,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.textOnDark,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancel: { fontSize: 13, color: colors.textOnDarkMuted, textDecorationLine: 'underline' },
});
