# Speakomo repository audit

## Verified from repository snapshot

- GitHub source: `esc-velo/Speakomo`, branch `main`, commit `393fb8a`.
- Next.js App Router, TypeScript, Supabase SSR/browser clients, Zustand, and route-based session flow are established in the source repository.
- Existing tables in the snapshot: `profiles`, `topics`, `sessions`, `research_sessions`, `speech_responses`, and `analyses`.
- Existing private bucket in the snapshot: `speech-recordings`.
- Existing implementation is incomplete: research, speech, results, and analysis pages are placeholders; speech and analysis endpoints are status stubs.

## Unverified and intentionally not claimed

- Live database schema and production data.
- Live RLS policies, grants, and functions.
- Live Storage buckets, object policies, and existing audio objects.
- Current Supabase Auth providers, redirect URLs, email confirmation, and session settings.

## Safe migration posture

- No tables are dropped, reset, renamed, or rewritten.
- `202609140001_speakomo_research_foundation.sql` is additive and reviewed against the repository snapshot only.
- `202609140002_storage_policy_proposal.sql.disabled` is intentionally not executable until the live Storage project is inspected.
- Research AI remains behind a provider-disabled adapter returning `AI_PROVIDER_NOT_CONFIGURED`; no provider key or outbound AI call is used.

## Figma adaptation

The supplied reference uses a warm white canvas, generous whitespace, oversized serif display type, small sans-serif navigation, thin neutral borders, and muted olive pill actions. The Speakomo foundation adapts those patterns into an academic workspace rather than copying the product-launch content.

## Deployment-readiness task

Before production release, compare the live Supabase schema, grants, RLS, Storage buckets/policies, and Auth configuration against the repository snapshot and the reviewed additive migration. Do not apply the storage proposal until that comparison is complete.