# Speakomo

> AI-powered spontaneous speaking and reasoning coach.

## 1. Project Goal

Speakomo is a web-first application that gives a user a topic, provides
a bounded research period, asks them to speak continuously for a fixed
period, and analyzes how they communicated and reasoned.

Core flow:

``` text
Random Topic
    ↓
15-Minute Research
    ↓
5-Minute Spontaneous Speech
    ↓
Speech + Content + Reasoning Analysis
    ↓
Actionable Feedback
    ↓
AI Challenge / Follow-up
    ↓
Progress Over Time
```

The research phase is the controlled stimulus. The spoken response is
the observable performance. AI analysis is the core product.

This is not a generic chatbot, interview simulator, research assistant,
or clone of an existing research/speaking platform.

## 2. V1 Scope

### V1a --- Must Have

-   Authentication
-   Dashboard
-   Start practice session
-   Topic generation/selection
-   15-minute research phase
-   Research notes
-   5-minute speaking phase
-   Browser microphone recording
-   Speech-to-text
-   Deterministic speech metrics
-   Content/reasoning analysis
-   Results page
-   Persistent session data

Minimum successful flow:

``` text
Login → Dashboard → Topic → Research → Speak → Analyze → Results
```

### V1b --- Stretch

-   Research-to-speech comparison
-   AI challenge questions
-   Follow-up response analysis
-   Session history
-   Cross-session progress trends

## 3. Locked Technical Stack

### Web

  Technology      Purpose
  --------------- -------------------------------
  Next.js 16      Full-stack web framework
  App Router      Routing/application structure
  TypeScript      Application language
  React           UI
  Tailwind CSS    Styling
  Framer Motion   Animation/transitions
  Zustand         Client-side state

### Backend

  Technology               Purpose
  ------------------------ -----------------------------------------
  Next.js Route Handlers   HTTP API
  Next.js Server Actions   Server-side mutations where appropriate

### Supabase

  Capability   Purpose
  ------------ ----------------------------
  PostgreSQL   Persistent relational data
  Auth         Authentication/session
  Storage      Audio/file storage
  RLS          User data isolation

### Deployment

-   Vercel

### AI / ML

The AI/ML implementation is intentionally not completely locked.

Still TBD:

-   Speech-to-text provider
-   LLM provider
-   Speech/audio analysis implementation
-   ML service framework
-   Embedding model
-   Vector database
-   RAG implementation

Do not add technologies merely because they are fashionable.

## 4. Architecture

``` text
                         USER
                          │
                          ▼
                  ┌───────────────┐
                  │   WEB CLIENT  │
                  │ Next.js/React │
                  └───────┬───────┘
                          │
                          ▼
                  ┌───────────────┐
                  │    NEXT.JS    │
                  │  APPLICATION  │
                  │ Route Handlers│
                  │ Server Actions│
                  └───────┬───────┘
                          │
              ┌───────────┼────────────┐
              │           │            │
              ▼           ▼            ▼
          Supabase      AI/ML       Storage
              │         Service         │
              │            │            │
          PostgreSQL    STT / LLM     Audio
          Auth          Analysis
          RLS           Retrieval
```

### Architectural rules

1.  Frontend components must not contain core AI/business logic.
2.  API handlers should be thin and delegate to `lib/`.
3.  Supabase is the source of truth for persistent state.
4.  Zustand is client state, not a database.
5.  AI providers must remain replaceable.
6.  Keep deterministic speech metrics separate from AI-generated
    inference.
7.  Do not introduce infrastructure without a concrete requirement.

## 5. Project Structure

``` text
speakomo/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── practice/page.tsx
│   │   ├── session/[sessionId]/
│   │   │   ├── page.tsx
│   │   │   ├── research/page.tsx
│   │   │   ├── speak/page.tsx
│   │   │   └── results/page.tsx
│   │   └── history/page.tsx
│   ├── api/
│   │   ├── sessions/route.ts
│   │   ├── topics/route.ts
│   │   ├── speech/route.ts
│   │   └── analysis/route.ts
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── ui/
│   ├── layout/
│   ├── topic/
│   ├── research/
│   ├── speech/
│   ├── analysis/
│   └── dashboard/
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   └── server.ts
│   ├── api/
│   ├── sessions/
│   ├── topics/
│   ├── speech/
│   ├── analysis/
│   ├── validation/
│   └── utils/
├── stores/
│   └── session-store.ts
├── types/
│   ├── session.ts
│   ├── topic.ts
│   ├── speech.ts
│   └── analysis.ts
├── public/
├── supabase/
│   ├── migrations/
│   └── seed.sql
├── tests/
│   ├── unit/
│   └── integration/
├── .env.local
├── .env.example
├── .gitignore
├── next.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

## 6. Directory Responsibilities

### `app/`

Routes, pages, layouts, and HTTP entry points. Pages compose components
and call application logic. Avoid putting large business workflows
directly in page files.

### `app/(auth)/`

Login/signup UI. Authentication is provided by Supabase Auth.

### `app/(dashboard)/`

Authenticated product experience: dashboard, practice setup, session
flow, research, speaking, results, and history.

### `app/session/[sessionId]/`

The active practice workflow:

``` text
/session/:sessionId
/session/:sessionId/research
/session/:sessionId/speak
/session/:sessionId/results
```

### `app/api/`

Backend HTTP entry points:

``` text
/api/sessions
/api/topics
/api/speech
/api/analysis
```

Preferred pattern:

``` text
Route Handler
   ↓
Validation
   ↓
Application logic in lib/
   ↓
Supabase / AI service
   ↓
Response
```

### `components/`

Reusable UI components.

-   `ui/`: generic primitives such as Button, Card, Dialog, Input,
    Badge.
-   `layout/`: navigation and layout components.
-   `topic/`: topic card, lottery, domain/difficulty controls.
-   `research/`: research timer, notes, research phase.
-   `speech/`: recorder, controls, timer, audio visualizer.
-   `analysis/`: speech metrics, content/reasoning analysis, feedback,
    challenges.
-   `dashboard/`: dashboard-specific UI.

Components should not directly own core AI or database orchestration.

### `lib/`

Application logic and integrations.

-   `supabase/`: browser/server Supabase clients.
-   `sessions/`: session lifecycle and state transitions.
-   `topics/`: topic generation/selection.
-   `speech/`: audio upload, transcription orchestration, speech
    metrics.
-   `analysis/`: speech/content/reasoning analysis and feedback
    orchestration.
-   `validation/`: input and external-response validation.
-   `utils/`: genuinely generic helpers only.

### `stores/`

Zustand state for active client-side workflows, such as current phase,
timers, and recording state.

Persistent data belongs in Supabase.

### `types/`

Shared TypeScript contracts for sessions, topics, speech, and analysis.

AI outputs should conform to structured contracts rather than arbitrary
prose whenever practical.

### `supabase/`

Version-controlled database infrastructure.

`migrations/` contains schema changes. `seed.sql` contains
development/test data.

### `tests/`

Unit tests for deterministic logic and integration tests for important
application workflows.

## 7. Core Data Model

Initial conceptual entities:

``` text
profiles
topics
sessions
research_sessions
speech_responses
analyses
```

Relationship:

``` text
Profile
   │
   └── Sessions
         │
         ├── Topic
         ├── Research Session
         │      ├── Notes
         │      └── References
         ├── Speech Response
         │      ├── Audio reference
         │      ├── Transcript
         │      └── Speech Metrics
         └── Analysis
                ├── Content
                ├── Reasoning
                └── Feedback
```

The exact schema may evolve during implementation.

## 8. Speech Analysis

Separate two categories.

### Observable metrics

Examples:

-   Duration
-   Word count
-   Words per minute
-   Filler count
-   Pause information where available
-   Repetition indicators
-   Segment timing

These should be deterministic whenever practical.

### Higher-level inference

Examples:

-   Possible hesitation
-   Reasoning gap
-   Weak argument
-   Lack of evidence

These are inferences and must not be presented as directly measured
facts.

## 9. Content and Reasoning Analysis

Inputs:

``` text
Topic
+
Transcript
+
Available speech metrics
```

Evaluate:

-   Relevance
-   Structure
-   Clarity
-   Claims
-   Evidence
-   Examples
-   Counterarguments
-   Assumptions
-   Conclusion quality
-   Reasoning strengths/weaknesses
-   Actionable improvements

Prefer structured output:

``` json
{
  "relevance": {},
  "structure": {},
  "claims": [],
  "evidence": [],
  "counterarguments": [],
  "assumptions": [],
  "reasoning": {},
  "strengths": [],
  "improvements": []
}
```

The exact schema is not yet locked.

## 10. AI Challenge

The follow-up challenge should target a weakness discovered in the
response.

Potential targets:

``` text
unsupported claim
reasoning gap
unstated assumption
missing counterargument
weak evidence
```

The challenge should be derived from the user's response and analysis
rather than being a random question.

This is V1b.

## 11. Research Phase

Default V1 configuration:

``` text
Research: 15 minutes
Speaking: 5 minutes
```

The user may use external research resources.

The application is not intended to replace a search engine.

Potentially persisted:

-   research notes
-   optional source/reference metadata
-   research start/end timestamps

Automatic ingestion of external research content is not currently
locked.

## 12. RAG

RAG is optional and must not block V1.

Potential architecture:

``` text
Research Sources / Notes
        ↓
Document Processing
        ↓
Chunking
        ↓
Embeddings
        ↓
Vector Store
        ↓
Retriever
        ↓
Relevant Context
        ↓
LLM
```

Potential uses:

1.  Compare researched information with spoken content.
2.  Generate challenges grounded in research.
3.  Identify relevant evidence the user encountered but failed to use.
4.  Later retrieve patterns from previous sessions.

Do not add a vector database or RAG pipeline before the core
speech-analysis loop works.

## 13. API Responsibilities

Initial conceptual API:

``` text
POST /api/sessions
```

Create a practice session.

``` text
GET /api/sessions/:id
```

Retrieve session state.

``` text
POST /api/topics
```

Generate/retrieve a topic.

``` text
POST /api/speech
```

Accept/process a speech response.

``` text
POST /api/analysis
```

Start or retrieve analysis.

The exact API surface can evolve when implementation reveals better
boundaries.

## 14. Security

-   Authenticate before accessing persistent private sessions.
-   Enforce user-level data isolation with Supabase RLS.
-   Keep external API credentials server-side.
-   Never expose secrets in client-side code.
-   Validate user-controlled input.
-   Use HTTPS in production.
-   Do not expose sensitive session data through unauthenticated
    endpoints.
-   Provide a mechanism to delete persisted user data.

## 15. Privacy

Spoken responses and transcripts may contain sensitive information.

The system should communicate that audio, transcripts, and derived
analysis may be processed by external AI services.

Only necessary data should be persisted.

Raw audio should not be retained by default unless explicitly required.
Final audio retention duration remains an open decision.

## 16. Performance

Current target:

> Initial post-speech analysis should ideally appear within
> approximately 10 seconds under normal network conditions after
> sufficient transcript/analysis data is available.

The active UI must remain responsive while analysis is running.

External service timeouts must be handled gracefully.

## 17. Error Handling

Potential failures include:

``` text
Microphone unavailable
Microphone permission denied
Audio recording failure
Audio upload failure
STT timeout
STT malformed response
LLM timeout
LLM malformed response
Database failure
Network interruption
```

The application should:

-   preserve completed user data where possible
-   show understandable errors
-   avoid silent data loss
-   distinguish retryable failures
-   avoid crashing the session
-   avoid exposing raw provider errors

## 18. Development Workflow

Build using vertical slices:

``` text
Feature
  ↓
UI
  ↓
API
  ↓
Database
  ↓
AI/ML if required
  ↓
Error handling
  ↓
Testing
  ↓
Deployment
```

Do not work as:

``` text
Frontend first
Backend second
ML last
```

Integration should happen continuously.

## 19. Three-Week Delivery Plan

### Week 1 --- Skeleton + Research

``` text
Day 1
Repository
Next.js
TypeScript
Tailwind
Framer Motion
Zustand
Supabase
Vercel
Folder structure

Day 2
Authentication

Day 3
Database schema

Day 4
Dashboard + session creation

Day 5
Topic generation

Day 6
Research workspace + timer

Day 7
Topic → Research flow
```

### Week 2 --- Speech + AI

``` text
Day 8
Audio recording

Day 9
Audio storage

Day 10
Speech-to-text

Day 11
Speech metrics

Day 12
Content/reasoning analysis

Day 13
Pipeline integration

Day 14
Results page
```

### Week 3 --- Differentiation + Reliability

``` text
Day 15
Research-to-speech comparison

Day 16
AI challenge

Day 17
History/progress

Day 18
Failure handling

Day 19
UX polish

Day 20
End-to-end testing

Day 21
Feature freeze + deployment/demo
```

## 20. Definition of Done

A feature is not complete because the happy-path button works.

It is complete when:

``` text
UI
 ↓
Backend
 ↓
Database
 ↓
Loading state
 ↓
Error handling
 ↓
Testing
 ↓
Production deployment
```

Speech recording is complete only when:

``` text
Record
 ↓
Permission handled
 ↓
Timer works
 ↓
Audio generated
 ↓
Upload succeeds
 ↓
Session updated
 ↓
Failure handled
 ↓
Analysis starts
 ↓
Results available
```

## 21. Agent Rules

Any coding agent working on this repository must:

1.  Read this README before making architectural changes.
2.  Preserve locked technical decisions unless there is concrete
    evidence they are inadequate.
3.  Avoid unnecessary dependencies.
4.  Prefer the simplest implementation satisfying the current
    requirement.
5.  Keep business logic outside UI components.
6.  Keep API handlers thin.
7.  Keep provider-specific AI code behind a replaceable service
    boundary.
8.  Use TypeScript contracts for important data.
9.  Validate external and user input.
10. Never expose secrets to the browser.
11. Do not replace real persistence with mock data once persistence
    exists.
12. Do not invent requirements.
13. Do not build future features before the current V1 slice works.
14. Do not add RAG, vector databases, queues, microservices, or similar
    infrastructure without a demonstrated need.
15. Preserve the distinction between measured speech metrics and AI
    inference.
16. Use migrations for database schema changes.
17. Test external-service failure paths.
18. Keep the application deployable throughout development.
19. If a requirement is ambiguous, identify the ambiguity instead of
    silently choosing a complex solution.
20. Protect the three-week V1 timeline.

## 22. Current Status

### Locked

-   Product direction
-   Web-first V1
-   Core research → speech → analysis workflow
-   Next.js 16
-   App Router
-   TypeScript
-   React
-   Tailwind CSS
-   Framer Motion
-   Zustand
-   Next.js Route Handlers
-   Next.js Server Actions where appropriate
-   Supabase PostgreSQL
-   Supabase Auth
-   Supabase Storage
-   Vercel
-   Separate AI/ML service boundary

### Open

-   Speech-to-text provider
-   LLM provider
-   Speech-analysis implementation
-   ML service framework
-   RAG implementation
-   Vector database
-   Topic domains
-   Difficulty levels
-   Topic-generation strategy
-   Final scoring rubric
-   Weighting between speech delivery/content/reasoning
-   Audio retention period
-   Exact AI latency after benchmarking

## 23. Product Principle

Speakomo should ultimately answer one question well:

> **After giving someone limited time to research a topic, how
> effectively can they turn that information into clear, structured,
> evidence-based spoken reasoning?**

Everything in V1 should serve that question.

If a feature does not improve the research → speech → analysis loop, it
should not outrank making that loop reliable.
