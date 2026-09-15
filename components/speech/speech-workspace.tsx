"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { SIX_STAGES, TOTAL_DURATION_SEC, formatMmSs, stageForElapsed } from "@/lib/speech/stages";
import { deleteSpeech, loadSpeechBlob, loadSpeechMeta, saveSpeechBlob, saveSpeechMeta, type StoredSpeechMeta } from "@/lib/speech/audio-store";
import { StatusBadge, type StatusKind } from "@/components/ui/status-badge";

type Props = { sessionId: string; cueMode: "research_grounded" | "generic" };

// Six-stage plan rail. Completed / current / upcoming are distinguished by
// marker glyph + explicit text ("Done" / "Now"), never colour alone.
function StageRail({ activeIndex, live }: { activeIndex: number; live: boolean }) {
  return (
    <ol className="mt-5 grid gap-1.5 sm:grid-cols-2">
      {SIX_STAGES.map((stage, index) => {
        const state = !live || activeIndex < 0
          ? "upcoming"
          : index < activeIndex
            ? "completed"
            : index === activeIndex
              ? "current"
              : "upcoming";
        const rowCls = state === "current"
          ? "border-[var(--olive-primary)] bg-[var(--badge-olive-bg)] font-semibold text-[var(--olive-dark-text)]"
          : state === "completed"
            ? "border-[#cdd3b0] bg-[#f4f6ea] text-[#5b6338] dark:border-[#38452b] dark:bg-[#1c2317] dark:text-[#adc088]"
            : "border-[var(--border-subtle)] bg-[var(--surface-inner)] text-[var(--ink-muted)]";
        const markerCls = state === "current"
          ? "border-[var(--olive-primary)] bg-[var(--olive-primary)] text-white"
          : state === "completed"
            ? "border-[#8fa04f] bg-[#e6ecc9] text-[#4f5b1f] dark:border-[#526639] dark:bg-[#2f3d23] dark:text-[#c4d79e]"
            : "border-[var(--border)] bg-[var(--surface-inner)] text-[var(--ink-faint)]";
        return (
          <li key={stage.key} aria-current={state === "current" ? "step" : undefined} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${rowCls}`}>
            <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${markerCls}`}>
              {state === "completed" ? <Check className="h-3 w-3" /> : state === "current" ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : index + 1}
            </span>
            <span className="flex-1 truncate">{stage.label}</span>
            {state === "current"
              ? <span className="rounded-full bg-[var(--olive-primary)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Now</span>
              : state === "completed"
                ? <span className="text-[10px] font-semibold uppercase tracking-wide text-[#5b6338] dark:text-[#adc088]">Done</span>
                : <span className="tabular-nums text-[10px] text-[var(--ink-faint)]">{formatMmSs(stage.durationSec)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  if (typeof MediaRecorder === "undefined") return "";
  for (const type of candidates) {
    try { if (MediaRecorder.isTypeSupported(type)) return type; } catch { /* ignore */ }
  }
  return "";
}

export default function SpeechWorkspace({ sessionId, cueMode }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "requesting" | "recording" | "stopping" | "completed" | "interrupted" | "unsupported" | "denied">("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [message, setMessage] = useState("");
  const [meta, setMeta] = useState<StoredSpeechMeta | null>(null);
  const [serverSync, setServerSync] = useState<"not_connected" | "synced" | "failed">("not_connected");
  const [browserSupported, setBrowserSupported] = useState(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const idempotencyKeyRef = useRef<string>("");

  const cueModeLabel = cueMode === "generic" ? "Generic prompts · Not research-grounded" : "Research-grounded cues";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported = typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
    setBrowserSupported(supported);
    if (!supported) setPhase("unsupported");
    loadSpeechMeta(sessionId).then((existing) => {
      if (existing) {
        setMeta(existing);
        idempotencyKeyRef.current = existing.idempotencyKey;
        setServerSync(existing.serverSyncStatus);
        if (existing.endedAtEpochMs && existing.actualDurationMs != null) {
          setPhase("completed");
          setElapsedSec(Math.min(TOTAL_DURATION_SEC, Math.round(existing.actualDurationMs / 1000)));
        } else if (existing.startedAtEpochMs) {
          setPhase("interrupted");
          setMessage("A previous recording was interrupted. Live audio cannot be recovered after a crash, but your research remains safe.");
        }
      } else {
        idempotencyKeyRef.current = crypto.randomUUID();
      }
    }).catch(() => { idempotencyKeyRef.current = crypto.randomUUID(); });
  }, [sessionId]);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const finalize = useCallback(async (stoppedReason: "early_stop" | "auto_stop" | "interrupted") => {
    stopTimer();
    const endedAt = Date.now();
    const actualDurationMs = Math.max(0, endedAt - startedAtRef.current);
    const blob = chunksRef.current.length > 0 ? new Blob(chunksRef.current, { type: mediaRecorderRef.current?.mimeType || "audio/webm" }) : null;
    if (blob && blob.size > 0) {
      try { await saveSpeechBlob(sessionId, blob); } catch { /* best-effort */ }
    }
    const nextMeta: StoredSpeechMeta = {
      sessionId,
      idempotencyKey: idempotencyKeyRef.current,
      cueMode,
      startedAtEpochMs: startedAtRef.current,
      endedAtEpochMs: endedAt,
      actualDurationMs,
      stoppedReason,
      audioMime: blob?.type ?? null,
      audioBytes: blob?.size ?? null,
      uploadStatus: "upload_not_connected",
      serverSyncStatus: serverSync,
    };
    try { await saveSpeechMeta(nextMeta); } catch { /* best-effort */ }
    setMeta(nextMeta);

    try {
      const response = await fetch(`/api/sessions/${sessionId}/speech/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: idempotencyKeyRef.current, actualDurationMs, stoppedReason, cueMode })
      });
      if (response.ok) setServerSync("synced"); else setServerSync("not_connected");
    } catch { setServerSync("not_connected"); }

    if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach((track) => track.stop()); mediaStreamRef.current = null; }
    setPhase("completed");
  }, [cueMode, sessionId, serverSync, stopTimer]);

  const tick = useCallback(() => {
    const nextElapsed = Math.min(TOTAL_DURATION_SEC, Math.floor((Date.now() - startedAtRef.current) / 1000));
    setElapsedSec(nextElapsed);
    if (nextElapsed >= TOTAL_DURATION_SEC) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        setPhase("stopping");
        try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
      }
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!browserSupported) { setPhase("unsupported"); return; }
    setMessage("");
    setPhase("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      setPhase("denied");
      setMessage(error instanceof Error && error.name === "NotAllowedError" ? "Microphone permission was declined. Enable it in your browser to record." : "The microphone is unavailable. Try again after checking device settings.");
      return;
    }
    mediaStreamRef.current = stream;
    const mimeType = pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (event) => { if (event.data && event.data.size > 0) chunksRef.current.push(event.data); };
    recorder.onstop = () => { void finalize(elapsedSec >= TOTAL_DURATION_SEC - 1 ? "auto_stop" : "early_stop"); };
    startedAtRef.current = Date.now();
    idempotencyKeyRef.current = idempotencyKeyRef.current || crypto.randomUUID();
    const startingMeta: StoredSpeechMeta = {
      sessionId,
      idempotencyKey: idempotencyKeyRef.current,
      cueMode,
      startedAtEpochMs: startedAtRef.current,
      endedAtEpochMs: null,
      actualDurationMs: null,
      stoppedReason: null,
      audioMime: recorder.mimeType || null,
      audioBytes: null,
      uploadStatus: "local_only",
      serverSyncStatus: "not_connected",
    };
    try { await saveSpeechMeta(startingMeta); } catch { /* best-effort */ }
    setMeta(startingMeta);

    try {
      const response = await fetch(`/api/sessions/${sessionId}/speech/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: idempotencyKeyRef.current, cueMode })
      });
      if (response.ok) setServerSync("synced"); else setServerSync("not_connected");
    } catch { setServerSync("not_connected"); }

    try { recorder.start(1000); } catch (error) { setPhase("denied"); setMessage("Recording could not start. Try a supported browser (Chrome, Edge, or Firefox)."); return; }
    setPhase("recording");
    setElapsedSec(0);
    timerRef.current = window.setInterval(tick, 500);
  }, [browserSupported, cueMode, elapsedSec, finalize, sessionId, tick]);

  const stopEarly = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      setPhase("stopping");
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => () => { stopTimer(); if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach((track) => track.stop()); } }, [stopTimer]);

  const activeStage = useMemo(() => stageForElapsed(elapsedSec), [elapsedSec]);
  const remainingSec = Math.max(0, TOTAL_DURATION_SEC - elapsedSec);
  const isLive = phase === "recording" || phase === "stopping";
  const sessionBadgeKind: StatusKind = isLive
    ? "recording"
    : phase === "completed"
      ? "completed"
      : phase === "interrupted"
        ? "interrupted"
        : phase === "denied" || phase === "unsupported"
          ? "unavailable"
          : "idle";
  const uploadBadgeKind: StatusKind = meta?.uploadStatus === "local_only" ? "local_only" : "upload_not_connected";
  const prepHeading = phase === "completed" ? "Session complete." : phase === "interrupted" ? "Session interrupted." : "Ready when you are.";
  const prepBody = phase === "completed"
    ? "Your five minutes are done. Open the report to review your local recording."
    : phase === "interrupted"
      ? "A previous recording did not finish cleanly. Discard it to start fresh — cues stay hidden until you begin again."
      : "Your first cue appears here the moment you press start. Nothing is shown or recorded before then.";

  const acknowledgeInterruption = useCallback(async () => {
    await deleteSpeech(sessionId).catch(() => { /* best-effort */ });
    setMeta(null); setPhase("idle"); setElapsedSec(0); setMessage(""); idempotencyKeyRef.current = crypto.randomUUID();
  }, [sessionId]);

  return <section className="grid gap-8 lg:grid-cols-[1fr_0.4fr]">
    <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--surface-card)] p-6 sm:p-9">
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--border-subtle)] pb-6 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--olive-eyebrow)]">Speaking session</p>
          <h1 className="display-serif mt-3 text-5xl text-[var(--ink-heading)]">Five minutes, six stages.</h1>
        </div>
        <div className="text-right">
          <p className="text-4xl font-semibold tabular-nums text-[var(--ink-heading)]">{formatMmSs(remainingSec)}</p>
          <p className="text-xs text-[var(--ink-subtle)]">remaining</p>
        </div>
      </div>

      {cueMode === "generic" && (
        <p className="mt-6 rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3 text-sm font-semibold text-[var(--warning-text)]" role="note">
          Not research-grounded · These prompts are generic scaffolding, not derived from your research.
        </p>
      )}

      {isLive ? (
        <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-inner)] p-6">
          <div className="flex flex-col gap-2 border-b border-[var(--border-subtle)] pb-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#b23b3b]" />
              <StatusBadge kind="recording" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--olive-eyebrow)]">
              Stage {activeStage.index + 1} / 6 · {formatMmSs(elapsedSec - activeStage.stageStartSec)} / {formatMmSs(activeStage.stage.durationSec)}
            </span>
          </div>
          <p className="display-serif mt-4 text-3xl leading-tight text-[var(--ink-heading)]">{activeStage.stage.label}</p>
          <p className="mt-3 text-sm leading-6 text-[var(--ink)]">{activeStage.stage.genericPrompt}</p>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--surface-chip)]">
            <div className="h-full rounded-full bg-[var(--olive-primary)] transition-all" style={{ width: `${Math.min(100, (elapsedSec / TOTAL_DURATION_SEC) * 100)}%` }} />
          </div>
          <StageRail activeIndex={activeStage.index} live />
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-[var(--border-dashed)] bg-[var(--surface-inner)] p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--olive-eyebrow)]">Preparation</p>
          <p className="display-serif mt-3 text-3xl leading-tight text-[var(--ink-heading)]">{prepHeading}</p>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{prepBody}</p>
          <StageRail activeIndex={-1} live={false} />
        </div>
      )}

      {message && <p role="status" className="mt-6 rounded-xl border border-[var(--error-border)] bg-[var(--error-bg)] px-4 py-3 text-sm leading-6 text-[var(--error-text)]">{message}</p>}

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          <StatusBadge kind={sessionBadgeKind} />
          <StatusBadge kind={uploadBadgeKind} prefix="Upload" />
          <StatusBadge kind={serverSync} prefix="Server sync" />
        </div>
        <div className="flex gap-3">
          {phase === "idle" && <button type="button" onClick={startRecording} className="rounded-full bg-[var(--olive-primary)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]">Start speaking · 5:00</button>}
          {phase === "requesting" && <button type="button" disabled className="rounded-full bg-[var(--olive-primary)] px-6 py-3 text-sm font-semibold text-white opacity-60">Requesting microphone…</button>}
          {(phase === "recording" || phase === "stopping") && <button type="button" onClick={stopEarly} disabled={phase === "stopping"} className="rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--olive-text)] hover:bg-[var(--surface-inner)] disabled:opacity-40">Stop early</button>}
          {phase === "completed" && <Link href={`/dashboard/session/${sessionId}/report`} className="rounded-full bg-[var(--olive-primary)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]">View report ↗</Link>}
          {phase === "denied" && <button type="button" onClick={startRecording} className="rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--olive-text)] hover:bg-[var(--surface-inner)]">Try microphone again</button>}
          {phase === "interrupted" && <button type="button" onClick={acknowledgeInterruption} className="rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--olive-text)] hover:bg-[var(--surface-inner)]">Discard and start fresh</button>}
          {phase === "unsupported" && <p className="text-sm text-[var(--error-text)]">Your browser does not support MediaRecorder. Try Chrome, Edge, or Firefox on desktop.</p>}
        </div>
      </div>
    </div>

    <aside className="h-fit rounded-[2rem] border border-[var(--banner-sage-border)] bg-[var(--banner-sage-bg)] p-7 text-[var(--banner-sage-text)] sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--olive-primary)]">Session mode</p>
      <h2 className="display-serif mt-4 text-2xl leading-tight text-[var(--ink-heading)]">{cueModeLabel}</h2>
      <p className="mt-4 text-sm leading-6">Microphone permission is only requested after you press start. Audio stays in this browser: server upload is not connected in this environment, so nothing leaves your device.</p>
      <div className="mt-6 border-t border-[var(--banner-sage-border)] pt-5 text-sm leading-6">
        <p className="font-semibold text-[var(--banner-sage-dark-text)]">Local recovery</p>
        <p className="mt-1">Your recording is saved to this browser as it finishes. If the tab crashes mid-recording, live audio cannot be recovered but your research remains safe.</p>
      </div>
      <ol className="mt-6 space-y-1 text-xs text-[var(--olive-text)]">{SIX_STAGES.map((stage, index) => <li key={stage.key} className="flex justify-between"><span>{index + 1}. {stage.label}</span><span className="tabular-nums">{formatMmSs(stage.durationSec)}</span></li>)}</ol>
      {meta && <p className="mt-6 text-xs text-[var(--ink-muted)]">Idempotency key active for retries: <code className="break-all">{meta.idempotencyKey.slice(0, 8)}…</code></p>}
    </aside>
  </section>;
}
