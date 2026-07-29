-- ============================================================================
-- 0052 · The enum value, alone
--
-- 'sold_out' for products. Its own migration because a Postgres enum value
-- cannot be USED in the transaction that adds it — the rule this repo has now
-- hit six times (0019, 0024, 0030, 0037a, 0047a, here). Everything that uses
-- the value is in 0053.
-- ============================================================================
alter type public.product_status add value if not exists 'sold_out';
