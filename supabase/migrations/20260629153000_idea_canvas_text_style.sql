alter table public.idea_canvas_nodes
  add column if not exists text_style jsonb not null default
    '{"size":"normal","bold":false,"italic":false,"align":"left"}'::jsonb;
