"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/supabase/client";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    if (password.length < 8) {
      setMessage("Use at least 8 characters for your password.");
      setBusy(false);
      return;
    }
    try {
      const { data, error } = await createClient().auth.signUp({ email: email.trim(), password });
      if (error) throw error;
      if (data.session) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setMessage("Account created. Check your email to confirm your account.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === "SUPABASE_NOT_CONFIGURED"
          ? "Account creation is unavailable until Supabase is configured."
          : "We could not create that account yet."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-[var(--paper)] px-6 py-12 text-[var(--ink)]">
      <div className="absolute right-6 top-6 sm:right-10 sm:top-7">
        <ThemeToggle />
      </div>
      <section className="w-full max-w-md rounded-[2rem] border border-[var(--border)] bg-[var(--surface-card)] p-8 sm:p-10">
        <Link
          href="/"
          aria-label="Back to Speakomo"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
        >
          <span aria-hidden="true">←</span>
          <Logo className="h-15 w-auto" />
        </Link>
        <p className="mt-12 text-xs font-bold uppercase tracking-[0.24em] text-[var(--olive-eyebrow)]">Make room for clarity</p>
        <h1 className="display-serif mt-3 text-5xl text-[var(--ink-heading)]">Create your workspace.</h1>
        <form onSubmit={submit} className="mt-9 space-y-5">
          <label className="block text-sm font-semibold text-[var(--ink)]">
            Email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="email"
              required
              className="mt-2 w-full rounded-xl border border-[var(--border-input)] bg-[var(--surface-inner)] px-4 py-3.5 font-normal text-[var(--ink)] outline-none transition focus:border-[var(--olive-primary)] placeholder:text-[var(--ink-faint)]"
            />
          </label>
          <label className="block text-sm font-semibold text-[var(--ink)]">
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              required
              className="mt-2 w-full rounded-xl border border-[var(--border-input)] bg-[var(--surface-inner)] px-4 py-3.5 font-normal text-[var(--ink)] outline-none transition focus:border-[var(--olive-primary)] placeholder:text-[var(--ink-faint)]"
            />
          </label>
          {message && (
            <p role="status" className="rounded-xl border border-[var(--badge-olive-border)] bg-[var(--badge-olive-bg)] px-4 py-3 text-sm text-[var(--badge-olive-text)]">
              {message}
            </p>
          )}
          <button
            disabled={busy}
            className="w-full rounded-full bg-[var(--olive-primary)] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)] disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>
        <p className="mt-6 text-sm text-[var(--ink-muted)]">
          Already have an account?{" "}
          <Link href="/auth/login" className="font-semibold text-[var(--olive-text)] underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}