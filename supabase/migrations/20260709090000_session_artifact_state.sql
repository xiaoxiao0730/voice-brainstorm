alter table public.session_thinking_state
  add column if not exists artifact_state jsonb not null default '{"mode":"none","artifactType":"prd","artifactTitle":"","sections":[],"activeSectionId":""}'::jsonb;

