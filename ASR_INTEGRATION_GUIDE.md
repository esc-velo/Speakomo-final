# Speakomo Project Summary & ASR Model Integration Guide

This document provides a concise architectural summary of the Speakomo codebase and actionable specifications to integrate an Automatic Speech Recognition (ASR) model.

---

## 1. Project Overview & Architecture

**Speakomo** is an academic speech practice and reasoning workspace built with:
- **Framework**: Next.js 15 (App Router, React 18, TypeScript)
- **Styling**: Tailwind CSS + custom design tokens (academic serif typography, warm canvas, olive/sage accents)
- **Database & Auth**: Supabase (PostgreSQL with RLS, Supabase Auth SSR/client, Supabase Storage)
- **Client Storage**: IndexedDB (`speakomo-recovery`) for audio/draft resilience
- **State Flow**:
  1. **Topic Selection & Research**: Grounding notes and materials (`/dashboard/session/[id]/research`).
  2. **Speaking Session**: 5-minute timed presentation structured across 6 deterministic stages (`/dashboard/session/[id]/speak`).
  3. **Local Recording & Storage**: In-browser capture via `MediaRecorder` + IndexedDB backup.
  4. **Report & Analysis**: Review audio playback, transcription, pacing, and feedback (`/dashboard/session/[id]/report`).

---

## 2. Workspace File & Directory Map

```
Speakomo-v1/
├── app/
│   ├── api/[[...path]]/route.ts      # Catch-all REST API router (sessions, speech start/complete, research)
│   ├── auth/                        # Supabase authentication pages (login, callback, signup)
│   ├── dashboard/                   # Main user dashboard
│   │   ├── history/                 # Session history view
│   │   ├── practice/                # Quick practice routes
│   │   └── session/[sessionId]/     # Active session workflow
│   │       ├── research/page.tsx    # Research notes & grounding material intake
│   │       ├── speak/page.tsx       # Live 6-stage recording interface
│   │       └── report/page.tsx      # Speech review & analysis report
│   ├── globals.css                  # Color variables, typography, design tokens
│   ├── layout.tsx & page.tsx        # Root layout and landing page
│   └── middleware.ts                # Session cookie refresh & route protection
│
├── components/
│   ├── auth/                        # Authentication UI forms
│   ├── research/                    # Research workspace UI
│   ├── speech/
│   │   ├── speech-workspace.tsx     # MediaRecorder recording engine, timer, 6-stage rail
│   │   └── report-view.tsx          # Local audio playback & transcription/analysis display
│   └── ui/                          # Radix UI primitives & StatusBadge component
│
├── lib/
│   ├── research/                    # Research adapter & IndexedDB draft store
│   ├── speech/
│   │   ├── audio-store.ts           # IndexedDB client storage ('speech-meta' & 'speech-blob')
│   │   └── stages.ts                # 6 speaking stages config (300s total duration, helper math)
│   └── utils.js                     # Classnames helper (cn)
│
├── supabase/
│   ├── client.ts                    # Browser Supabase client
│   ├── server.ts                    # Server Supabase client (cookie-based SSR)
│   ├── config.toml                  # Local Supabase configuration
│   └── migrations/
│       ├── 20260904164603_remote_schema.sql                # Base schema: sessions, speech_responses, analyses, profiles
│       ├── 20260904170040_create_speech_recordings_bucket.sql # Bucket: 'speech-recordings' (private)
│       └── 202609100001_seed_topics.sql                    # Practice topics seed
│
├── docs/speakomo-audit.md           # Baseline audit notes
├── package.json                     # Next.js 15, React 18, @supabase/ssr, lucide-react, etc.
└── .env.example                     # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

---

## 3. Current Audio Pipeline State

### 3.1 Audio Capture (`components/speech/speech-workspace.tsx`)
- Captures microphone input via browser `navigator.mediaDevices.getUserMedia({ audio: true })`.
- Recorded through `MediaRecorder` with preferred MIME types:
  `audio/webm;codecs=opus` > `audio/webm` > `audio/mp4` > `audio/ogg`.
- Timer tracks up to 300 seconds (5 minutes) across 6 stages defined in `lib/speech/stages.ts`.
- When stopping (auto-stop or early-stop), audio chunks are merged into a single `Blob`.

### 3.2 Client Persistence (`lib/speech/audio-store.ts`)
- Stored into IndexedDB (`speakomo-recovery`):
  - Store `speech-blob`: Raw audio `Blob` keyed by `sessionId`.
  - Store `speech-meta`: Timing, duration, MIME type, byte size, and `idempotencyKey`.

### 3.3 Server Tracking (`app/api/[[...path]]/route.ts`)
- `POST /sessions/:id/speech/start`: Initializes session tracking with `idempotencyKey`.
- `POST /sessions/:id/speech/complete`: Records `ended_at`, `actual_duration_ms`, `stopped_reason`.
  *(Currently sets `upload_status: "upload_not_connected"` because server audio upload and ASR are not yet wired up).*

### 3.4 Target Database Schema (`supabase/migrations/20260904164603_remote_schema.sql`)
The target tables for ASR output already exist in the database schema:

```sql
-- public.speech_responses
CREATE TABLE "public"."speech_responses" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"       uuid NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  "audio_path"       text,               -- Path in storage bucket 'speech-recordings'
  "transcript"       text,               -- Full transcribed text from ASR
  "duration_seconds" integer,            -- Audio duration
  "word_count"       integer,            -- Total words in transcript
  "wpm"              numeric,            -- Words per minute
  "filler_count"     integer,            -- Detected filler words (um, uh, like, etc.)
  "created_at"       timestamptz DEFAULT now()
);

-- public.analyses
CREATE TABLE "public"."analyses" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"         uuid NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  "content_analysis"   jsonb NOT NULL DEFAULT '{}'::jsonb,
  "reasoning_analysis" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "feedback"           text,
  "created_at"         timestamptz DEFAULT now()
);
```

---

## 4. Steps to Implement the ASR Integration

To connect the ASR model, implement the following four components:

### Step 1: Audio Upload to Supabase Storage
1. When recording finishes in `SpeechWorkspace` (`components/speech/speech-workspace.tsx`):
   - Take the audio `Blob` from `chunksRef`.
   - Upload the blob to Supabase Storage bucket `speech-recordings` under:
     `${userId}/${sessionId}.${extension}`.
   - Use either client-side Supabase upload or a signed upload URL via a dedicated Next.js API route (`/api/sessions/[sessionId]/speech/upload`).

### Step 2: Create ASR Service Adapter (`lib/speech/asr-adapter.ts`)
Define a unified ASR interface to support model providers (OpenAI Whisper, Groq Whisper, Deepgram, or a self-hosted Whisper endpoint):

```typescript
export type TranscriptionResult = {
  text: string;
  durationSeconds: number;
  wordCount: number;
  wpm: number;
  fillerCount: number;
  words?: Array<{ word: string; start: number; end: number }>;
};

export interface AsrAdapter {
  transcribe(audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult>;
}
```

*Key Metrics to Compute from ASR Output:*
- `wordCount`: Split normalized transcript by whitespace.
- `wpm`: `Math.round((wordCount / (durationSeconds / 60)) * 10) / 10`.
- `fillerCount`: Regex match on target filler tokens (`\b(um|uh|er|ah|like|you know)\b`).

### Step 3: Implement ASR API Route (`app/api/[[...path]]/route.ts` or `/api/transcribe`)
Add route handling:
1. Authenticate user and verify ownership of `sessionId`.
2. Retrieve the audio file (either received as `FormData` stream or downloaded from Supabase Storage `speech-recordings`).
3. Call `AsrAdapter.transcribe(...)`.
4. Persist result into `public.speech_responses`:
   ```sql
   INSERT INTO speech_responses (session_id, audio_path, transcript, duration_seconds, word_count, wpm, filler_count)
   VALUES ($1, $2, $3, $4, $5, $6, $7)
   ON CONFLICT (session_id) DO UPDATE ...;
   ```
5. Update `sessions.status = 'speech_completed'`.

### Step 4: Connect the UI Report (`components/speech/report-view.tsx`)
Update `report-view.tsx`:
1. Query `speech_responses` for the current `sessionId`.
2. Replace reserved placeholders ("Transcription unavailable", "Analysis unavailable") with:
   - Full transcript box with readable styling.
   - Pacing metrics bar (WPM, duration, word count).
   - Filler word highlight cards (count and frequency).
3. If processing is in progress, show an active transcription status indicator.

---

## 5. Recommended Environment Configuration

Add the following environment variables to `.env.local`:
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key # For server-side storage access

# ASR Model Provider (e.g., Groq, OpenAI, or Self-Hosted)
ASR_PROVIDER=groq # or openai / deepgram / custom
ASR_API_KEY=your_api_key_here
ASR_MODEL=whisper-large-v3
# Optional: Self-hosted Whisper URL
# ASR_ENDPOINT_URL=http://localhost:8000/transcribe
```
