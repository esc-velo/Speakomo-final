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

type CuePoint = {
  stageKey: string;
  phrase: string;
  evidenceIds: string[];
};

type CueSet = {
  cues: CuePoint[];
  model: string;
  promptVersion: string;
  inputHash: string;
  generatedAt: string;
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
  cueStatus?: string;
  cueError?: string | null;
  cueSet?: CueSet | null;
  effectiveCues?: CuePoint[] | null;
  editedCues?: Record<string, string>;
  hasEdits?: boolean;
};

const STAGE_META: Record<string, { label: string; duration: string }> = {
  hook: { label: "Frame the question", duration: "0:30" },
  context: { label: "Set the context", duration: "0:45" },
  concept1: { label: "Explain a key idea", duration: "1:00" },
  concept2: { label: "Add depth", duration: "1:00" },
  evidence: { label: "Bring in evidence", duration: "1:00" },
  close: { label: "Close with implication", duration: "0:45" },
};

const STAGE_ORDER = ["hook", "context", "concept1", "concept2", "evidence", "close"];

type Props = { sessionId: string };

export default function ResearchSessionActions({ sessionId }: Props) {
  const [data, setData] = useState<ResearchSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [opted, setOpted] = useState(false);

  // Cue inline editing state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editPhrase, setEditPhrase] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

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
      await fetchSessionResearch();
    } catch {
      setMessage("Research processing could not be reached. Your original material is preserved.");
    } finally {
      setProcessing(false);
    }
  }

  async function handleGenerateCues(force = false, resetEdits = false) {
    setGenerating(true);
    setShowRegenerateConfirm(false);
    setMessage("");
    try {
      const response = await fetch(`/api/sessions/${sessionId}/research/cues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force, resetEdits }),
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setMessage(
          force
            ? resetEdits
              ? "Cues regenerated with custom edits reset!"
              : "Cues regenerated (custom edits preserved)!"
            : "Cues generated successfully!"
        );
      } else {
        setMessage(result.error || "Cue generation failed.");
      }
      await fetchSessionResearch();
    } catch {
      setMessage("Could not reach the cue generation service.");
    } finally {
      setGenerating(false);
    }
  }

  function startEditing(stageKey: string, cueIndex: number, currentPhrase: string) {
    setEditingKey(`${stageKey}_${cueIndex}`);
    setEditPhrase(currentPhrase);
    setEditError(null);
  }

  function cancelEditing() {
    setEditingKey(null);
    setEditPhrase("");
    setEditError(null);
  }

  async function handleSaveEdit(stageKey: string, cueIndex: number) {
    const trimmed = editPhrase.trim();
    const wordCount = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
    if (wordCount < 2 || wordCount > 25) {
      setEditError(`Cue phrase must be 2 to 25 words (currently ${wordCount} words).`);
      return;
    }

    setSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/research/cues`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stageKey,
          cueIndex,
          phrase: trimmed,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.success) {
        setEditError(result.error || "Failed to save edited cue phrase.");
        return;
      }

      setData((prev) => {
        if (!prev) return prev;
        const newEditedCues = { ...(prev.editedCues || {}), [`${stageKey}_${cueIndex}`]: trimmed };
        return {
          ...prev,
          effectiveCues: result.effectiveCues || prev.effectiveCues,
          editedCues: newEditedCues,
          hasEdits: true,
        };
      });
      setEditingKey(null);
      setMessage("Cue phrase updated successfully.");
    } catch {
      setEditError("Could not reach server to save cue edit.");
    } finally {
      setSavingEdit(false);
    }
  }

  const isExtracted = data?.processingStatus === "extracted" || Boolean(data?.extractedText);
  const cueStatus = data?.cueStatus || "pending";
  const activeCues = data?.effectiveCues || data?.cueSet?.cues;
  const hasCues = cueStatus === "generated" && activeCues?.length === 12;

  // Group cues by stage for display
  const cuesByStage: Record<string, CuePoint[]> = {};
  if (hasCues && activeCues) {
    for (const cue of activeCues) {
      if (!cuesByStage[cue.stageKey]) cuesByStage[cue.stageKey] = [];
      cuesByStage[cue.stageKey].push(cue);
    }
  }

  // Build evidence label map for displaying source references
  const evidenceLabelMap: Record<string, string> = {};
  if (data?.evidence) {
    for (const e of data.evidence) {
      evidenceLabelMap[e.id] = e.fileName || e.title || "Evidence";
    }
  }
  // Research notes source ID
  if (data?.notes) {
    // Match the pattern used in cue-generator.ts
    const notesPattern = /^research-notes-/;
    if (activeCues) {
      for (const cue of activeCues) {
        for (const eid of cue.evidenceIds) {
          if (notesPattern.test(eid) && !evidenceLabelMap[eid]) {
            evidenceLabelMap[eid] = "Research Notes";
          }
        }
      }
    }
  }

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

      {/* 4. Processing Status — OCR Extraction */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--olive-eyebrow)]">
              Research Extraction: {data?.processingStatus || "pending"}
            </p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {isExtracted
                ? "Your research is ready and extracted."
                : "OCR extraction has not yet completed or encountered an error. You can retry extraction without re-uploading images."}
            </p>
          </div>
          <button
            type="button"
            onClick={retryProcessing}
            disabled={processing}
            className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--olive-text)] hover:bg-[var(--surface-inner)] transition-colors disabled:opacity-40 shrink-0"
          >
            {processing ? "Extracting text…" : "Retry OCR extraction"}
          </button>
        </div>
      </div>

      {/* 5. Cue Generation Status & Controls */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--olive-eyebrow)]">
              Cue Generation: {cueStatus}
            </p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {cueStatus === "generated"
                ? "Speaking cues are ready. You can start a research-grounded session."
                : cueStatus === "generating"
                  ? "Cue generation is in progress…"
                  : cueStatus === "failed"
                    ? `Cue generation failed. ${data?.cueError || "Try again."}`
                    : cueStatus === "stale"
                      ? "Your research has changed. Regenerate cues to update."
                      : isExtracted
                        ? "Research is extracted. Generate speaking cues to continue."
                        : "Complete OCR extraction first, then generate cues."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            {isExtracted && cueStatus !== "generating" && cueStatus !== "generated" && (
              <button
                type="button"
                onClick={() => handleGenerateCues(false)}
                disabled={generating}
                className="rounded-full bg-[var(--olive-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)] disabled:opacity-40"
              >
                {generating ? "Generating…" : "Generate cues"}
              </button>
            )}
            {cueStatus === "failed" && (
              <button
                type="button"
                onClick={() => handleGenerateCues(true)}
                disabled={generating}
                className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--olive-text)] hover:bg-[var(--surface-inner)] disabled:opacity-40"
              >
                {generating ? "Retrying…" : "Retry cue generation"}
              </button>
            )}
            {(cueStatus === "generated" || cueStatus === "stale") && (
              <div className="relative inline-block">
                {data?.hasEdits && showRegenerateConfirm ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-inner)] p-2">
                    <span className="text-xs text-[var(--ink-muted)] px-1">Preserve custom edits?</span>
                    <button
                      type="button"
                      onClick={() => handleGenerateCues(true, false)}
                      disabled={generating}
                      className="rounded-full bg-[var(--olive-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--olive-primary-hover)] disabled:opacity-40"
                    >
                      Keep Edits
                    </button>
                    <button
                      type="button"
                      onClick={() => handleGenerateCues(true, true)}
                      disabled={generating}
                      className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-chip)] disabled:opacity-40"
                    >
                      Reset All
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRegenerateConfirm(false)}
                      className="text-xs text-[var(--ink-subtle)] hover:underline px-1"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (data?.hasEdits) {
                        setShowRegenerateConfirm(true);
                      } else {
                        handleGenerateCues(true, false);
                      }
                    }}
                    disabled={generating}
                    className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--olive-text)] hover:bg-[var(--surface-inner)] disabled:opacity-40"
                  >
                    {generating ? "Regenerating…" : "Regenerate cues"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 6. Generated Cues Display — All 6 Stages with 2 Cues Each */}
      {hasCues && (
        <section className="rounded-2xl border border-[var(--badge-olive-border)] bg-[var(--surface-card)] p-6 sm:p-7">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--olive-primary)]">
                Research-Grounded Speaking Cues
              </p>
              <p className="mt-1 text-xs text-[var(--ink-subtle)]">
                12 cue phrases · 2 per stage · grounded in your research material · click Edit to personalize
              </p>
            </div>
            {data?.cueSet && (
              <span className="text-[10px] text-[var(--ink-faint)]">
                Model: {data.cueSet.model} · {data.cueSet.promptVersion}
              </span>
            )}
          </div>

          <div className="mt-6 space-y-4">
            {STAGE_ORDER.map((stageKey, idx) => {
              const stageCues = cuesByStage[stageKey] || [];
              const meta = STAGE_META[stageKey];
              return (
                <div
                  key={stageKey}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inner)] p-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--olive-eyebrow)]">
                      Stage {idx + 1}: {meta?.label || stageKey}
                    </p>
                    <span className="tabular-nums text-[10px] text-[var(--ink-faint)]">
                      {meta?.duration}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {stageCues.map((cue, ci) => {
                      const cueKey = `${stageKey}_${ci}`;
                      const isEditing = editingKey === cueKey;
                      const isCustomized = Boolean(data?.editedCues?.[cueKey]);
                      const wordCount = editPhrase.trim() ? editPhrase.trim().split(/\s+/).filter(Boolean).length : 0;
                      const wordCountValid = wordCount >= 2 && wordCount <= 25;

                      return (
                        <div
                          key={ci}
                          className="rounded-lg border border-[var(--badge-olive-border)] bg-[var(--badge-olive-bg)] p-3.5 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--olive-eyebrow)]">
                                Cue {ci + 1}
                              </span>
                              {isCustomized && (
                                <span className="rounded-full bg-[var(--olive-primary)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--olive-primary)]">
                                  Customized
                                </span>
                              )}
                            </div>
                            {!isEditing && (
                              <button
                                type="button"
                                onClick={() => startEditing(stageKey, ci, cue.phrase)}
                                className="text-xs font-semibold text-[var(--olive-text)] hover:text-[var(--olive-primary)] hover:underline"
                                aria-label={`Edit cue ${ci + 1} for ${meta?.label || stageKey}`}
                              >
                                Edit
                              </button>
                            )}
                          </div>

                          {isEditing ? (
                            <div className="mt-2 space-y-2">
                              <textarea
                                value={editPhrase}
                                onChange={(e) => setEditPhrase(e.target.value)}
                                disabled={savingEdit}
                                rows={2}
                                className="w-full rounded-md border border-[var(--border-input)] bg-[var(--surface-inner)] p-2 text-sm text-[var(--ink)] focus:border-[var(--olive-primary)] focus:outline-none"
                                placeholder="Enter cue phrase (2-25 words)..."
                              />
                              <div className="flex items-center justify-between text-xs">
                                <span className={wordCountValid ? "text-[var(--ink-subtle)]" : "text-[var(--error-text)] font-semibold"}>
                                  {wordCount} / 25 words (min 2)
                                </span>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={cancelEditing}
                                    disabled={savingEdit}
                                    className="rounded px-2.5 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--surface-chip)]"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEdit(stageKey, ci)}
                                    disabled={savingEdit || !wordCountValid}
                                    className="rounded bg-[var(--olive-primary)] px-3 py-1 text-xs font-semibold text-white hover:bg-[var(--olive-primary-hover)] disabled:opacity-40"
                                  >
                                    {savingEdit ? "Saving…" : "Save"}
                                  </button>
                                </div>
                              </div>
                              {editError && (
                                <p className="text-xs text-[var(--error-text)] font-medium mt-1">{editError}</p>
                              )}
                            </div>
                          ) : (
                            <>
                              <p className="mt-1 text-sm font-semibold text-[var(--olive-dark-text)] leading-snug">
                                {cue.phrase}
                              </p>
                              <p className="mt-2 text-[10px] text-[var(--olive-text)]">
                                Sources: {cue.evidenceIds.length > 0
                                  ? cue.evidenceIds.map((eid) => evidenceLabelMap[eid] || eid.slice(0, 8)).join(", ")
                                  : "Research material"}
                              </p>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 7. Speaking Actions */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--olive-eyebrow)]">
              Start Speaking Session
            </p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {hasCues
                ? "Ready for a 5-minute speaking session based on your research?"
                : "Generate cues first, or use generic prompts below."}
            </p>
          </div>
          {hasCues && (
            <Link
              href={`/dashboard/session/${sessionId}/speak?cueMode=research_grounded`}
              className="rounded-full bg-[var(--olive-primary)] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)] shrink-0"
            >
              Start speaking session ↗
            </Link>
          )}
        </div>

        {message && (
          <p className="mt-4 rounded-xl border border-[var(--error-border)] bg-[var(--error-bg)] px-4 py-2 text-xs leading-5 text-[var(--error-text)]">
            {message}
          </p>
        )}
      </div>

      {/* 9. Footer Navigation */}
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
