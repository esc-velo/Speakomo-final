-- Migration: Add cue generation fields to research_sessions
-- These fields track cue generation independently from OCR extraction.
-- Idempotent: uses IF NOT EXISTS / safe column additions.

DO $$
BEGIN
  -- cue_points: stores the validated cue set as JSONB
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'research_sessions'
      AND column_name = 'cue_points'
  ) THEN
    ALTER TABLE public.research_sessions ADD COLUMN cue_points JSONB;
  END IF;

  -- cue_status: independent from processing_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'research_sessions'
      AND column_name = 'cue_status'
  ) THEN
    ALTER TABLE public.research_sessions
      ADD COLUMN cue_status TEXT NOT NULL DEFAULT 'pending';
  END IF;

  -- cue_model: which AI model generated the cues
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'research_sessions'
      AND column_name = 'cue_model'
  ) THEN
    ALTER TABLE public.research_sessions ADD COLUMN cue_model TEXT;
  END IF;

  -- cue_input_hash: SHA-256 of topic + extracted text + sources + prompt version + model
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'research_sessions'
      AND column_name = 'cue_input_hash'
  ) THEN
    ALTER TABLE public.research_sessions ADD COLUMN cue_input_hash TEXT;
  END IF;

  -- cue_generated_at: timestamp of last successful generation
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'research_sessions'
      AND column_name = 'cue_generated_at'
  ) THEN
    ALTER TABLE public.research_sessions ADD COLUMN cue_generated_at TIMESTAMPTZ;
  END IF;

  -- cue_error: error message from last failed generation attempt
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'research_sessions'
      AND column_name = 'cue_error'
  ) THEN
    ALTER TABLE public.research_sessions ADD COLUMN cue_error TEXT;
  END IF;

  -- cue_prompt_version: version of the prompt template used
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'research_sessions'
      AND column_name = 'cue_prompt_version'
  ) THEN
    ALTER TABLE public.research_sessions ADD COLUMN cue_prompt_version TEXT;
  END IF;
END
$$;

-- Add CHECK constraint for cue_status values (safe: only adds if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'research_sessions_cue_status_check'
  ) THEN
    ALTER TABLE public.research_sessions
      ADD CONSTRAINT research_sessions_cue_status_check
      CHECK (cue_status IN ('pending', 'generating', 'generated', 'failed', 'stale'));
  END IF;
END
$$;
