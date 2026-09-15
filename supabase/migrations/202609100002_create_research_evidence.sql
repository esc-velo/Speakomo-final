-- Research evidence uploaded or entered by the user
CREATE TABLE public.research_evidence (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  research_session_id uuid NOT NULL,

  title text,
  type text NOT NULL,

  file_name text,
  mime_type text,
  storage_path text,

  text_content text,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT research_evidence_pkey PRIMARY KEY (id),

  CONSTRAINT research_evidence_research_session_id_fkey
    FOREIGN KEY (research_session_id)
    REFERENCES public.research_sessions(id)
    ON DELETE CASCADE,

  CONSTRAINT research_evidence_type_check
    CHECK (type IN ('text', 'image', 'file'))
);

CREATE INDEX idx_research_evidence_research_session_id
ON public.research_evidence(research_session_id);


-- Enable Row Level Security
ALTER TABLE public.research_evidence
ENABLE ROW LEVEL SECURITY;


-- Users can view evidence belonging to their own research sessions
CREATE POLICY "Users can view own research evidence"
ON public.research_evidence
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.research_sessions rs
    JOIN public.sessions s
      ON s.id = rs.session_id
    WHERE rs.id = research_evidence.research_session_id
      AND s.user_id = auth.uid()
  )
);


-- Users can create evidence in their own research sessions
CREATE POLICY "Users can create own research evidence"
ON public.research_evidence
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.research_sessions rs
    JOIN public.sessions s
      ON s.id = rs.session_id
    WHERE rs.id = research_evidence.research_session_id
      AND s.user_id = auth.uid()
  )
);


-- Users can update their own research evidence
CREATE POLICY "Users can update own research evidence"
ON public.research_evidence
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.research_sessions rs
    JOIN public.sessions s
      ON s.id = rs.session_id
    WHERE rs.id = research_evidence.research_session_id
      AND s.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.research_sessions rs
    JOIN public.sessions s
      ON s.id = rs.session_id
    WHERE rs.id = research_evidence.research_session_id
      AND s.user_id = auth.uid()
  )
);


-- Users can delete their own research evidence
CREATE POLICY "Users can delete own research evidence"
ON public.research_evidence
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.research_sessions rs
    JOIN public.sessions s
      ON s.id = rs.session_id
    WHERE rs.id = research_evidence.research_session_id
      AND s.user_id = auth.uid()
  )
);