"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function HistoryPage() {
  const [sessions, setSessions] = useState<{ id: string; status: string; created_at: string }[]>([]);
  const [message, setMessage] = useState("Loading history…");
  useEffect(() => { fetch("/api/sessions").then(async (response) => { const data = await response.json(); if (!response.ok) { setMessage(data.error ?? "History is unavailable."); return; } setSessions(data.sessions ?? []); setMessage(""); }).catch(() => setMessage("History could not be reached.")); }, []);
  return (
    <main className="mx-auto max-w-6xl px-6 py-12 lg:px-10 lg:py-16">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--olive-eyebrow)]">Your archive</p>
      <h1 className="display-serif mt-3 text-6xl text-[var(--ink-heading)]">Session history.</h1>
      {message && (
        <p className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6 text-sm text-[var(--ink-muted)]">
          {message}
        </p>
      )}
      <div className="mt-8 space-y-3">
        {sessions.map((session) => (
          <Link
            key={session.id}
            href={`/dashboard/session/${session.id}/research`}
            className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 transition-colors hover:border-[var(--olive-primary)]"
          >
            <span className="font-semibold text-[var(--ink-heading)]">Practice session</span>
            <span className="text-sm text-[var(--ink-subtle)]">
              {session.status} · {new Date(session.created_at).toLocaleDateString()}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}