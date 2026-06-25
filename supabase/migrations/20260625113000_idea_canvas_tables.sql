create table if not exists public.idea_canvas_nodes (
  session_id uuid not null references public.sessions(id) on delete cascade,
  id text not null,
  type text not null default 'ideaNode',
  position_x double precision not null default 0,
  position_y double precision not null default 0,
  title text not null default '',
  body text not null default '',
  kind text not null default 'idea',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, id),
  constraint idea_canvas_nodes_kind_check
    check (kind in ('focus', 'idea', 'question', 'decision', 'risk', 'next'))
);

create table if not exists public.idea_canvas_edges (
  session_id uuid not null references public.sessions(id) on delete cascade,
  id text not null,
  source text not null,
  target text not null,
  type text,
  label text,
  animated boolean not null default false,
  style jsonb not null default '{}'::jsonb,
  marker_end jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, id),
  constraint idea_canvas_edges_source_fkey
    foreign key (session_id, source)
    references public.idea_canvas_nodes(session_id, id)
    on delete cascade,
  constraint idea_canvas_edges_target_fkey
    foreign key (session_id, target)
    references public.idea_canvas_nodes(session_id, id)
    on delete cascade
);

create index if not exists idea_canvas_nodes_session_updated_idx
  on public.idea_canvas_nodes(session_id, updated_at desc);

create index if not exists idea_canvas_edges_session_idx
  on public.idea_canvas_edges(session_id);

grant select, insert, update, delete on public.idea_canvas_nodes to authenticated;
grant select, insert, update, delete on public.idea_canvas_edges to authenticated;
grant all on public.idea_canvas_nodes to service_role;
grant all on public.idea_canvas_edges to service_role;

alter table public.idea_canvas_nodes enable row level security;
alter table public.idea_canvas_edges enable row level security;

drop policy if exists "idea_canvas_nodes_all_own" on public.idea_canvas_nodes;
create policy "idea_canvas_nodes_all_own" on public.idea_canvas_nodes
  for all to authenticated
  using (public.owns_session(session_id))
  with check (public.owns_session(session_id));

drop policy if exists "idea_canvas_edges_all_own" on public.idea_canvas_edges;
create policy "idea_canvas_edges_all_own" on public.idea_canvas_edges
  for all to authenticated
  using (public.owns_session(session_id))
  with check (public.owns_session(session_id));

drop trigger if exists idea_canvas_nodes_set_updated_at on public.idea_canvas_nodes;
create trigger idea_canvas_nodes_set_updated_at
  before update on public.idea_canvas_nodes
  for each row execute function public.set_updated_at();

drop trigger if exists idea_canvas_edges_set_updated_at on public.idea_canvas_edges;
create trigger idea_canvas_edges_set_updated_at
  before update on public.idea_canvas_edges
  for each row execute function public.set_updated_at();
