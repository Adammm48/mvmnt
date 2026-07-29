-- ============================================================================
-- 0039 · The photos-ready notification type
--
-- On its own, before anything uses it, for the same reason as migrations 0019,
-- 0024, 0030 and 0037a: Postgres refuses to USE a new enum value inside the
-- transaction that added it, and each migration runs as one transaction. The
-- value lands here; migrations 0040 and 0041 are allowed to mention it.
-- ============================================================================

alter type public.notification_type add value if not exists 'photos_ready';
