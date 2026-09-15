import ReportView from "@/components/speech/report-view";

type PageProps = { params: Promise<{ sessionId: string }> };

export default async function ReportPage({ params }: PageProps) {
  const { sessionId } = await params;
  return <ReportView sessionId={sessionId} />;
}
