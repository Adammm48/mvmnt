-- ============================================================================
-- 0019 · Phase 2 notification types
--
-- Alone in its own migration on purpose. Postgres will not let a newly added
-- enum value be USED in the same transaction that adds it, and each migration
-- file runs in its own transaction — so the copy and the wiring that reference
-- these live in the next migration, not this one.
-- ============================================================================

alter type public.notification_type add value if not exists 'friend_poke';
alter type public.notification_type add value if not exists 'badge_earned';
