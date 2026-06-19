
ALTER TABLE public.brief_nodes
  ADD COLUMN IF NOT EXISTS slot_id text,
  ADD COLUMN IF NOT EXISTS is_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rationale text;

CREATE INDEX IF NOT EXISTS brief_nodes_session_slot_idx
  ON public.brief_nodes (session_id, slot_id);

ALTER TABLE public.agent_interventions
  ADD COLUMN IF NOT EXISTS slot_id text;
