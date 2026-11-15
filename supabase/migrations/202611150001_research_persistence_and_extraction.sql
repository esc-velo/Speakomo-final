-- =============================================================================
-- Migration: Add research persistence and extraction fields
-- Extends research_sessions and research_evidence to support:
-- - Custom academic topic persistence
-- - Unified extracted text persistence with attribution
-- - OCR extraction status, timestamps, and error logging
-- =============================================================================

-- 1. Extend research_sessions
ALTER TABLE public.research_sessions
  ADD COLUMN IF NOT EXISTS topic text,
  ADD COLUMN IF NOT EXISTS extracted_text text,
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS processing_error text,
  ADD COLUMN IF NOT EXISTS processed_at timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'research_sessions_processing_status_check'
  ) THEN
    ALTER TABLE public.research_sessions
      ADD CONSTRAINT research_sessions_processing_status_check
      CHECK (processing_status IN ('pending', 'extracting', 'extracted', 'failed'));
  END IF;
END $$;

-- 2. Extend research_evidence
ALTER TABLE public.research_evidence
  ADD COLUMN IF NOT EXISTS extraction_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS extraction_error text,
  ADD COLUMN IF NOT EXISTS extracted_at timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'research_evidence_extraction_status_check'
  ) THEN
    ALTER TABLE public.research_evidence
      ADD CONSTRAINT research_evidence_extraction_status_check
      CHECK (extraction_status IN ('pending', 'extracting', 'extracted', 'failed'));
  END IF;
END $$;
