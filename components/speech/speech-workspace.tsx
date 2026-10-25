"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Loader2, Upload } from "lucide-react";
import { SIX_STAGES, TOTAL_DURATION_SEC, formatMmSs, stageForElapsed } from "@/lib/speech/stages";
import { deleteSpeech, loadSpeechBlob, loadSpeechMeta, saveSpeechBlob, saveSpeechMeta, type StoredSpeechMeta } from "@/lib/speech/audio-store";
import { StatusBadge, type StatusKind } from "@/components/ui/status-badge";

type Props = { sessionId: string; cueMode: "research_grounded" | "generic" };

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MiB
const ACCEPTED_AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".webm", ".ogg"];
const ACCEPTED_AUDIO_TYPES = [
  "audio/mp3",
  "audio/mpeg",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
];
const AUDIO_ACCEPT_ATTR = "audio/mpeg,audio/mp3,audio/wav,audio/wave,audio/x-wav,audio/m4a,audio/x-m4a,audio/mp4,audio/webm,audio/ogg,.mp3,.wav,.m4a,.webm,.ogg";

function probeAudioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const audio = new Audio();
      audio.preload = "metadata";
      audio.src = url;
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        const dur = audio.duration;
        resolve(Number.isFinite(dur) && dur > 0 ? Math.round(dur * 1000) : null);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

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

  // File upload state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [replaceConfirmFile, setReplaceConfirmFile] = useState<File | null>(null);

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
      uploadStatus: blob && blob.size > 0 ? "uploading" : "local_only",
      serverSyncStatus: serverSync,
    };
    try { await saveSpeechMeta(nextMeta); } catch { /* best-effort */ }
    setMeta(nextMeta);

    try {
      const response = await fetch(`/api/sessions/${sessionId}/speech/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKeyRef.current,
          actualDurationMs,
          stoppedReason,
          cueMode,
          uploadStatus: blob && blob.size > 0 ? "uploading" : "local_only",
        })
      });
      if (response.ok) setServerSync("synced"); else setServerSync("not_connected");
    } catch { setServerSync("not_connected"); }

    if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach((track) => track.stop()); mediaStreamRef.current = null; }
    setPhase("completed");

    // Initiate upload & transcription in the background
    if (blob && blob.size > 0) {
      (async () => {
        try {
          const formData = new FormData();
          const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
          formData.append("audio", blob, `speech.${ext}`);
          formData.append("durationMs", String(actualDurationMs));

          const transcribeResponse = await fetch(`/api/sessions/${sessionId}/speech/transcribe`, {
            method: "POST",
            body: formData,
          });

          if (transcribeResponse.ok) {
            const updatedMeta: StoredSpeechMeta = {
              ...nextMeta,
              uploadStatus: "uploaded",
              serverSyncStatus: "synced",
            };
            setMeta(updatedMeta);
            await saveSpeechMeta(updatedMeta).catch(() => {});
          } else {
            const updatedMeta: StoredSpeechMeta = {
              ...nextMeta,
              uploadStatus: "failed",
            };
            setMeta(updatedMeta);
            await saveSpeechMeta(updatedMeta).catch(() => {});
          }
        } catch {
          const updatedMeta: StoredSpeechMeta = {
            ...nextMeta,
            uploadStatus: "failed",
          };
          setMeta(updatedMeta);
          await saveSpeechMeta(updatedMeta).catch(() => {});
        }
      })();
    }
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
    setUploadError(null);
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

    try { recorder.start(1000); } catch { setPhase("denied"); setMessage("Recording could not start. Try a supported browser (Chrome, Edge, or Firefox)."); return; }
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

  // Process and upload a pre-recorded audio file
  const processAudioFile = useCallback(async (file: File) => {
    setIsUploading(true);
    setUploadError(null);
    setSelectedFile(file);
    setUploadProgress(`Reading ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)…`);

    try {
      // 1. Probe audio duration
      const durationMs = await probeAudioDuration(file);
      if (durationMs) {
        setElapsedSec(Math.min(TOTAL_DURATION_SEC, Math.round(durationMs / 1000)));
      }

      // 2. Persist File in IndexedDB
      try {
        await saveSpeechBlob(sessionId, file);
      } catch {
        /* best-effort */
      }

      // 3. Persist metadata in IndexedDB
      const newKey = idempotencyKeyRef.current || crypto.randomUUID();
      idempotencyKeyRef.current = newKey;

      const fileMeta: StoredSpeechMeta = {
        sessionId,
        idempotencyKey: newKey,
        cueMode,
        startedAtEpochMs: Date.now(),
        endedAtEpochMs: Date.now(),
        actualDurationMs: durationMs,
        stoppedReason: "early_stop",
        audioMime: file.type || "audio/webm",
        audioBytes: file.size,
        uploadStatus: "uploading",
        serverSyncStatus: "not_connected",
      };
      try {
        await saveSpeechMeta(fileMeta);
      } catch {
        /* best-effort */
      }
      setMeta(fileMeta);

      // 4. Complete session tracking on server
      setUploadProgress("Syncing session on server…");
      try {
        await fetch(`/api/sessions/${sessionId}/speech/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idempotencyKey: newKey, cueMode }),
        });
        const compRes = await fetch(`/api/sessions/${sessionId}/speech/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: newKey,
            actualDurationMs: durationMs,
            stoppedReason: "early_stop",
            cueMode,
            uploadStatus: "uploading",
          }),
        });
        if (compRes.ok) setServerSync("synced");
      } catch {
        setServerSync("not_connected");
      }

      // 5. Upload & Transcribe
      setUploadProgress("Uploading and transcribing with ASR model…");
      const formData = new FormData();
      formData.append("audio", file, file.name);
      if (durationMs) {
        formData.append("durationMs", String(durationMs));
      }

      const transcribeRes = await fetch(`/api/sessions/${sessionId}/speech/transcribe`, {
        method: "POST",
        body: formData,
      });

      const data = await transcribeRes.json().catch(() => ({}));
      if (!transcribeRes.ok) {
        const errMsg = data.error || "Failed to upload or transcribe file.";
        setUploadError(errMsg);
        const failedMeta: StoredSpeechMeta = { ...fileMeta, uploadStatus: "failed" };
        setMeta(failedMeta);
        await saveSpeechMeta(failedMeta).catch(() => {});
        setIsUploading(false);
        return;
      }

      // 6. Finalize successfully
      const finalDurationMs = data.metrics?.durationSeconds
        ? Math.round(data.metrics.durationSeconds * 1000)
        : durationMs;

      const completedMeta: StoredSpeechMeta = {
        ...fileMeta,
        uploadStatus: "uploaded",
        serverSyncStatus: "synced",
        actualDurationMs: finalDurationMs,
      };
      setMeta(completedMeta);
      await saveSpeechMeta(completedMeta).catch(() => {});

      if (finalDurationMs) {
        setElapsedSec(Math.min(TOTAL_DURATION_SEC, Math.round(finalDurationMs / 1000)));
      }

      setPhase("completed");
      setUploadProgress("");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "An error occurred during file upload.";
      setUploadError(errMsg);
    } finally {
      setIsUploading(false);
    }
  }, [cueMode, sessionId]);

  // Handle file input selection with size/type validation & replacement confirmation
  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    setUploadError(null);

    // Validate extension / MIME type
    const lowerName = file.name.toLowerCase();
    const hasValidExt = ACCEPTED_AUDIO_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    const hasValidType = ACCEPTED_AUDIO_TYPES.some((type) => file.type.toLowerCase().startsWith(type));

    if (!hasValidExt && !hasValidType) {
      setUploadError("Unsupported audio format. Please choose an MP3, WAV, M4A, WebM, or OGG file.");
      return;
    }

    // Validate size (25 MiB)
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError(`File is ${(file.size / 1024 / 1024).toFixed(1)} MiB, which exceeds the 25 MiB maximum limit.`);
      return;
    }

    // If an existing recording already exists, prompt for explicit confirmation before replacing
    if (phase === "completed" || (meta?.endedAtEpochMs && meta.actualDurationMs)) {
      setReplaceConfirmFile(file);
      return;
    }

    void processAudioFile(file);
  }, [meta, phase, processAudioFile]);

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
  const uploadBadgeKind: StatusKind = isUploading
    ? "uploading"
    : meta?.uploadStatus === "uploaded"
      ? "uploaded"
      : meta?.uploadStatus === "uploading"
        ? "uploading"
        : meta?.uploadStatus === "failed"
          ? "failed"
          : meta?.uploadStatus === "local_only"
            ? "local_only"
            : "upload_not_connected";

  const prepHeading = phase === "completed" ? "Session complete." : phase === "interrupted" ? "Session interrupted." : "Ready when you are.";
  const prepBody = phase === "completed"
    ? "Your presentation audio is saved. Open the report to review playback, verbatim transcript, and pacing metrics."
    : phase === "interrupted"
      ? "A previous recording did not finish cleanly. Discard it to start fresh — cues stay hidden until you begin again."
      : "Start a 5-minute timed live session with structured stage cues, or upload an existing pre-recorded audio file (MP3, WAV, M4A, WebM, or OGG up to 25 MiB).";

  const acknowledgeInterruption = useCallback(async () => {
    await deleteSpeech(sessionId).catch(() => { /* best-effort */ });
    setMeta(null); setPhase("idle"); setElapsedSec(0); setMessage(""); idempotencyKeyRef.current = crypto.randomUUID();
    setUploadError(null); setSelectedFile(null);
  }, [sessionId]);

  return <section className="grid gap-8 lg:grid-cols-[1fr_0.4fr]">
    {/* Hidden Audio File Input */}
    <input
      ref={fileInputRef}
      type="file"
      accept={AUDIO_ACCEPT_ATTR}
      onChange={handleFileSelect}
      disabled={isUploading || isLive}
      className="hidden"
      aria-label="Upload pre-recorded audio file"
    />

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

      {/* Confirmation banner before replacing an existing recording */}
      {replaceConfirmFile && (
        <div className="mt-6 rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-bg)] p-5 text-sm text-[var(--warning-text)]" role="alert">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-[var(--warning-text)]" />
            <div className="flex-1">
              <p className="font-semibold text-[var(--warning-text)]">Replace existing session recording?</p>
              <p className="mt-1 text-xs leading-5">
                An audio recording already exists for this session. Uploading <strong>{replaceConfirmFile.name}</strong> ({(replaceConfirmFile.size / 1024 / 1024).toFixed(2)} MB) will replace the previous recording and generate a new transcript.
              </p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    const f = replaceConfirmFile;
                    setReplaceConfirmFile(null);
                    if (f) void processAudioFile(f);
                  }}
                  className="rounded-full bg-[var(--olive-primary)] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]"
                >
                  Confirm & replace
                </button>
                <button
                  type="button"
                  onClick={() => setReplaceConfirmFile(null)}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface-inner)] px-4 py-2 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-chip)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload & Transcription Progress Banner */}
      {isUploading && (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-[var(--olive-primary)]/40 bg-[var(--badge-olive-bg)] p-4 text-sm text-[var(--olive-dark-text)]" aria-live="polite">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--olive-primary)] shrink-0" />
            <div>
              <p className="font-semibold">
                {selectedFile ? `Processing ${selectedFile.name} (${(selectedFile.size / 1024 / 1024).toFixed(2)} MB)` : "Processing audio file…"}
              </p>
              <p className="text-xs text-[var(--olive-text)] mt-0.5">{uploadProgress || "Uploading audio and generating transcript…"}</p>
            </div>
          </div>
          <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium shrink-0">In progress</span>
        </div>
      )}

      {/* Upload Error Banner */}
      {uploadError && (
        <div className="mt-6 flex items-start justify-between gap-3 rounded-xl border border-[var(--error-border)] bg-[var(--error-bg)] p-4 text-sm text-[var(--error-text)]" role="alert">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Audio upload failed</p>
              <p className="mt-0.5 text-xs">{uploadError}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedFile && (
              <button
                type="button"
                onClick={() => void processAudioFile(selectedFile)}
                className="rounded-full border border-[var(--error-border)] px-3 py-1 text-xs font-semibold hover:bg-white/40"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => setUploadError(null)}
              className="text-xs opacity-70 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        </div>
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
        <div className="flex flex-wrap items-center gap-3">
          {phase === "idle" && (
            <>
              <button
                type="button"
                onClick={startRecording}
                disabled={isUploading}
                className="rounded-full bg-[var(--olive-primary)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)] disabled:opacity-50"
              >
                Start speaking · 5:00
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-inner)] px-5 py-3 text-sm font-semibold text-[var(--olive-text)] transition hover:bg-[var(--surface-chip)] hover:border-[var(--olive-primary)] disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                <span>Upload pre-recorded audio</span>
              </button>
            </>
          )}
          {phase === "requesting" && <button type="button" disabled className="rounded-full bg-[var(--olive-primary)] px-6 py-3 text-sm font-semibold text-white opacity-60">Requesting microphone…</button>}
          {(phase === "recording" || phase === "stopping") && <button type="button" onClick={stopEarly} disabled={phase === "stopping"} className="rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--olive-text)] hover:bg-[var(--surface-inner)] disabled:opacity-40">Stop early</button>}
          {phase === "completed" && (
            <>
              <Link href={`/dashboard/session/${sessionId}/report`} className="rounded-full bg-[var(--olive-primary)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]">
                View report ↗
              </Link>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--olive-text)] hover:bg-[var(--surface-inner)] disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Replace with audio file</span>
              </button>
            </>
          )}
          {phase === "denied" && <button type="button" onClick={startRecording} className="rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--olive-text)] hover:bg-[var(--surface-inner)]">Try microphone again</button>}
          {phase === "interrupted" && <button type="button" onClick={acknowledgeInterruption} className="rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--olive-text)] hover:bg-[var(--surface-inner)]">Discard and start fresh</button>}
          {phase === "unsupported" && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-[var(--error-text)]">Microphone capture is unavailable.</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--olive-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)] disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                <span>Upload audio file instead</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>

    <aside className="h-fit rounded-[2rem] border border-[var(--banner-sage-border)] bg-[var(--banner-sage-bg)] p-7 text-[var(--banner-sage-text)] sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--olive-primary)]">Session mode</p>
      <h2 className="display-serif mt-4 text-2xl leading-tight text-[var(--ink-heading)]">{cueModeLabel}</h2>
      <p className="mt-4 text-sm leading-6">You can record your 5-minute presentation live or upload an existing recording (MP3, WAV, M4A, WebM, OGG up to 25 MiB). Audio is backed up locally in browser storage and securely uploaded for ASR transcription and pacing analysis.</p>
      <div className="mt-6 border-t border-[var(--banner-sage-border)] pt-5 text-sm leading-6">
        <p className="font-semibold text-[var(--banner-sage-dark-text)]">Local recovery</p>
        <p className="mt-1">Your audio is preserved in this browser as it finishes. If the tab crashes mid-session, your research and audio drafts remain safe.</p>
      </div>
      <ol className="mt-6 space-y-1 text-xs text-[var(--olive-text)]">{SIX_STAGES.map((stage, index) => <li key={stage.key} className="flex justify-between"><span>{index + 1}. {stage.label}</span><span className="tabular-nums">{formatMmSs(stage.durationSec)}</span></li>)}</ol>
      {meta && <p className="mt-6 text-xs text-[var(--ink-muted)]">Idempotency key active for retries: <code className="break-all">{meta.idempotencyKey.slice(0, 8)}…</code></p>}
    </aside>
  </section>;
}
