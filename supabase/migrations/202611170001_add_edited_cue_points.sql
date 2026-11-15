-- Migration: Add edited_cue_points to research_sessions
-- Separates user-edited cue wording from original AI-generated cue points.
-- Idempotent: uses IF NOT EXISTS.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'research_sessions'
      AND column_name = 'edited_cue_points'
  ) THEN
    ALTER TABLE public.research_sessions ADD COLUMN edited_cue_points JSONB DEFAULT NULL;
  END IF;
END
$$;
