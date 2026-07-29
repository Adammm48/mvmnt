-- ============================================================================
-- 0037a · The route notification type
--
-- Alone, before the routes migration that uses it. Postgres will not let a
-- newly added enum value be USED in the transaction that adds it, and each
-- migration file is one transaction — the fourth time this has come up, and the
-- reason enum additions always get their own file here.
-- ============================================================================

-- App Spec §6: "Route/plan published → attendees of that run".
alter type public.notification_type add value if not exists 'route_published';
