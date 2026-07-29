-- ============================================================================
-- 0030 · Phase 3 enum values
--
-- Alone in their own migration, as in 0019 and 0024: Postgres will not let a
-- newly added enum value be USED in the transaction that adds it, and each
-- migration file runs in its own transaction. Everything that spends these
-- lives in the migrations after it.
-- ============================================================================

-- Spending points at the merch checkout (App Spec §4.3, §4.6). A deduction
-- rather than a separate balance, so the ledger stays the only place a total
-- comes from and there is no second number to drift.
alter type public.point_kind add value if not exists 'redemption';

-- App Spec §6.
alter type public.notification_type add value if not exists 'sponsor_shoutout';
alter type public.notification_type add value if not exists 'gift_received';
