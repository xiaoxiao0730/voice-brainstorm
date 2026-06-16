create table public.agent_interventions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  segment_id uuid,
  detected_state text not null,
  state_confidence numeric,
  decision text not null,
  response_text text,
  feedback text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.agent_interventions to authenticated;
grant all on public.agent_interventions to service_role;
alter table public.agent_interventions enable row level security;
create policy "agent_interventions_select_own" on public.agent_interventions
  for select to authenticated using (public.owns_session(session_id));
create policy "agent_interventions_insert_own" on public.agent_interventions
  for insert to authenticated with check (public.owns_session(session_id));
create policy "agent_interventions_update_own" on public.agent_interventions
  for update to authenticated using (public.owns_session(session_id)) with check (public.owns_session(session_id));
create index agent_interventions_session_idx on public.agent_interventions(session_id, created_at desc);