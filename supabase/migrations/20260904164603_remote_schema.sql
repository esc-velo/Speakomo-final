SET local check_function_bodies = off;

CREATE TABLE "public"."analyses" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "session_id"         uuid                     NOT NULL,
  "content_analysis"   jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "reasoning_analysis" jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "feedback"           text,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "analyses_pkey" PRIMARY KEY (id),
  CONSTRAINT "analyses_session_id_key" UNIQUE (session_id)
);

ALTER TABLE "public"."analyses"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."profiles" (
  "id"           uuid                     NOT NULL,
  "display_name" text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."research_sessions" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "session_id"   uuid                     NOT NULL,
  "notes"        text,
  "sources"      jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "started_at"   timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "research_sessions_pkey" PRIMARY KEY (id),
  CONSTRAINT "research_sessions_session_id_key" UNIQUE (session_id)
);

ALTER TABLE "public"."research_sessions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."sessions" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    uuid                     NOT NULL,
  "topic_id"   uuid,
  "status"     text                     NOT NULL DEFAULT 'draft'::text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "sessions_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."sessions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."speech_responses" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "session_id"       uuid                     NOT NULL,
  "audio_path"       text,
  "transcript"       text,
  "duration_seconds" integer,
  "word_count"       integer,
  "wpm"              numeric,
  "filler_count"     integer,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "speech_responses_pkey" PRIMARY KEY (id),
  CONSTRAINT "speech_responses_session_id_key" UNIQUE (session_id)
);

ALTER TABLE "public"."speech_responses"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."topics" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "title"       text                     NOT NULL,
  "description" text,
  "category"    text,
  "difficulty"  text,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "topics_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."topics"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  INSERT INTO public.profiles (
    id,
    display_name
  )
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'display_name'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$function$;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."analyses"
  ADD CONSTRAINT "analyses_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;

ALTER TABLE "public"."research_sessions"
  ADD CONSTRAINT "research_sessions_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;

ALTER TABLE "public"."sessions"
  ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."speech_responses"
  ADD CONSTRAINT "speech_responses_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;

ALTER TABLE "public"."sessions"
  ADD CONSTRAINT "sessions_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE SET NULL;

CREATE INDEX idx_sessions_topic_id ON public.sessions USING btree (topic_id);

CREATE INDEX idx_sessions_user_id ON public.sessions USING btree (user_id);

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE POLICY "Users can manage analyses for own sessions" ON "public"."analyses"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.sessions
  WHERE ((sessions.id = analyses.session_id) AND (sessions.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.sessions
  WHERE ((sessions.id = analyses.session_id) AND (sessions.user_id = auth.uid())))));

CREATE POLICY "Users can manage own profile" ON "public"."profiles"
  FOR ALL
  TO PUBLIC
  USING ((auth.uid() = id))
  WITH CHECK ((auth.uid() = id));

CREATE POLICY "Users can manage research for own sessions" ON "public"."research_sessions"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.sessions
  WHERE ((sessions.id = research_sessions.session_id) AND (sessions.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.sessions
  WHERE ((sessions.id = research_sessions.session_id) AND (sessions.user_id = auth.uid())))));

CREATE POLICY "Users can manage own sessions" ON "public"."sessions"
  FOR ALL
  TO PUBLIC
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can view own sessions" ON "public"."sessions"
  FOR SELECT
  TO "authenticated"
  USING ((user_id = auth.uid()));

CREATE POLICY "Users can manage speech responses for own sessions" ON "public"."speech_responses"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.sessions
  WHERE ((sessions.id = speech_responses.session_id) AND (sessions.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.sessions
  WHERE ((sessions.id = speech_responses.session_id) AND (sessions.user_id = auth.uid())))));

CREATE POLICY "Authenticated users can read topics" ON "public"."topics"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "Users can delete own recordings" ON "storage"."objects"
  FOR DELETE
  TO "authenticated"
  USING (((bucket_id = 'speech-recordings'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "Users can read own recordings" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'speech-recordings'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "Users can upload own recordings" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'speech-recordings'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."analyses" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."research_sessions" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."sessions" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."speech_responses" TO "anon", "authenticated", "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."topics" TO "anon", "authenticated", "postgres", "service_role";

