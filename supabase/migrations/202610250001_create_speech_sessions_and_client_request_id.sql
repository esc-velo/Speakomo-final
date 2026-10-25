-- =============================================================================
-- Fix 1: Create the missing speech_sessions table
-- The API route references this table for /speech/start, /speech/complete,
-- /speech/upload, /speech/transcribe, and GET /speech, but no prior migration
-- ever created it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.speech_sessions (
  id                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  session_id          uuid                     NOT NULL,
  user_id             uuid                     NOT NULL,
  idempotency_key     text,
  cue_mode            text                     NOT NULL DEFAULT 'generic',
  started_at          timestamp with time zone NOT NULL DEFAULT now(),
  ended_at            timestamp with time zone,
  actual_duration_ms  integer,
  stopped_reason      text,
  upload_status       text                     NOT NULL DEFAULT 'local_only',
  server_sync_status  text                     NOT NULL DEFAULT 'not_connected',
  audio_bytes         integer,
  audio_mime          text,
  created_at          timestamp with time zone NOT NULL DEFAULT now(),
  updated_at          timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT speech_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT speech_sessions_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE,
  CONSTRAINT speech_sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Unique constraint for idempotency (per user + key)
CREATE UNIQUE INDEX IF NOT EXISTS idx_speech_sessions_user_idempotency
  ON public.speech_sessions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_speech_sessions_session_id
  ON public.speech_sessions (session_id);

CREATE INDEX IF NOT EXISTS idx_speech_sessions_user_id
  ON public.speech_sessions (user_id);

-- Enable Row Level Security
ALTER TABLE public.speech_sessions ENABLE ROW LEVEL SECURITY;

-- Users can manage their own speech sessions
CREATE POLICY "Users can manage own speech sessions"
  ON public.speech_sessions
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- =============================================================================
-- Fix 2: Add the missing client_request_id column to sessions
-- The API uses this for idempotent session creation but the original migration
-- did not include the column. A code fallback hides the error but is fragile.
-- =============================================================================

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS client_request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_user_client_request_id
  ON public.sessions (user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;


-- =============================================================================
-- Fix 3: Ensure storage buckets exist
-- These are idempotent (ON CONFLICT DO NOTHING).
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('speech-recordings', 'speech-recordings', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('research-materials', 'research-materials', false)
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- Fix 4: Ensure storage policies exist for speech-recordings
-- These are idempotent via IF NOT EXISTS or DO NOTHING pattern.
-- The original migration's policies may already exist; re-create only if absent.
-- =============================================================================

DO $$
BEGIN
  -- Upload policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Users can upload own recordings'
  ) THEN
    CREATE POLICY "Users can upload own recordings" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'speech-recordings'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  -- Read policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Users can read own recordings'
  ) THEN
    CREATE POLICY "Users can read own recordings" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'speech-recordings'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  -- Delete policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Users can delete own recordings'
  ) THEN
    CREATE POLICY "Users can delete own recordings" ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'speech-recordings'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  -- Update policy (needed for upsert uploads)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Users can update own recordings'
  ) THEN
    CREATE POLICY "Users can update own recordings" ON storage.objects
      FOR UPDATE TO authenticated
      USING (
        bucket_id = 'speech-recordings'
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
      WITH CHECK (
        bucket_id = 'speech-recordings'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;
