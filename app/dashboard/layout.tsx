import Link from "next/link";
import SignOutButton from "@/components/auth/sign-out-button";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <header className="mx-auto flex max-w-6xl items-center justify-between border-b border-[var(--border-header)] px-6 py-6 lg:px-10">
        <Link href="/dashboard" aria-label="Speakomo Dashboard" className="flex items-center">
          <Logo className="h-15 w-auto sm:h-16" />
        </Link>
        <nav className="flex items-center gap-4 text-sm text-[var(--ink-muted)] sm:gap-5" aria-label="Workspace navigation">
          <Link href="/dashboard" className="hidden transition hover:text-[var(--ink)] sm:inline">Overview</Link>
          <Link href="/dashboard/history" className="hidden transition hover:text-[var(--ink)] sm:inline">History</Link>
          <Link
            href="/dashboard/practice"
            className="rounded-full border border-transparent bg-[var(--btn-dark-bg)] px-4 py-2 font-semibold text-[var(--btn-dark-text)] transition hover:bg-[var(--btn-dark-hover)] dark:border-[#383f32]"
          >
            New session
          </Link>
          <ThemeToggle />
          <SignOutButton />
        </nav>
      </header>
      {children}
    </div>
  );
}