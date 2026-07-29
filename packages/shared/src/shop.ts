/**
 * Presentation helpers for the shop.
 *
 * As with runs.ts and loyalty.ts: these format and label only. What something
 * costs, whether it is in stock, and how many points a member may spend are all
 * decided in `place_order()` (Principles §2). Anything here that looks like a
 * rule is a hint the server re-derives independently.
 */

import type { Database } from './database.types';

export type Product = Database['public']['Tables']['products']['Row'];
export type ProductStatus = Database['public']['Enums']['product_status'];
export type OrderStatus = Database['public']['Enums']['order_status'];
export type MyOrder = Database['public']['Functions']['my_orders']['Returns'][number];
export type Placement = Database['public']['Functions']['active_placements']['Returns'][number];
export type PlacementType = Database['public']['Enums']['placement_type'];

/**
 * Money, from integer minor units.
 *
 * The database stores piastres and never a decimal, because floating-point
 * money is off by a fraction on some orders and a shop nobody can reconcile.
 * This is the only place that division happens.
 */
export function formatMoney(minor: number, currency = 'EGP'): string {
  const major = minor / 100;
  return `${currency} ${major.toLocaleString('en-EG', {
    minimumFractionDigits: major % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * What one point is worth, in piastres.
 *
 * Mirrors `public.points_discount_minor()` in migration 0035 — and the two
 * disagreeing is the classic way a shop charges something other than the number
 * it showed, so they are written to agree deliberately and this comment is the
 * pointer between them.
 */
export const PIASTRES_PER_POINT = 10;

/**
 * The discount a balance buys against a price, capped at the price.
 *
 * Capped rather than erroring: a member whose points went up while the checkout
 * screen was open should see a better number, not a failure.
 */
export function pointsDiscount(points: number, priceMinor: number): number {
  return Math.min(Math.max(points, 0) * PIASTRES_PER_POINT, priceMinor);
}

/**
 * How many of a member's points a given order can actually absorb.
 *
 * Distinct from the discount: this is a count of points, that is an amount of
 * money. Spending 500 points to save 400 piastres would quietly burn 100 of
 * them, so the server recomputes the spend from the discount actually applied
 * and this mirrors that.
 */
export function maxUsablePoints(points: number, priceMinor: number): number {
  const affordable = Math.ceil(priceMinor / PIASTRES_PER_POINT);
  return Math.min(Math.max(points, 0), affordable);
}

/**
 * Stock, in words rather than numbers where a number would be unhelpful.
 *
 * Null stock is not zero — it is a made-to-order item — and saying "sold out"
 * for one would be wrong. Low counts are named because scarcity is real
 * information here, unlike run capacity where the club asked to hide it.
 */
export function describeStock(product: Pick<Product, 'stock' | 'status'>): string | null {
  if (product.status === 'coming_soon') return 'Coming soon';
  if (product.status === 'retired') return 'No longer available';
  if (product.stock === null) return null;
  if (product.stock <= 0) return 'Sold out';
  if (product.stock === 1) return 'Last one';
  if (product.stock <= 5) return `Only ${product.stock} left`;
  return null;
}

export function isBuyable(product: Pick<Product, 'stock' | 'status'>): boolean {
  return product.status === 'in_stock' && (product.stock === null || product.stock > 0);
}

/**
 * Order status in the member's language.
 *
 * `awaiting_payment` is worded around the fact that there is no payment
 * gateway yet, rather than pretending a card was declined — the club will hand
 * these over in person until one exists.
 */
export function describeOrderStatus(status: OrderStatus, isRecipient = false): string {
  switch (status) {
    case 'awaiting_payment':
      return 'Reserved — pay the club';
    case 'paid':
      return isRecipient ? 'Waiting for you to confirm your size' : 'Paid';
    case 'ready':
      return 'Ready to collect';
    case 'fulfilled':
      return 'Collected';
    case 'cancelled':
      return 'Cancelled';
  }
}

/** Statuses where the order can still be called off by either side. */
export function isCancellable(status: OrderStatus): boolean {
  return status === 'awaiting_payment' || status === 'paid';
}
