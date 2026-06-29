create table if not exists public.session_thinking_state (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  current_goal text not null default '',
  user_intent text not null default '',
  assumptions text[] not null default '{}'::text[],
  open_questions text[] not null default '{}'::text[],
  promising_directions text[] not null default '{}'::text[],
  decision_points text[] not null default '{}'::text[],
  last_turn_id text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.session_thinking_state to authenticated;
grant all on public.session_thinking_state to service_role;

alter table public.session_thinking_state enable row level security;

drop policy if exists "session_thinking_state_all_own" on public.session_thinking_state;
create policy "session_thinking_state_all_own" on public.session_thinking_state
  for all to authenticated
  using (public.owns_session(session_id))
  with check (public.owns_session(session_id));

drop trigger if exists session_thinking_state_set_updated_at on public.session_thinking_state;
create trigger session_thinking_state_set_updated_at
  before update on public.session_thinking_state
  for each row execute function public.set_updated_at();
