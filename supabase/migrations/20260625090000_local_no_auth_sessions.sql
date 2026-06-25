-- Local no-auth mode uses a fixed LOCAL_USER_ID in server functions instead of
-- Supabase Auth. The original Lovable/Auth schema requires sessions.user_id to
-- reference auth.users(id), which prevents local sessions from being created.

alter table public.sessions
  drop constraint if exists sessions_user_id_fkey;

