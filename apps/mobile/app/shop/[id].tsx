import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { loadFriends } from '@/lib/friends';
import { Button } from '@/components/Button';
import { CoverFallback } from '@/components/CoverFallback';
import { Loading, Notice } from '@/components/Feedback';
import {
  colors,
  radius,
  spacing,
  typography,
  describeStock,
  formatMoney,
  isBuyable,
  maxUsablePoints,
  pointsDiscount,
  toMemberMessage,
  MIN_TOUCH_TARGET,
  type FriendRow,
  type Product,
} from '@mvmnt/shared';

/**
 * One item, and everything needed to order it.
 *
 * Size, quantity, points and the gift choice are all on one screen rather than
 * a checkout flow. At four fields a wizard is friction for its own sake, and
 * App Spec §2 asks for one obvious next step rather than a sequence of them.
 */
export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();

  const [product, setProduct] = useState<Product | null>(null);
  const [points, setPoints] = useState(0);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [size, setSize] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [usePoints, setUsePoints] = useState(true);
  const [isGift, setIsGift] = useState(false);
  const [recipient, setRecipient] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitlisted, setWaitlisted] = useState(false);

  const load = useCallback(async () => {
    const [item, standing, friendRows] = await Promise.all([
      supabase.from('products').select('*').eq('id', id).maybeSingle(),
      supabase.rpc('my_standing', { p_window: 'all_time' }),
      loadFriends(null).catch(() => [] as FriendRow[]),
    ]);

    setProduct(item.data ?? null);
    setPoints((standing.data ?? [])[0]?.points ?? 0);
    setFriends(friendRows);
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading) return <Loading label="Loading" />;
  if (!product) {
    return (
      <View style={styles.screen}>
        <Notice tone="error" message="That item is no longer in the shop." />
      </View>
    );
  }

  const gross = product.price_minor * quantity;
  // Two different quantities, deliberately named apart: how many points are
  // spent, and how much money that takes off. Conflating them is how a member
  // ends up spending 500 points to save 400 piastres.
  const spendable = usePoints ? maxUsablePoints(points, gross) : 0;
  const discount = usePoints ? pointsDiscount(points, gross) : 0;
  const total = gross - discount;
  const needsSize = (product.sizes?.length ?? 0) > 0;
  const buyable = isBuyable(product);
  const stock = describeStock(product);

  async function order() {
    setBusy(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('place_order', {
      p_product_id: product!.id,
      p_quantity: quantity,
      p_size: size ?? undefined,
      p_use_points: spendable,
      p_recipient_id: isGift ? (recipient ?? undefined) : undefined,
      p_gift_message: isGift && message.trim() ? message.trim() : undefined,
    });

    setBusy(false);
    if (rpcError) {
      setError(toMemberMessage(rpcError));
      return;
    }
    router.replace(`/orders?highlight=${data}`);
  }

  async function joinWaitlist() {
    setBusy(true);
    // user_id is supplied rather than defaulted: the RLS check requires it to
    // match the caller, so an omitted column is a policy violation rather than
    // a convenience.
    const { error: rpcError } = await supabase
      .from('product_waitlist')
      .insert({ product_id: product!.id, user_id: session!.user.id });
    setBusy(false);
    if (rpcError && !/duplicate|unique/i.test(rpcError.message)) {
      setError(toMemberMessage(rpcError));
      return;
    }
    setWaitlisted(true);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {error && <Notice tone="error" message={error} />}

      <View style={styles.hero}>
        {product.image_url ? (
          <Image source={{ uri: product.image_url }} style={StyleSheet.absoluteFill} />
        ) : (
          <CoverFallback seed={product.id} />
        )}
      </View>

      <View style={styles.head}>
        <Text style={styles.name}>{product.name}</Text>
        <Text style={styles.price}>{formatMoney(product.price_minor, product.currency)}</Text>
        {stock && <Text style={[styles.stock, !buyable && styles.stockOut]}>{stock}</Text>}
        {product.description && <Text style={styles.description}>{product.description}</Text>}
      </View>

      {product.status === 'coming_soon' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Not out yet</Text>
          <Text style={styles.body}>
            Put your name down and the club will tell you the moment it lands.
          </Text>
          {waitlisted ? (
            <Notice tone="success" message="You are on the list. You will hear first." />
          ) : (
            <Button label="Notify me" onPress={joinWaitlist} loading={busy} />
          )}
        </View>
      ) : !buyable ? (
        <Notice tone="info" message="This one has sold out. The club may restock it." />
      ) : (
        <>
          {needsSize && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Size</Text>
              <View style={styles.sizeRow}>
                {product.sizes.map((s) => (
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
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How many</Text>
            <View style={styles.qtyRow}>
              <Pressable
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                style={styles.qtyButton}
                accessibilityRole="button"
                accessibilityLabel="One fewer"
              >
                <Text style={styles.qtySymbol}>−</Text>
              </Pressable>
              <Text style={styles.qtyValue}>{quantity}</Text>
              <Pressable
                onPress={() =>
                  setQuantity((q) => Math.min(product!.stock ?? 20, Math.min(20, q + 1)))
                }
                style={styles.qtyButton}
                accessibilityRole="button"
                accessibilityLabel="One more"
              >
                <Text style={styles.qtySymbol}>+</Text>
              </Pressable>
            </View>
          </View>

          {points > 0 && (
            <View style={styles.section}>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>
                  Use my points — {formatMoney(pointsDiscount(points, gross))} off
                </Text>
                <Switch
                  value={usePoints}
                  onValueChange={setUsePoints}
                  accessibilityLabel="Use my points"
                  trackColor={{ false: '#3A4152', true: colors.success }}
                />
              </View>
              <Text style={styles.hint}>
                You have {points.toLocaleString()} points. They come off this order and are gone
                once it is placed — cancelling gives them back.
              </Text>
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Send it to a friend</Text>
              <Switch
                value={isGift}
                onValueChange={setIsGift}
                accessibilityLabel="Send it to a friend"
                trackColor={{ false: '#3A4152', true: colors.success }}
              />
            </View>

            {isGift &&
              (friends.length === 0 ? (
                <Text style={styles.hint}>
                  You have not added anyone yet. You can only gift to someone whose code you have
                  scanned in person — add a friend at the next run.
                </Text>
              ) : (
                <>
                  <Text style={styles.hint}>
                    Only people you have added in person. They confirm their own size, so a guess
                    here does not matter.
                  </Text>
                  <View style={styles.friendRow}>
                    {friends.map((f) => (
                      <Pressable
                        key={f.friend_id}
                        onPress={() => setRecipient(f.friend_id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: recipient === f.friend_id }}
                        style={[styles.friend, recipient === f.friend_id && styles.friendOn]}
                      >
                        <Text
                          style={[
                            styles.friendText,
                            recipient === f.friend_id && styles.friendTextOn,
                          ]}
                        >
                          {f.display_name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput
                    style={styles.input}
                    value={message}
                    onChangeText={setMessage}
                    placeholder="Add a note (optional)"
                    placeholderTextColor={colors.textOnDarkMuted}
                    maxLength={300}
                    multiline
                  />
                </>
              ))}
          </View>

          <View style={styles.totals}>
            <Row label={`${product.name} × ${quantity}`} value={formatMoney(gross)} />
            {discount > 0 && (
              <Row
                label={`Points (${spendable.toLocaleString()})`}
                value={`− ${formatMoney(discount)}`}
                tone="good"
              />
            )}
            <Row label="To pay" value={formatMoney(total)} strong />
            <Text style={styles.payNote}>
              Nothing is charged in the app yet — the club takes payment in person. Your order
              holds the stock until then.
            </Text>
          </View>

          <Button
            label={isGift ? 'Send this gift' : 'Place order'}
            onPress={order}
            loading={busy}
            disabled={(needsSize && !size) || (isGift && !recipient)}
          />
        </>
      )}
    </ScrollView>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'good';
}) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, strong && styles.totalStrong]}>{label}</Text>
      <Text
        style={[
          styles.totalValue,
          strong && styles.totalStrong,
          tone === 'good' && { color: colors.success },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
  hero: {
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.baseElevated,
  },
  head: { gap: 4 },
  name: { fontSize: 26, fontWeight: '900', color: colors.textOnDark, letterSpacing: -0.4 },
  price: { ...typography.dataLarge, fontSize: 22, color: colors.textOnDark },
  stock: { fontSize: 14, fontWeight: '700', color: colors.action },
  stockOut: { color: colors.textOnDarkMuted },
  description: { fontSize: 15, color: colors.textOnDarkMuted, lineHeight: 22, marginTop: 4 },

  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.textOnDark },
  body: { fontSize: 14, color: colors.textOnDarkMuted, lineHeight: 21 },
  hint: { fontSize: 13, color: colors.textOnDarkMuted, lineHeight: 19 },

  sizeRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  size: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#3A4152',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeOn: { borderColor: colors.action, backgroundColor: 'rgba(255,90,54,0.12)' },
  sizeText: { fontSize: 15, fontWeight: '700', color: colors.textOnDarkMuted },
  sizeTextOn: { color: colors.action },

  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  qtyButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: '#3A4152',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtySymbol: { fontSize: 22, color: colors.textOnDark, lineHeight: 24 },
  qtyValue: { ...typography.dataLarge, fontSize: 20, color: colors.textOnDark, minWidth: 28, textAlign: 'center' },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  switchLabel: { flex: 1, fontSize: 16, color: colors.textOnDark },

  friendRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  friend: {
    minHeight: MIN_TOUCH_TARGET - 8,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: '#3A4152',
  },
  friendOn: { borderColor: colors.success, backgroundColor: 'rgba(61,220,132,0.12)' },
  friendText: { fontSize: 14, fontWeight: '600', color: colors.textOnDarkMuted },
  friendTextOn: { color: colors.success },

  input: {
    minHeight: 72,
    backgroundColor: colors.baseElevated,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    color: colors.textOnDark,
    borderWidth: 1,
    borderColor: '#3A4152',
    textAlignVertical: 'top',
  },

  totals: {
    backgroundColor: colors.baseElevated,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  totalLabel: { fontSize: 14, color: colors.textOnDarkMuted, flex: 1 },
  totalValue: { ...typography.data, fontSize: 14, color: colors.textOnDark },
  totalStrong: { fontSize: 17, fontWeight: '800', color: colors.textOnDark },
  payNote: { fontSize: 12, color: colors.textOnDarkMuted, lineHeight: 18, marginTop: spacing.xs },
});
