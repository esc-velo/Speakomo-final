# Speakomo

**Research briefly. Think clearly. Speak confidently.**

Speakomo is an AI-powered spontaneous speaking and reasoning coach. It helps you practise turning information into a clear, structured spoken response, even when you have limited preparation time.

Instead of giving you a script to read, Speakomo gives you a topic, a bounded research period, and a timed speaking session. It then helps you review how you communicated your ideas and where your reasoning could be stronger.

## How Speakomo works

1. **Choose a topic.** Start a practice session with a topic to explore.
2. **Research for 15 minutes.** Review information, capture useful notes, and decide what matters most.
3. **Speak for 5 minutes.** Record your response in the browser. Live cue cards help you move through the talk without writing a full script.
4. **Review your performance.** Speakomo transcribes your response and presents measurable speech metrics alongside feedback on your content and reasoning.
5. **Learn from each session.** Revisit saved sessions and use the feedback to make your next response more focused, better supported, and easier to follow.

The goal is not to memorise impressive-sounding answers. It is to practise thinking on your feet and explaining your ideas with clarity.

## Features

- **Guided speaking practice** with topic-based sessions.
- **Timed research workspace** with a 15-minute research period and space for notes.
- **Five-minute speech recording** using your browser microphone.
- **Live cue cards** that guide the response through six stages: **Frame → Context → Concept 1 → Concept 2 → Evidence → Close**.
- **Speech-to-text transcription** so you can review what you actually said.
- **Speech metrics** such as speaking duration, word count, speaking rate, and filler-word indicators where supported by the transcript or analysis pipeline.
- **Content and reasoning feedback** focused on relevance, structure, clarity, claims, evidence, assumptions, counterarguments, and conclusions.
- **Session history** to revisit previous practice and feedback.
- **Account-based sessions** so your saved practice is associated with your account.

Speakomo separates observable metrics, such as duration and word count, from AI-generated interpretations, such as a possible reasoning gap. AI feedback is guidance, not an infallible or objective judgement of your ability.

## Getting started as a user

1. Open Speakomo in your browser and sign in or create an account.
2. Start a new practice session and choose a topic.
3. Use the research timer to gather information and write short notes. Focus on the main idea, supporting evidence, and at least one limitation or counterargument.
4. When the research period ends, begin the speaking session and allow microphone access when your browser asks.
5. Follow the cue cards, but speak naturally rather than reading a prepared script.
6. Review your transcript, metrics, and feedback. Pick one specific improvement to practise in your next session.

**A useful practice tip:** Do not try to cover everything you found during research. A clear claim supported by a good example is usually stronger than a rushed list of facts.

## Technology

Speakomo is built with a web-first stack:

- **Next.js 16** with the App Router
- **React** and **TypeScript**
- **Tailwind CSS** for styling
- **Framer Motion** for interface transitions
- **Zustand** for client-side session state
- **Supabase** for PostgreSQL, authentication, storage, and row-level security
- **Vercel** for deployment
- **Speech-to-text and language-model services** behind server-side integration boundaries

AI providers are kept replaceable so the application can evolve without tying core product logic to one vendor.

## Run locally

### Prerequisites

- Node.js compatible with Next.js 16
- npm (or the package manager used by the repository)
- A Supabase project
- Credentials for any speech-to-text or language-model provider required by the current configuration

### 1. Clone the repository

```bash
git clone <repository-url>
cd speakomo
```

Replace `<repository-url>` with the URL of your repository.

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a local environment file from the example:

```bash
cp .env.example .env.local
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example .env.local
```

Fill in the variables documented in `.env.example`, including the Supabase project configuration and any AI service credentials required by your setup. Keep private credentials server-side. Never commit `.env.local` or expose secret keys through client-side variables.

### 4. Set up Supabase

1. Configure your Supabase project and authentication settings.
2. Apply the SQL migrations in `supabase/migrations/` using the workflow documented by the project.
3. Check that the required tables, storage policies, and row-level security rules are in place.
4. Use `supabase/seed.sql` only if you need the project's development or test seed data.

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

To create and run a production build, use the scripts configured in `package.json`, commonly:

```bash
npm run build
npm run start
```

## Project structure

```text
app/                 Pages, layouts, and API route handlers
components/           Reusable UI and feature components
lib/                  Session, topic, speech, analysis, and integration logic
stores/               Client-side session state
supabase/migrations/  Version-controlled database changes
types/                Shared TypeScript contracts
tests/                Unit and integration tests
```

The application follows a simple separation of responsibilities: pages compose the experience, API handlers validate requests and delegate work, `lib/` owns application logic, and Supabase remains the source of truth for persisted data.

## Privacy and responsible use

Speech recordings, transcripts, notes, and analysis may contain personal or sensitive information. Depending on the configured providers and application settings, audio or transcript data may be processed by external speech-to-text or AI services. Review the applicable service and privacy policies before using Speakomo with sensitive material.

Speakomo is designed for communication practice. Its feedback should not be treated as a formal psychological, academic, employment, or professional assessment. Verify factual claims and use your own judgement when applying suggestions.

## Development principles

- Keep business logic out of UI components.
- Keep API handlers thin and validate incoming data.
- Keep AI-provider integrations replaceable.
- Separate deterministic speech metrics from AI-generated inference.
- Use database migrations for schema changes and enforce user-level access with row-level security.
- Handle microphone, network, database, transcription, and analysis failures without silently losing completed work.
- Prioritise a reliable research → speech → analysis loop over infrastructure that does not yet solve a demonstrated problem.

## Roadmap

Planned extensions may include research-to-speech comparison, personalised AI challenge questions, follow-up response analysis, and richer cross-session progress trends. These should build on a reliable core practice flow rather than replace it.

---

**Speakomo** — practise turning what you learn into what you can explain.
