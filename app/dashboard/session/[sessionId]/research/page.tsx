import ResearchSessionActions from "@/components/research/research-session-actions";

type PageProps = { params: Promise<{ sessionId: string }> };

export default async function SessionResearchPage({ params }: PageProps) {
  const { sessionId } = await params;
  return (
    <main className="mx-auto max-w-4xl px-6 py-12 lg:px-10 lg:py-16">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--olive-eyebrow)]">Saved research</p>
      <h1 className="display-serif mt-3 text-6xl text-[var(--ink-heading)]">Your material is safe.</h1>
      <p className="mt-5 max-w-xl leading-7 text-[var(--ink-muted)]">
        This session has been saved. Choose how you would like to practise below. Nothing is fabricated — research-grounded cues appear only when AI processing succeeds against your material.
      </p>
      <ResearchSessionActions sessionId={sessionId} />
    </main>
  );
}

