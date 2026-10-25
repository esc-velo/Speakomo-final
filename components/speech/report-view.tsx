"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clock,
  Copy,
  Gauge,
  Headphones,
  Loader2,
  Mic,
  MessageSquare,
  Sparkles,
  Volume2,
  AlertCircle,
} from "lucide-react";
import { formatMmSs } from "@/lib/speech/stages";
import { loadSpeechBlob, loadSpeechMeta, saveSpeechMeta, type StoredSpeechMeta } from "@/lib/speech/audio-store";
import { StatusBadge, type StatusKind } from "@/components/ui/status-badge";
import {
  countFillerWords,
  parseTranscriptWithHighlights,
  TARGET_FILLER_WORDS,
} from "@/lib/speech/asr-metrics";

type Props = { sessionId: string };

type SpeechResponseRecord = {
  id: string;
  session_id: string;
  audio_path: string | null;
  transcript: string | null;
  duration_seconds: number | null;
  word_count: number | null;
  wpm: number | null;
  filler_count: number | null;
  created_at: string;
};

export default function ReportView({ sessionId }: Props) {
  const [meta, setMeta] = useState<StoredSpeechMeta | null>(null);
  const [speechResponse, setSpeechResponse] = useState<SpeechResponseRecord | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [highlightFillers, setHighlightFillers] = useState(true);
  const [copied, setCopied] = useState(false);

  const pollCountRef = useRef(0);
  const localBlobRef = useRef<Blob | null>(null);

  const audioUrlRef = useRef<string | null>(null);

  // Fetch speech_response from server
  const fetchSpeechResponse = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/speech/response`);
      if (res.ok) {
        const data = await res.json();
        if (data.speechResponse) {
          setSpeechResponse(data.speechResponse);
          if (data.signedAudioUrl && !audioUrlRef.current) {
            audioUrlRef.current = data.signedAudioUrl;
            setAudioUrl(data.signedAudioUrl);
          }
          return data.speechResponse as SpeechResponseRecord;
        }
      }
    } catch {
      // best-effort
    }
    return null;
  }, [sessionId]);

  // Trigger transcription
  const triggerTranscription = useCallback(async () => {
    setIsTranscribing(true);
    setTranscribeError(null);

    try {
      let res: Response;
      if (localBlobRef.current && localBlobRef.current.size > 0) {
        const formData = new FormData();
        const ext = localBlobRef.current.type.includes("mp4") ? "mp4" : "webm";
        formData.append("audio", localBlobRef.current, `speech.${ext}`);
        if (meta?.actualDurationMs) {
          formData.append("durationMs", String(meta.actualDurationMs));
        }
        res = await fetch(`/api/sessions/${sessionId}/speech/transcribe`, {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch(`/api/sessions/${sessionId}/speech/transcribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            durationSeconds: meta?.actualDurationMs ? Math.round(meta.actualDurationMs / 1000) : 0,
          }),
        });
      }

      const data = await res.json();
      if (res.ok && data.speechResponse) {
        setSpeechResponse(data.speechResponse);
        if (meta) {
          const updatedMeta: StoredSpeechMeta = { ...meta, uploadStatus: "uploaded" };
          setMeta(updatedMeta);
          void saveSpeechMeta(updatedMeta);
        }
      } else {
        setTranscribeError(data.error || "Transcription could not be completed.");
      }
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : "Network error during transcription.");
    } finally {
      setIsTranscribing(false);
    }
  }, [meta, sessionId]);

  // Initial load
  useEffect(() => {
    let objectUrl: string | null = null;
    let isMounted = true;

    (async () => {
      try {
        const [metaResult, blob] = await Promise.all([
          loadSpeechMeta(sessionId),
          loadSpeechBlob(sessionId),
        ]);

        if (!isMounted) return;
        setMeta(metaResult);
        localBlobRef.current = blob;

        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setAudioUrl(objectUrl);
        }

        const serverResponse = await fetchSpeechResponse();

        // If no server transcript yet, but recording exists and upload was marked uploading or completed
        if (!serverResponse && blob && (metaResult?.uploadStatus === "uploading" || metaResult?.uploadStatus === "local_only")) {
          // Poll once or trigger transcription
          pollCountRef.current = 1;
          const pollTimer = setInterval(async () => {
            if (pollCountRef.current > 6) {
              clearInterval(pollTimer);
              return;
            }
            pollCountRef.current += 1;
            const polled = await fetchSpeechResponse();
            if (polled) {
              clearInterval(pollTimer);
            }
          }, 2500);
          return () => clearInterval(pollTimer);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sessionId, fetchSpeechResponse]);

  const durationSec = speechResponse?.duration_seconds != null
    ? speechResponse.duration_seconds
    : meta?.actualDurationMs != null
      ? Math.round(meta.actualDurationMs / 1000)
      : null;

  const wordCount = speechResponse?.word_count ?? 0;
  const wpm = speechResponse?.wpm != null ? Number(speechResponse.wpm) : null;
  const fillerCount = speechResponse?.filler_count ?? 0;
  const transcriptText = speechResponse?.transcript ?? "";

  const fillerData = useMemo(() => {
    return countFillerWords(transcriptText);
  }, [transcriptText]);

  const transcriptParts = useMemo(() => {
    return parseTranscriptWithHighlights(transcriptText);
  }, [transcriptText]);

  const cueModeLabel = meta?.cueMode === "generic"
    ? "Generic prompts (not research-grounded)"
    : meta?.cueMode === "research_grounded"
      ? "Research-grounded"
      : "Standard session";

  const stoppedLabel = meta?.stoppedReason ? meta.stoppedReason.replace(/_/g, " ") : "Complete";
  const serverSyncKind: StatusKind = meta?.serverSyncStatus === "synced"
    ? "synced"
    : meta?.serverSyncStatus === "failed"
      ? "failed"
      : "not_connected";

  const uploadKind: StatusKind = speechResponse
    ? "uploaded"
    : meta?.uploadStatus === "uploaded"
      ? "uploaded"
      : meta?.uploadStatus === "uploading" || isTranscribing
        ? "uploading"
        : meta?.uploadStatus === "failed"
          ? "failed"
          : meta?.uploadStatus === "local_only"
            ? "local_only"
            : "upload_not_connected";

  const copyTranscript = useCallback(() => {
    if (!transcriptText) return;
    navigator.clipboard.writeText(transcriptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [transcriptText]);

  // Pacing category
  const pacingAssessment = useMemo(() => {
    if (!wpm) return null;
    if (wpm < 120) {
      return {
        label: "Deliberate pace",
        description: "Below the typical 130–160 WPM presentation target. Gives listeners ample time to absorb complex concepts.",
        badgeClass: "bg-[#f4f6ea] text-[#5b6338] border-[#cdd3b0] dark:bg-[#1c2317] dark:text-[#adc088]",
      };
    }
    if (wpm <= 165) {
      return {
        label: "Optimal presentation pace",
        description: "Within the ideal 130–165 WPM range for academic discourse and reasoned argumentation.",
        badgeClass: "bg-[var(--badge-olive-bg)] text-[var(--olive-dark-text)] border-[var(--olive-primary)]/30",
      };
    }
    return {
      label: "Brisk pace",
      description: "Above 165 WPM. Consider adding deliberate pauses after key assertions and transitions.",
      badgeClass: "bg-[#f7ecd5] text-[#7a5a1a] border-[#c5a25f] dark:bg-[#292314] dark:text-[#dec078]",
    };
  }, [wpm]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 lg:px-10 lg:py-16">
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--border-subtle)] pb-8 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--olive-eyebrow)]">Speech report & transcription</p>
          <h1 className="display-serif mt-3 text-5xl sm:text-6xl text-[var(--ink-heading)]">Presentation analysis.</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--ink-muted)]">
            Review your audio recording, verbatim transcript from the ASR model, speech cadence metrics, and filler token breakdown.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind={speechResponse ? "completed" : isTranscribing ? "processing" : "idle"} />
          <StatusBadge kind={uploadKind} prefix="Storage" />
          <StatusBadge kind={serverSyncKind} prefix="Sync" />
        </div>
      </div>

      {loading && (
        <div className="mt-8 flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-8 text-sm text-[var(--ink-muted)]">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--olive-primary)]" />
          <span>Loading recording and speech data…</span>
        </div>
      )}

      {!loading && !meta && !speechResponse && (
        <div className="mt-8 rounded-2xl border border-dashed border-[var(--border-dashed)] p-12 text-center">
          <p className="display-serif text-3xl text-[var(--ink-heading)]">No speech data found for this session.</p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--ink-muted)]">
            Complete a 5-minute timed speaking session first. Audio is preserved locally and uploaded for analysis.
          </p>
          <Link
            href={`/dashboard/session/${sessionId}/speak?cueMode=generic`}
            className="mt-6 inline-block rounded-full bg-[var(--olive-primary)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]"
          >
            Begin speaking session ↗
          </Link>
        </div>
      )}

      {!loading && (meta || speechResponse) && (
        <>
          {/* Active transcription / processing banner */}
          {isTranscribing && (
            <div className="mt-8 flex items-center justify-between rounded-2xl border border-[var(--olive-primary)]/40 bg-[var(--badge-olive-bg)] p-5 text-sm text-[var(--olive-dark-text)]">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--olive-primary)] shrink-0" />
                <div>
                  <p className="font-semibold">Transcribing speech with ASR model…</p>
                  <p className="text-xs text-[var(--olive-text)] mt-0.5">Extracting verbatim transcript tokens, cadence, and filler word statistics.</p>
                </div>
              </div>
              <span className="hidden sm:inline-block rounded-full bg-white/70 px-3 py-1 text-xs font-medium">Please wait</span>
            </div>
          )}

          {transcribeError && (
            <div className="mt-8 flex items-start gap-3 rounded-2xl border border-[var(--error-border)] bg-[var(--error-bg)] p-5 text-sm text-[var(--error-text)]">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">ASR Processing Note</p>
                <p className="mt-1 text-xs">{transcribeError}</p>
              </div>
              <button
                type="button"
                onClick={triggerTranscription}
                className="rounded-full border border-[var(--error-border)] px-4 py-1.5 text-xs font-semibold hover:bg-white/50"
              >
                Retry ASR
              </button>
            </div>
          )}

          {/* Key Pacing Metrics Bar */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-subtle)]">Cadence</span>
                <Gauge className="h-4 w-4 text-[var(--olive-primary)]" />
              </div>
              <p className="display-serif mt-3 text-3xl font-bold tabular-nums text-[var(--ink-heading)]">
                {wpm != null ? `${wpm}` : "—"}
                <span className="text-xs font-normal text-[var(--ink-muted)] ml-1">WPM</span>
              </p>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">
                {pacingAssessment?.label ?? "Words per minute pacing"}
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-subtle)]">Duration</span>
                <Clock className="h-4 w-4 text-[var(--olive-primary)]" />
              </div>
              <p className="display-serif mt-3 text-3xl font-bold tabular-nums text-[var(--ink-heading)]">
                {durationSec != null ? formatMmSs(durationSec) : "—"}
              </p>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">
                {stoppedLabel} · 5:00 stage plan
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-subtle)]">Total Words</span>
                <MessageSquare className="h-4 w-4 text-[var(--olive-primary)]" />
              </div>
              <p className="display-serif mt-3 text-3xl font-bold tabular-nums text-[var(--ink-heading)]">
                {speechResponse ? wordCount : "—"}
              </p>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">
                Verbatim speech tokens
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-subtle)]">Filler Words</span>
                <Sparkles className="h-4 w-4 text-[var(--olive-primary)]" />
              </div>
              <p className="display-serif mt-3 text-3xl font-bold tabular-nums text-[var(--ink-heading)]">
                {speechResponse ? fillerCount : "—"}
                {durationSec && durationSec > 0 && speechResponse ? (
                  <span className="text-xs font-normal text-[var(--ink-muted)] ml-1">
                    ({(fillerCount / (durationSec / 60)).toFixed(1)}/min)
                  </span>
                ) : null}
              </p>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">
                um, uh, er, ah, like, you know
              </p>
            </div>
          </div>

          {/* Audio Playback & Metadata Section */}
          <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-4">
                <div className="flex items-center gap-2">
                  <Headphones className="h-4 w-4 text-[var(--olive-primary)]" />
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--olive-eyebrow)]">Audio playback</p>
                </div>
                <StatusBadge kind={audioUrl ? "local_only" : "unavailable"} />
              </div>

              {audioUrl ? (
                <div className="mt-5">
                  <audio controls src={audioUrl} className="w-full rounded-lg" preload="metadata" />
                </div>
              ) : (
                <p className="mt-5 text-sm text-[var(--error-text)]">
                  Audio playback is currently unavailable.
                </p>
              )}

              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--border-subtle)] pt-5 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wider text-[var(--ink-subtle)]">Cue Mode</dt>
                  <dd className="mt-1 font-medium text-[var(--ink-heading)] truncate">{cueModeLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-[var(--ink-subtle)]">Recording Size</dt>
                  <dd className="mt-1 font-medium tabular-nums text-[var(--ink-heading)]">
                    {meta?.audioBytes != null ? `${(meta.audioBytes / 1024 / 1024).toFixed(2)} MB` : "Stored"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-[var(--ink-subtle)]">Storage Bucket</dt>
                  <dd className="mt-1 font-medium text-[var(--ink-heading)]">speech-recordings</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-[var(--ink-subtle)]">Session ID</dt>
                  <dd className="mt-1 font-mono text-xs text-[var(--ink-muted)] truncate">{sessionId}</dd>
                </div>
              </dl>
            </div>

            {/* Filler word breakdown card */}
            <div className="rounded-2xl border border-[var(--banner-sage-border)] bg-[var(--banner-sage-bg)] p-6 text-[var(--banner-sage-text)]">
              <div className="flex items-center justify-between border-b border-[var(--banner-sage-border)] pb-3">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--olive-primary)]">Filler word breakdown</p>
                <span className="rounded-full bg-white/60 px-2 py-0.5 text-xs font-semibold text-[var(--olive-dark-text)]">
                  {fillerCount} total
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                {TARGET_FILLER_WORDS.map((token) => {
                  const count = fillerData.breakdown[token] || 0;
                  return (
                    <div
                      key={token}
                      className={`rounded-xl border p-2.5 text-center transition ${
                        count > 0
                          ? "border-[var(--olive-primary)]/40 bg-white/70 font-semibold text-[var(--olive-dark-text)] shadow-sm"
                          : "border-[var(--banner-sage-border)] bg-transparent text-[var(--ink-muted)]"
                      }`}
                    >
                      <p className="text-xs font-mono lowercase">{token}</p>
                      <p className="mt-1 text-lg tabular-nums font-bold">{count}</p>
                    </div>
                  );
                })}
              </div>

              {pacingAssessment && (
                <div className="mt-5 rounded-xl border border-[var(--banner-sage-border)] bg-white/50 p-3.5 text-xs leading-5">
                  <p className="font-semibold text-[var(--banner-sage-dark-text)]">{pacingAssessment.label}</p>
                  <p className="mt-0.5 text-[var(--ink-muted)]">{pacingAssessment.description}</p>
                </div>
              )}
            </div>
          </div>

          {/* Verbatim Transcript Section */}
          <div className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6 sm:p-8">
            <div className="flex flex-col gap-4 border-b border-[var(--border-subtle)] pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--olive-eyebrow)]">Verbatim speech</p>
                <h2 className="display-serif mt-1 text-2xl text-[var(--ink-heading)]">Full Transcript</h2>
              </div>

              {speechResponse?.transcript ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setHighlightFillers(!highlightFillers)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      highlightFillers
                        ? "border-[var(--olive-primary)] bg-[var(--badge-olive-bg)] text-[var(--olive-dark-text)]"
                        : "border-[var(--border)] bg-[var(--surface-inner)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {highlightFillers ? "Filler highlights ON" : "Filler highlights OFF"}
                  </button>

                  <button
                    type="button"
                    onClick={copyTranscript}
                    className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-inner)] px-3 py-1.5 text-xs font-semibold text-[var(--olive-text)] hover:bg-[var(--surface-chip)] transition"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copied ? "Copied" : "Copy transcript"}</span>
                  </button>
                </div>
              ) : null}
            </div>

            {speechResponse?.transcript ? (
              <div className="mt-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inner)] p-6 sm:p-8">
                <div className="text-base leading-relaxed text-[var(--ink)] whitespace-pre-wrap font-normal">
                  {highlightFillers ? (
                    transcriptParts.map((part, index) =>
                      part.isFiller ? (
                        <mark
                          key={index}
                          className="mx-0.5 inline-block rounded-md border border-[var(--olive-primary)]/30 bg-[var(--badge-olive-bg)] px-1.5 py-0.5 text-xs font-semibold text-[var(--olive-dark-text)]"
                          title="Filler word"
                        >
                          {part.text}
                        </mark>
                      ) : (
                        <span key={index}>{part.text}</span>
                      )
                    )
                  ) : (
                    transcriptText
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-xl border border-dashed border-[var(--border-dashed)] p-8 text-center">
                <Mic className="mx-auto h-8 w-8 text-[var(--ink-subtle)]" />
                <p className="display-serif mt-3 text-xl text-[var(--ink-heading)]">Transcript not yet generated</p>
                <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[var(--ink-muted)]">
                  The audio recording is saved. Press the button below to transcribe with the configured ASR model.
                </p>
                <button
                  type="button"
                  onClick={triggerTranscription}
                  disabled={isTranscribing}
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--olive-primary)] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)] disabled:opacity-50"
                >
                  {isTranscribing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Transcribing…</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-4 w-4" />
                      <span>Transcribe speech now ↗</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Navigation Actions */}
          <div className="mt-10 flex flex-wrap gap-4 border-t border-[var(--border-subtle)] pt-8">
            <Link
              href={`/dashboard/session/${sessionId}/research`}
              className="rounded-full border border-[var(--border)] px-6 py-3 text-sm font-semibold text-[var(--olive-text)] transition hover:bg-[var(--surface-inner)]"
            >
              ← Back to research
            </Link>
            <Link
              href={`/dashboard/session/${sessionId}/speak?cueMode=${meta?.cueMode || "generic"}`}
              className="rounded-full bg-[var(--olive-primary)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]"
            >
              Practise again ↗
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
