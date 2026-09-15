import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-7 lg:px-10">
        <Link href="/" aria-label="Speakomo Home" className="flex items-center">
          <Logo className="h-15 w-auto sm:h-16" />
        </Link>
        <div className="flex items-center gap-4 sm:gap-6">
          <nav className="hidden items-center gap-8 text-sm text-[var(--ink-nav)] md:flex" aria-label="Primary navigation">
            <a href="#method" className="transition hover:text-[var(--ink)]">Method</a>
            <a href="#practice" className="transition hover:text-[var(--ink)]">Practice</a>
            <Link href="/auth/login" className="transition hover:text-[var(--ink)]">Sign in</Link>
          </nav>
          <ThemeToggle />
          <Link
            href="/dashboard/practice"
            className="rounded-full bg-[var(--olive-primary)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]"
          >
            Start a session <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-20 pt-14 text-center lg:px-10 lg:pb-28 lg:pt-24">
        <p className="mb-7 text-xs font-bold uppercase tracking-[0.28em] text-[var(--olive-eyebrow)]">
          Academic presentation practice
        </p>
        <h1 className="display-serif mx-auto max-w-4xl text-6xl leading-[0.92] text-[var(--ink-heading)] sm:text-7xl lg:text-[8.5rem]">
          Make your research speak.
        </h1>
        <p className="mx-auto mt-9 max-w-xl text-base leading-7 text-[var(--ink-muted)] sm:text-lg">
          A quiet, structured place to gather evidence, shape your argument, and practise saying it clearly.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/dashboard/practice"
            className="rounded-full border border-transparent bg-[var(--btn-dark-bg)] px-6 py-3.5 text-sm font-semibold text-[var(--btn-dark-text)] transition hover:bg-[var(--btn-dark-hover)] dark:border-[#383f32]"
          >
            Begin with research <span aria-hidden="true">↗</span>
          </Link>
          <Link
            href="/auth/login"
            className="rounded-full border border-[var(--border)] px-6 py-3.5 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-inner)]"
          >
            Sign in to continue
          </Link>
        </div>
      </section>

      <section id="method" className="mx-auto grid max-w-6xl gap-4 px-6 pb-20 sm:grid-cols-3 lg:px-10">
        {[
          ['01', 'Gather', 'Bring your notes and private research material into one focused workspace.'],
          ['02', 'Shape', 'Turn the material into a structure you can actually remember and explain.'],
          ['03', 'Speak', 'Practise for five minutes, then review an honest record of what happened.']
        ].map(([number, title, copy]) => (
          <article
            key={number}
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-7 lg:p-9"
          >
            <p className="text-xs font-bold tracking-[0.22em] text-[var(--olive-eyebrow)]">{number}</p>
            <h2 className="display-serif mt-12 text-3xl text-[var(--ink-heading)]">{title}</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{copy}</p>
          </article>
        ))}
      </section>

      <section
        id="practice"
        className="mx-6 mb-8 rounded-[2rem] border border-[var(--banner-sage-border)] bg-[var(--banner-sage-bg)] px-7 py-12 sm:px-12 lg:mx-auto lg:max-w-6xl lg:py-16"
      >
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--olive-primary)]">
              Your next presentation
            </p>
            <h2 className="display-serif mt-4 max-w-2xl text-4xl leading-tight text-[var(--ink-heading)] sm:text-5xl">
              Give your ideas a place to become clear.
            </h2>
          </div>
          <Link
            href="/dashboard/practice"
            className="w-fit rounded-full bg-[var(--olive-primary)] px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-[var(--olive-primary-hover)]"
          >
            Open the workspace <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>
    </main>
  );
}