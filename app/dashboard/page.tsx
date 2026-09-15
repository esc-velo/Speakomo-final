"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Session = { id: string; status: string; created_at: string; updated_at: string };
export default function DashboardPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [message, setMessage] = useState("Loading your sessions…");
  useEffect(() => { fetch("/api/sessions").then(async (response) => { const data = await response.json(); if (!response.ok) { setMessage(data.error ?? "Sessions are unavailable right now."); return; } setSessions(data.sessions ?? []); setMessage(""); }).catch(() => setMessage("We could not reach the session service. Your local drafts remain safe.")); }, []);
  return (
    <main className="mx-auto max-w-6xl px-6 py-12 lg:px-10 lg:py-16">
      <div className="flex flex-col justify-between gap-8 border-b border-[var(--border-header)] pb-10 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--olive-eyebrow)]">Your workspace</p>
          <h1 className="display-serif mt-3 text-6xl text-[var(--ink-heading)]">Good to see you.</h1>
          <p className="mt-4 max-w-lg text-[var(--ink-muted)]">
            Pick up an unfinished thought or begin a fresh research-to-speech session.
          </p>
        </div>
        <Link
          href="/dashboard/practice"
          className="w-fit rounded-full bg-[var(--olive-primary)] px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]"
        >
          Start a practice ↗
        </Link>
      </div>

      <section className="pt-10" aria-live="polite">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--ink-subtle)]">Recent sessions</h2>
          <Link href="/dashboard/history" className="text-sm font-semibold text-[var(--olive-primary)] transition hover:underline">
            View history
          </Link>
        </div>

        {message && (
          <p className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6 text-sm text-[var(--ink-muted)]">
            {message}
          </p>
        )}

        {!message && sessions.length === 0 && (
          <div className="mt-5 rounded-2xl border border-dashed border-[var(--border-dashed)] p-10 text-center">
            <p className="display-serif text-3xl text-[var(--ink-heading)]">Your first session is waiting.</p>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[var(--ink-muted)]">
              Research a topic, save your notes, and practise turning evidence into a clear explanation.
            </p>
          </div>
        )}

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6 transition-colors hover:border-[var(--olive-primary)]"
            >
              <div className="flex justify-between gap-4">
                <span className="font-semibold text-[var(--ink-heading)]">Research session</span>
                <span className="rounded-full border border-[var(--badge-olive-border)] bg-[var(--badge-olive-bg)] px-3 py-1 text-xs font-semibold text-[var(--badge-olive-text)]">
                  {session.status}
                </span>
              </div>
              <p className="mt-6 text-xs text-[var(--ink-subtle)]">
                Updated {new Date(session.updated_at ?? session.created_at).toLocaleDateString()}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
                <Link
                  href={`/dashboard/session/${session.id}/research`}
                  className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[var(--olive-text)] transition hover:bg-[var(--surface-inner)]"
                >
                  Research
                </Link>
                <Link
                  href={`/dashboard/session/${session.id}/speak?cueMode=generic`}
                  className="rounded-full bg-[var(--olive-primary)] px-3 py-1.5 text-white transition hover:bg-[var(--olive-primary-hover)]"
                >
                  Speak (generic)
                </Link>
                <Link
                  href={`/dashboard/session/${session.id}/report`}
                  className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[var(--olive-text)] transition hover:bg-[var(--surface-inner)]"
                >
                  Report
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}