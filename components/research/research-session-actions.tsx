"use client";

import Link from "next/link";
import { useState } from "react";

type Props = { sessionId: string };

export default function ResearchSessionActions({ sessionId }: Props) {
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const [aiAvailable, setAiAvailable] = useState(false);
  const [opted, setOpted] = useState(false);

  async function retryProcessing() {
    setProcessing(true); setMessage("");
    try {
      const response = await fetch("/api/research/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "retry", images: [] }) });
      const data = await response.json();
      setAiAvailable(response.ok && data?.generated === true);
      setMessage(data?.message ?? data?.error ?? "Research processing is unavailable.");
    } catch { setMessage("Research processing could not be reached."); }
    finally { setProcessing(false); }
  }

  return <div className="mt-8 space-y-6">
    <div className="rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-bg)] p-5 text-sm text-[var(--warning-dark-text)]">
      <p className="font-semibold uppercase tracking-[0.16em] text-xs text-[var(--warning-text)]">AI research processing</p>
      <p className="mt-2 leading-6">Research-grounded cue cards are not available in this environment because the AI provider is not connected. Your research material has been preserved. You can retry when a provider is configured, or continue to a speaking session using clearly labelled generic prompts.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={retryProcessing} disabled={processing} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--olive-text)] hover:bg-[var(--surface-inner)] transition-colors disabled:opacity-40">{processing ? "Retrying…" : "Retry AI processing"}</button>
        {aiAvailable && <Link href={`/dashboard/session/${sessionId}/speak?cueMode=research_grounded`} className="rounded-full bg-[var(--olive-primary)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]">Start speaking session (research-grounded) ↗</Link>}
      </div>
      {message && <p className="mt-3 text-xs text-[var(--warning-dark-text)]">{message}</p>}
    </div>

    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 text-sm text-[var(--ink-muted)]">
      <p className="font-semibold uppercase tracking-[0.16em] text-xs text-[var(--olive-eyebrow)]">Practise without research-grounded cues</p>
      <p className="mt-2 leading-6 text-[var(--ink-muted)]">You can still record a five-minute speaking session using six generic prompts. These prompts are not derived from your research and will be clearly labelled <span className="font-semibold text-[var(--ink)]">Not research-grounded</span> throughout the session and in the report.</p>
      <label className="mt-4 flex items-start gap-3 text-sm text-[var(--ink)]">
        <input type="checkbox" checked={opted} onChange={(event) => setOpted(event.target.checked)} className="mt-1 accent-[var(--olive-primary)]" />
        <span>I understand these prompts are generic scaffolding, not extracted from my research material.</span>
      </label>
      <div className="mt-4">
        {opted ? <Link href={`/dashboard/session/${sessionId}/speak?cueMode=generic`} className="inline-block rounded-full bg-[var(--olive-primary)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]">Begin speaking session · generic prompts ↗</Link> : <button type="button" disabled className="rounded-full bg-[var(--olive-primary)] px-5 py-2 text-sm font-semibold text-white opacity-40">Begin speaking session · generic prompts</button>}
      </div>
    </div>

    <div className="flex flex-wrap gap-3">
      <Link href={"/dashboard"} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--olive-text)] transition hover:bg-[var(--surface-inner)]">Back to dashboard</Link>
      <Link href={`/dashboard/session/${sessionId}/report`} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--olive-text)] transition hover:bg-[var(--surface-inner)]">View report</Link>
    </div>
  </div>;
}
