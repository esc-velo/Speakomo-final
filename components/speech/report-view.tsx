"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatMmSs } from "@/lib/speech/stages";
import { loadSpeechBlob, loadSpeechMeta, type StoredSpeechMeta } from "@/lib/speech/audio-store";
import { StatusBadge, type StatusKind } from "@/components/ui/status-badge";

type Props = { sessionId: string };

export default function ReportView({ sessionId }: Props) {
  const [meta, setMeta] = useState<StoredSpeechMeta | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let objectUrl: string | null = null;
    (async () => {
      try {
        const [metaResult, blob] = await Promise.all([loadSpeechMeta(sessionId), loadSpeechBlob(sessionId)]);
        setMeta(metaResult);
        if (blob) { objectUrl = URL.createObjectURL(blob); setAudioUrl(objectUrl); }
      } finally { setLoading(false); }
    })();
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [sessionId]);

  const durationSec = meta?.actualDurationMs != null ? Math.round(meta.actualDurationMs / 1000) : null;
  const cueModeLabel = meta?.cueMode === "generic" ? "Generic prompts (not research-grounded)" : meta?.cueMode === "research_grounded" ? "Research-grounded" : "Unknown";
  const stoppedLabel = meta?.stoppedReason ? meta.stoppedReason.replace(/_/g, " ") : "—";
  const serverSyncKind: StatusKind = meta?.serverSyncStatus === "synced" ? "synced" : meta?.serverSyncStatus === "failed" ? "failed" : "not_connected";

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 lg:px-10 lg:py-16">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--olive-eyebrow)]">Speech report</p>
      <h1 className="display-serif mt-3 text-6xl text-[var(--ink-heading)]">Your recording.</h1>
      <p className="mt-4 max-w-xl leading-7 text-[var(--ink-muted)]">
        Playback and metadata below are stored locally in this browser. Server-side transcription and analysis are not connected yet — no scores, transcripts, or feedback are fabricated.
      </p>

      {loading && (
        <p className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6 text-sm text-[var(--ink-muted)]">
          Loading local recording…
        </p>
      )}

      {!loading && !meta && (
        <div className="mt-8 rounded-2xl border border-dashed border-[var(--border-dashed)] p-10 text-center">
          <p className="display-serif text-3xl text-[var(--ink-heading)]">No recording found for this session.</p>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[var(--ink-muted)]">
            Start a speaking session first. Recordings are kept in this browser only.
          </p>
          <Link
            href={`/dashboard/session/${sessionId}/speak?cueMode=generic`}
            className="mt-6 inline-block rounded-full bg-[var(--olive-primary)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]"
          >
            Begin speaking session ↗
          </Link>
        </div>
      )}

      {!loading && meta && (
        <>
          <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_0.5fr]">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--olive-eyebrow)]">Playback (local)</p>
                <StatusBadge kind={audioUrl ? "local_only" : "unavailable"} />
              </div>
              {audioUrl ? (
                <audio controls src={audioUrl} className="mt-4 w-full" />
              ) : (
                <p className="mt-4 text-sm text-[var(--error-text)]">
                  Local recording is unavailable in this browser. Live audio cannot be recovered after a crash.
                </p>
              )}
              <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wider text-[var(--ink-subtle)]">Duration</dt>
                  <dd className="mt-1 text-lg tabular-nums text-[var(--ink-heading)]">{durationSec != null ? formatMmSs(durationSec) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-[var(--ink-subtle)]">Stopped by</dt>
                  <dd className="mt-1 text-lg capitalize text-[var(--ink-heading)]">{stoppedLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-[var(--ink-subtle)]">Cue mode</dt>
                  <dd className="mt-1 text-lg text-[var(--ink-heading)]">{cueModeLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-[var(--ink-subtle)]">Upload</dt>
                  <dd className="mt-1"><StatusBadge kind="upload_not_connected" /></dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-[var(--ink-subtle)]">Server sync</dt>
                  <dd className="mt-1"><StatusBadge kind={serverSyncKind} /></dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-[var(--ink-subtle)]">File</dt>
                  <dd className="mt-1 text-lg text-[var(--ink-heading)]">{meta.audioBytes != null ? `${(meta.audioBytes / 1024 / 1024).toFixed(2)} MB` : "—"}</dd>
                </div>
              </dl>
            </div>
            <aside className="h-fit rounded-2xl border border-[var(--banner-sage-border)] bg-[var(--banner-sage-bg)] p-6 text-[var(--banner-sage-text)]">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--olive-primary)]">Reserved sections</p>
              <div className="mt-4 space-y-4 text-sm leading-6">
                <div>
                  <p className="font-semibold text-[var(--banner-sage-dark-text)]">Transcription unavailable</p>
                  <p>Speech-to-text is not connected yet. When enabled, your transcript will appear here without fabrication.</p>
                </div>
                <div>
                  <p className="font-semibold text-[var(--banner-sage-dark-text)]">Analysis unavailable</p>
                  <p>Filler-word counts, pacing, and content feedback are not connected yet. Nothing is inferred from silence.</p>
                </div>
                <div>
                  <p className="font-semibold text-[var(--banner-sage-dark-text)]">Areas for improvement</p>
                  <p>Reserved for a future release once analysis is grounded.</p>
                </div>
              </div>
            </aside>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={`/dashboard/session/${sessionId}/research`}
              className="rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--olive-text)] transition hover:bg-[var(--surface-inner)]"
            >
              Back to research
            </Link>
            <Link
              href={`/dashboard/session/${sessionId}/speak?cueMode=${meta.cueMode}`}
              className="rounded-full bg-[var(--olive-primary)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]"
            >
              Practise again ↗
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
