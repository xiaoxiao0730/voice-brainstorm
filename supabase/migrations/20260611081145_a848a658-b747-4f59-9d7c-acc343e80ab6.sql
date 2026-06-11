
-- owns_session is used by RLS policies on transcript/brief tables.
-- Restrict EXECUTE to signed-in users only (no anon).
REVOKE ALL ON FUNCTION public.owns_session(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_session(UUID) TO authenticated, service_role;

-- set_updated_at is only ever called by triggers; nothing should call it directly.
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
