"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

type EvidenceItem = {
  id: string;
  title: string | null;
  fileName: string | null;
  mimeType: string | null;
  storagePath: string | null;
  previewUrl: string | null;
  textContent: string | null;
  extractionStatus: string;
  extractionError: string | null;
  extractedAt: string | null;
  metadata?: Record<string, unknown>;
};

type ResearchSessionData = {
  sessionId: string;
  topic: string;
  notes: string;
  extractedText: string | null;
  processingStatus: string;
  processingError: string | null;
  processedAt: string | null;
  evidence: EvidenceItem[];
};

type Props = { sessionId: string };

export default function ResearchSessionActions({ sessionId }: Props) {
  const [data, setData] = useState<ResearchSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const [opted, setOpted] = useState(false);

  const fetchSessionResearch = useCallback(async () => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/research`);
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        setMessage(err.error || "Failed to load saved research for this session.");
        return;
      }
      const result: ResearchSessionData = await response.json();
      setData(result);
      if (result.processingError) {
        setMessage(result.processingError);
      }
    } catch {
      setMessage("Could not load research session from server.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSessionResearch();
  }, [fetchSessionResearch]);

  async function retryProcessing() {
    setProcessing(true);
    setMessage("");
    try {
      const response = await fetch(`/api/sessions/${sessionId}/research/process`, {
        method: "POST",
      });
      const result = await response.json();
      if (response.ok && result.status === "extracted") {
        setMessage("OCR extraction completed successfully!");
      } else {
        setMessage(result.error || result.message || "Extraction could not be completed.");
      }
      // Refresh research data with newly extracted content
      await fetchSessionResearch();
    } catch {
      setMessage("Research processing could not be reached. Your original material is preserved.");
    } finally {
      setProcessing(false);
    }
  }

  const isExtracted = data?.processingStatus === "extracted" || Boolean(data?.extractedText);

  if (loading) {
    return (
      <div className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6 text-sm text-[var(--ink-muted)]">
        <p className="animate-pulse">Loading saved research materials…</p>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-8">
      {/* 1. Academic Topic & Research Notes */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6 sm:p-7">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--olive-eyebrow)]">
            Saved Academic Topic
          </p>
          <span className="rounded-full border border-[var(--badge-olive-border)] bg-[var(--badge-olive-bg)] px-3 py-1 text-xs font-semibold text-[var(--olive-primary)]">
            {data?.topic ? "Custom Topic" : "General Topic"}
          </span>
        </div>
        <h2 className="display-serif mt-2 text-2xl text-[var(--ink-heading)]">
          {data?.topic || "Untitled research question"}
        </h2>

        {data?.notes && (
          <div className="mt-6 border-t border-[var(--border-subtle)] pt-5">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-subtle)]">
              Original Research Notes
            </p>
            <div className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[var(--border-input)] bg-[var(--surface-inner)] p-4 text-sm leading-6 text-[var(--ink)]">
              {data.notes}
            </div>
          </div>
        )}
      </section>

      {/* 2. Uploaded Images & OCR Evidence */}
      {data?.evidence && data.evidence.length > 0 && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6 sm:p-7">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--olive-eyebrow)]">
                Uploaded Image Evidence ({data.evidence.length})
              </p>
              <p className="mt-1 text-xs text-[var(--ink-subtle)]">
                Original images stored securely in private storage
              </p>
            </div>
            <span className="text-xs text-[var(--ink-faint)]">
              {data.evidence.filter((e) => e.extractionStatus === "extracted").length} / {data.evidence.length} extracted
            </span>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {data.evidence.map((item) => (
              <div
                key={item.id}
                className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inner)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--ink-heading)]">
                      {item.fileName || "Image material"}
                    </p>
                    <p className="text-xs text-[var(--ink-subtle)]">
                      {item.mimeType} {item.metadata?.size ? `· ${(Number(item.metadata.size) / 1024 / 1024).toFixed(1)} MB` : ""}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      item.extractionStatus === "extracted"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : item.extractionStatus === "failed"
                        ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    }`}
                  >
                    {item.extractionStatus}
                  </span>
                </div>

                {item.previewUrl && (
                  <div className="mt-3 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-black/5 dark:bg-white/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.previewUrl}
                      alt={item.fileName || "Research material preview"}
                      className="max-h-48 w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                )}

                <div className="mt-3 text-xs leading-5 text-[var(--ink-muted)]">
                  {item.extractionStatus === "extracted" ? (
                    item.textContent ? (
                      <p className="line-clamp-3 italic text-[var(--ink)]">
                        &ldquo;{item.textContent}&rdquo;
                      </p>
                    ) : (
                      <p className="italic text-[var(--ink-subtle)]">
                        No readable text detected (charts/diagrams retain visual content only).
                      </p>
                    )
                  ) : item.extractionStatus === "failed" ? (
                    <p className="text-[var(--error-text)]">
                      Extraction error: {item.extractionError || "Failed to read image"}
                    </p>
                  ) : (
                    <p className="text-[var(--ink-subtle)]">Extraction pending</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. Unified Extracted Content with Source Attribution */}
      {data?.extractedText && (
        <section className="rounded-2xl border border-[var(--badge-olive-border)] bg-[var(--surface-card)] p-6 sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--olive-primary)]">
            Unified Extracted Research
          </p>
          <p className="mt-1 text-xs text-[var(--ink-subtle)]">
            Synthesized content with source-level attribution for grounding speech cues
          </p>
          <div className="mt-4 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inner)] p-4 text-xs leading-6 text-[var(--ink)] font-mono">
            {data.extractedText}
          </div>
        </section>
      )}

      {/* 4. Processing Status and Speaking Actions */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--olive-eyebrow)]">
              Processing Status: {data?.processingStatus || "pending"}
            </p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {isExtracted
                ? "Your research is ready and extracted. You can begin a research-grounded speaking session."
                : "OCR extraction has not yet completed or encountered an error. You can retry extraction without re-uploading images."}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={retryProcessing}
              disabled={processing}
              className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--olive-text)] hover:bg-[var(--surface-inner)] transition-colors disabled:opacity-40"
            >
              {processing ? "Extracting text…" : "Retry OCR extraction"}
            </button>
            {isExtracted && (
              <Link
                href={`/dashboard/session/${sessionId}/speak?cueMode=research_grounded`}
                className="rounded-full bg-[var(--olive-primary)] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]"
              >
                Start speaking session (research-grounded) ↗
              </Link>
            )}
          </div>
        </div>

        {message && (
          <p className="mt-4 rounded-xl border border-[var(--error-border)] bg-[var(--error-bg)] px-4 py-2 text-xs leading-5 text-[var(--error-text)]">
            {message}
          </p>
        )}
      </div>

      {/* 5. Fallback generic practice option */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 text-sm text-[var(--ink-muted)]">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--olive-eyebrow)]">
          Practise without research-grounded cues
        </p>
        <p className="mt-2 leading-6 text-[var(--ink-muted)]">
          You can also record a speaking session using generic prompts. These prompts are not derived from your research and will be clearly labelled <span className="font-semibold text-[var(--ink)]">Not research-grounded</span>.
        </p>
        <label className="mt-4 flex items-start gap-3 text-sm text-[var(--ink)]">
          <input
            type="checkbox"
            checked={opted}
            onChange={(event) => setOpted(event.target.checked)}
            className="mt-1 accent-[var(--olive-primary)]"
          />
          <span>I understand these prompts are generic scaffolding, not extracted from my research material.</span>
        </label>
        <div className="mt-4">
          {opted ? (
            <Link
              href={`/dashboard/session/${sessionId}/speak?cueMode=generic`}
              className="inline-block rounded-full bg-[var(--olive-primary)] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]"
            >
              Begin speaking session · generic prompts ↗
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="rounded-full bg-[var(--olive-primary)] px-5 py-2 text-sm font-semibold text-white opacity-40 cursor-not-allowed"
            >
              Begin speaking session · generic prompts
            </button>
          )}
        </div>
      </div>

      {/* 6. Footer Navigation */}
      <div className="flex flex-wrap gap-3">
        <Link
          href="/dashboard"
          className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--olive-text)] transition hover:bg-[var(--surface-inner)]"
        >
          Back to dashboard
        </Link>
        <Link
          href={`/dashboard/session/${sessionId}/report`}
          className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--olive-text)] transition hover:bg-[var(--surface-inner)]"
        >
          View report
        </Link>
      </div>
    </div>
  );
}
