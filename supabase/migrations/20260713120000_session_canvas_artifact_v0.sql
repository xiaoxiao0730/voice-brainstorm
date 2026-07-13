create table if not exists public.session_canvas_artifact_v0 (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  artifact_view jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.session_canvas_artifact_v0 to authenticated;
grant all on public.session_canvas_artifact_v0 to service_role;

alter table public.session_canvas_artifact_v0 enable row level security;

drop policy if exists "session_canvas_artifact_v0_all_own" on public.session_canvas_artifact_v0;
create policy "session_canvas_artifact_v0_all_own" on public.session_canvas_artifact_v0
  for all to authenticated
  using (public.owns_session(session_id))
  with check (public.owns_session(session_id));

drop trigger if exists session_canvas_artifact_v0_set_updated_at on public.session_canvas_artifact_v0;
create trigger session_canvas_artifact_v0_set_updated_at
  before update on public.session_canvas_artifact_v0
  for each row execute function public.set_updated_at();
