alter table public.idea_canvas_nodes
  add column if not exists width double precision,
  add column if not exists height double precision;
