"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteResearchDraft, loadResearchDraft, saveResearchDraft, type StoredResearchImage } from "@/lib/research/draft-store";
import { validateResearchInput } from "@/lib/research/adapter";

const DRAFT_ID = "current-research";
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const ALLOWED_EXTENSIONS = /\.(png|jpe?g|webp)$/i;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_COUNT = 10;

export default function ResearchWorkspace() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [text, setText] = useState("");
  const [images, setImages] = useState<StoredResearchImage[]>([]);
  const [saveState, setSaveState] = useState("Loading local recovery…");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [ack, setAck] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadResearchDraft(DRAFT_ID).then((draft) => {
      if (cancelled) return;
      if (draft) {
        setTopic(draft.topic ?? ""); setText(draft.text ?? ""); setImages(Array.isArray(draft.images) ? draft.images : []);
        setSaveState(`Recovered ${new Date(draft.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
      } else {
        setSaveState("Ready to save locally");
      }
    }).catch(() => { if (!cancelled) setSaveState("Local recovery unavailable"); })
      .finally(() => { if (!cancelled) { hydratedRef.current = true; setHydrated(true); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      if (!hydratedRef.current) return;
      saveResearchDraft({ id: DRAFT_ID, topic, text, images, savedAt: new Date().toISOString() })
        .then(() => setSaveState("Saved locally"))
        .catch(() => setSaveState("Could not save locally"));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [topic, text, images, hydrated]);

  // Editing after a save invalidates the saved snapshot, so a fresh save is required
  // before continuing. Runs on content change only (savedSessionId intentionally omitted).
  useEffect(() => {
    setSavedSessionId((current) => { if (current) setAck(false); return null; });
  }, [topic, text, images]);

  const validation = useMemo(() => validateResearchInput(text, images), [text, images]);
  const totalBytes = images.reduce((total, image) => total + image.size, 0);

  function addImages(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selected.length === 0) return;
    const rejected: string[] = [];
    const remainingSlots = Math.max(0, MAX_IMAGE_COUNT - images.length);
    let runningTotal = images.reduce((total, image) => total + image.size, 0);
    const accepted: StoredResearchImage[] = [];
    for (const file of selected) {
      const typeOk = ALLOWED_IMAGE_TYPES.has(file.type) || ALLOWED_EXTENSIONS.test(file.name);
      if (!typeOk) { rejected.push(`${file.name}: only PNG, JPG, JPEG, or WEBP are accepted`); continue; }
      if (file.size > MAX_IMAGE_BYTES) { rejected.push(`${file.name}: exceeds the 10 MB per-image limit`); continue; }
      if (accepted.length >= remainingSlots) { rejected.push(`${file.name}: only ${MAX_IMAGE_COUNT} images per session`); continue; }
      if (runningTotal + file.size > MAX_TOTAL_BYTES) { rejected.push(`${file.name}: would exceed the 25 MB session total`); continue; }
      runningTotal += file.size;
      accepted.push({ id: crypto.randomUUID(), name: file.name, type: file.type || "image/*", size: file.size, blob: file });
    }
    if (accepted.length > 0) setImages((current) => [...current, ...accepted]);
    if (rejected.length > 0) setMessage(`Rejected ${rejected.length} file${rejected.length === 1 ? "" : "s"} — ${rejected.join("; ")}. Valid material is preserved.`);
    else setMessage("");
  }

  async function saveToSession() {
    if (!validation.ok) { setMessage(validation.message); return; }
    setBusy(true); setMessage("");
    try {
      const sessionResponse = await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: crypto.randomUUID() }) });
      const sessionData = await sessionResponse.json();
      if (!sessionResponse.ok) throw new Error(sessionData.error ?? "The server could not create a session.");
      const saveResponse = await fetch(`/api/sessions/${sessionData.session.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ researchText: text }) });
      if (!saveResponse.ok) { const data = await saveResponse.json(); throw new Error(data.error ?? "The research could not be saved."); }
      await deleteResearchDraft(DRAFT_ID);
      setSavedSessionId(sessionData.session.id);
      setSaveState("Saved to your session");
      setMessage("");
    } catch (error) {
      // Graceful degradation: when the server (Supabase) is unconfigured or unreachable,
      // proceed with a local-only session so the speaking flow still works offline.
      // The local draft is intentionally preserved as a backup in this path.
      const localId = crypto.randomUUID();
      setSavedSessionId(localId);
      setSaveState("Saved locally · server not connected");
      const reason = error instanceof Error && error.message ? ` (${error.message})` : "";
      setMessage(`Server storage is not connected${reason}, so this session is saved locally on this device only. You can still continue to a local-only speaking session.`);
    }
    finally { setBusy(false); }
  }

  function continueToSpeak(mode: "research_grounded" | "generic") {
    if (!savedSessionId) return;
    router.push(`/dashboard/session/${savedSessionId}/speak?cueMode=${mode}`);
  }

  async function processResearch() {
    if (!validation.ok) { setMessage(validation.message); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/research/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, images: images.map(({ name, type, size }) => ({ name, type, size })) }) });
      const data = await response.json();
      if (response.ok && data?.generated === true) setAiAvailable(true);
      setMessage(data.message ?? data.error ?? "Research processing is unavailable.");
    } catch { setMessage("Research processing could not be reached. Your original material is preserved."); }
    finally { setBusy(false); }
  }

  return <section className="grid gap-8 lg:grid-cols-[1fr_0.38fr]">
    <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--surface-card)] p-6 sm:p-9">
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--border-subtle)] pb-7 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--olive-eyebrow)]">Research material</p>
          <h1 className="display-serif mt-3 text-5xl text-[var(--ink-heading)]">Start with a question.</h1>
        </div>
        <span className="text-sm text-[var(--ink-subtle)]" aria-live="polite">{saveState}</span>
      </div>
      <label className="mt-8 block text-sm font-semibold text-[var(--ink)]">
        Academic topic
        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="What are you trying to understand?"
          className="mt-2 w-full rounded-xl border border-[var(--border-input)] bg-[var(--surface-inner)] px-4 py-3.5 text-[var(--ink)] outline-none transition focus:border-[var(--olive-primary)] placeholder:text-[var(--ink-faint)]"
        />
      </label>
      <label className="mt-6 block text-sm font-semibold text-[var(--ink)]">
        Research notes <span className="font-normal text-[var(--ink-faint)]">({text.length.toLocaleString()} / 50,000)</span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, 50000))}
          rows={13}
          placeholder="Paste excerpts, write observations, or collect supporting evidence here…"
          className="mt-2 w-full resize-y rounded-xl border border-[var(--border-input)] bg-[var(--surface-inner)] px-4 py-3.5 leading-7 text-[var(--ink)] outline-none transition focus:border-[var(--olive-primary)] placeholder:text-[var(--ink-faint)]"
        />
      </label>
      <div className="mt-7 rounded-2xl border border-dashed border-[var(--border-dashed)] bg-[var(--surface-subtle)] p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold text-[var(--ink-heading)]">Private image material</p>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-subtle)]">PNG, JPG, JPEG, or WEBP · 10 MB each · 25 MB total</p>
          </div>
          <label className="cursor-pointer rounded-full border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-inner)]">
            Add images
            <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" multiple onChange={addImages} className="sr-only" />
          </label>
        </div>
        {images.length > 0 && (
          <ul className="mt-4 space-y-2">
            {images.map((image) => (
              <li key={image.id} className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inner)] px-3 py-2.5 text-sm text-[var(--ink)]">
                <span className="truncate">{image.name}</span>
                <button type="button" onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))} className="ml-3 text-xs text-[#8a2f2f] underline underline-offset-2 dark:text-[#ea9e97]">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-[var(--ink-faint)]">{images.length} / 10 images · {(totalBytes / 1024 / 1024).toFixed(1)} MB</p>
      </div>

      {message && <p role="status" className="mt-6 rounded-xl border border-[var(--error-border)] bg-[var(--error-bg)] px-4 py-3 text-sm leading-6 text-[var(--error-text)]">{message}</p>}

      {savedSessionId && (
        <div className="mt-6 rounded-2xl border border-[var(--badge-olive-border)] bg-[var(--badge-olive-bg)] p-6" role="region" aria-label="Continue to speaking session">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--olive-primary)]">Research saved</p>
          <h3 className="display-serif mt-2 text-3xl leading-tight text-[var(--ink-heading)]">Your research is safe. Ready to speak?</h3>
          {aiAvailable ? (
            <>
              <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">Research-grounded cues are ready for this session.</p>
              <button type="button" onClick={() => continueToSpeak("research_grounded")} className="mt-5 rounded-full bg-[var(--olive-primary)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]">Continue to speaking session <span aria-hidden="true">↗</span></button>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">AI research extraction is not connected, so your cues will be generic and clearly labelled <span className="font-semibold text-[var(--ink)]">Not research-grounded</span> throughout the session and report.</p>
              <label className="mt-4 flex items-start gap-3 text-sm text-[var(--ink)]">
                <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} className="mt-1 accent-[var(--olive-primary)]" />
                <span>I understand that these prompts are not research-grounded.</span>
              </label>
              <button type="button" onClick={() => continueToSpeak("generic")} disabled={!ack} className="mt-5 rounded-full bg-[var(--olive-primary)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40">Continue to speaking session <span aria-hidden="true">↗</span></button>
            </>
          )}
        </div>
      )}

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={processResearch} disabled={busy || !validation.ok} className="rounded-full border border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--olive-text)] transition hover:bg-[var(--surface-inner)] disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? "Working…" : "Check research readiness"}
        </button>
        <button type="button" onClick={saveToSession} disabled={busy || !validation.ok || !!savedSessionId} className="rounded-full bg-[var(--olive-primary)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? "Saving…" : savedSessionId ? "Saved ✓" : "Save session ↗"}
        </button>
      </div>
    </div>

    <aside className="h-fit rounded-[2rem] border border-[var(--banner-sage-border)] bg-[var(--banner-sage-bg)] p-7 text-[var(--banner-sage-text)] sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--olive-primary)]">A useful pause</p>
      <h2 className="display-serif mt-4 text-3xl leading-tight text-[var(--ink-heading)]">Collect material before you collect conclusions.</h2>
      <p className="mt-5 text-sm leading-6">Speakomo keeps your originals intact. AI research extraction is not connected in this environment, so no summary, evidence, or cue cards will be invented.</p>
      <div className="mt-8 border-t border-[var(--banner-sage-border)] pt-5 text-sm leading-6">
        <p className="font-semibold text-[var(--banner-sage-dark-text)]">Recovery is on</p>
        <p className="mt-1">Your notes and selected image files are saved locally after a short pause, ready to recover if you refresh.</p>
      </div>
    </aside>
  </section>;
}