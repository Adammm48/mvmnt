-- ============================================================================
-- 0024 · A ledger kind for points lost to absence
--
-- Alone in its own migration for the same reason 0019 was: Postgres will not
-- let a newly added enum value be USED in the transaction that adds it, and
-- each migration file is one transaction. The rule that spends it is in 0025.
-- ============================================================================

alter type public.point_kind add value if not exists 'absence';
