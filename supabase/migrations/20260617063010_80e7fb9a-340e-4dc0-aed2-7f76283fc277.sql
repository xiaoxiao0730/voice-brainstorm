ALTER TABLE public.agent_interventions ADD COLUMN IF NOT EXISTS lane TEXT NOT NULL DEFAULT 'structural';
ALTER TABLE public.agent_interventions ADD COLUMN IF NOT EXISTS intent TEXT;
CREATE INDEX IF NOT EXISTS agent_interventions_lane_idx ON public.agent_interventions (session_id, lane, created_at DESC);