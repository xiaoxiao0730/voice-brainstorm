
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS prompt text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS context_files jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE POLICY "session_context_select_own"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'session-context' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "session_context_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'session-context' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "session_context_update_own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'session-context' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "session_context_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'session-context' AND (storage.foldername(name))[1] = auth.uid()::text);
