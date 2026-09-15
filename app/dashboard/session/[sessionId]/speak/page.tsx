import SpeechWorkspace from "@/components/speech/speech-workspace";

type PageProps = { params: Promise<{ sessionId: string }>; searchParams: Promise<{ cueMode?: string }> };

export default async function SpeakPage({ params, searchParams }: PageProps) {
  const { sessionId } = await params;
  const { cueMode } = await searchParams;
  const resolvedCueMode = cueMode === "research_grounded" ? "research_grounded" : "generic";
  return <main className="mx-auto max-w-6xl px-6 py-10 lg:px-10 lg:py-14">
    <SpeechWorkspace sessionId={sessionId} cueMode={resolvedCueMode} />
  </main>;
}
