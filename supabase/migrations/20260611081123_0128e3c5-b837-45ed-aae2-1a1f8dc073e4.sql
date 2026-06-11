
-- Enums
CREATE TYPE public.session_status AS ENUM ('active', 'ended', 'archived');
CREATE TYPE public.brief_node_level AS ENUM ('h1', 'h2', 'bullet');
CREATE TYPE public.brief_node_status AS ENUM ('ai_draft', 'user_confirmed');
CREATE TYPE public.brief_editor AS ENUM ('ai', 'user');
CREATE TYPE public.boundary_reason AS ENUM ('word_count', 'char_count', 'time', 'silence', 'manual_stop');
CREATE TYPE public.brief_op_type AS ENUM ('add_node', 'update_node', 'delete_node', 'move_node', 'annotate');

-- Helper: updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =====================================================
-- sessions
-- =====================================================
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled session',
  status public.session_status NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON public.sessions(user_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO authenticated;
GRANT ALL ON public.sessions TO service_role;

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions_select_own" ON public.sessions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "sessions_insert_own" ON public.sessions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions_update_own" ON public.sessions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions_delete_own" ON public.sessions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER sessions_set_updated_at
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helper: owns_session security definer (bypasses RLS for child-row checks)
CREATE OR REPLACE FUNCTION public.owns_session(_session_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sessions
    WHERE id = _session_id AND user_id = auth.uid()
  );
$$;

-- =====================================================
-- transcript_chunks
-- =====================================================
CREATE TABLE public.transcript_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  is_final BOOLEAN NOT NULL DEFAULT true,
  start_ms INTEGER NOT NULL DEFAULT 0,
  end_ms INTEGER NOT NULL DEFAULT 0,
  lang TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX transcript_chunks_session_idx ON public.transcript_chunks(session_id, start_ms);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transcript_chunks TO authenticated;
GRANT ALL ON public.transcript_chunks TO service_role;

ALTER TABLE public.transcript_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transcript_chunks_all_own" ON public.transcript_chunks FOR ALL TO authenticated
  USING (public.owns_session(session_id))
  WITH CHECK (public.owns_session(session_id));

-- =====================================================
-- transcript_segments
-- =====================================================
CREATE TABLE public.transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  chunk_ids UUID[] NOT NULL DEFAULT '{}',
  raw_text TEXT NOT NULL,
  start_ms INTEGER NOT NULL DEFAULT 0,
  end_ms INTEGER NOT NULL DEFAULT 0,
  boundary_reason public.boundary_reason NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX transcript_segments_session_idx ON public.transcript_segments(session_id, start_ms);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transcript_segments TO authenticated;
GRANT ALL ON public.transcript_segments TO service_role;

ALTER TABLE public.transcript_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transcript_segments_all_own" ON public.transcript_segments FOR ALL TO authenticated
  USING (public.owns_session(session_id))
  WITH CHECK (public.owns_session(session_id));

-- =====================================================
-- brief_nodes
-- =====================================================
CREATE TABLE public.brief_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.brief_nodes(id) ON DELETE CASCADE,
  order_key TEXT NOT NULL,
  level public.brief_node_level NOT NULL DEFAULT 'bullet',
  text TEXT NOT NULL DEFAULT '',
  status public.brief_node_status NOT NULL DEFAULT 'ai_draft',
  last_edited_by public.brief_editor NOT NULL DEFAULT 'ai',
  source_chunk_ids UUID[] NOT NULL DEFAULT '{}',
  confidence REAL,
  tag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX brief_nodes_session_idx ON public.brief_nodes(session_id, order_key);
CREATE INDEX brief_nodes_parent_idx ON public.brief_nodes(parent_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brief_nodes TO authenticated;
GRANT ALL ON public.brief_nodes TO service_role;

ALTER TABLE public.brief_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brief_nodes_all_own" ON public.brief_nodes FOR ALL TO authenticated
  USING (public.owns_session(session_id))
  WITH CHECK (public.owns_session(session_id));

CREATE TRIGGER brief_nodes_set_updated_at
  BEFORE UPDATE ON public.brief_nodes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- brief_operations (audit log)
-- =====================================================
CREATE TABLE public.brief_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES public.transcript_segments(id) ON DELETE SET NULL,
  op_type public.brief_op_type NOT NULL,
  payload JSONB NOT NULL,
  applied BOOLEAN NOT NULL DEFAULT false,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX brief_operations_session_idx ON public.brief_operations(session_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brief_operations TO authenticated;
GRANT ALL ON public.brief_operations TO service_role;

ALTER TABLE public.brief_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brief_operations_all_own" ON public.brief_operations FOR ALL TO authenticated
  USING (public.owns_session(session_id))
  WITH CHECK (public.owns_session(session_id));
