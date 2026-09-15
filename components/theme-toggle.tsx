"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        type="button"
        disabled
        aria-hidden="true"
        className={`flex h-9 w-9 items-center justify-center rounded-full border border-[#d9d7cd] bg-transparent opacity-0 dark:border-[#2e342a] ${className ?? ""}`}
      >
        <span className="h-4 w-4" />
      </button>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d9d7cd] bg-[var(--surface-card)] text-[#6c7068] transition-colors hover:border-[#b8baa9] hover:text-[#21241f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] dark:border-[#2e342a] dark:bg-[var(--surface-card)] dark:text-[#9ea396] dark:hover:border-[#434b3d] dark:hover:text-[#edebe4] ${className ?? ""}`}
    >
      {isDark ? (
        <Sun className="h-4 w-4 transition-transform hover:rotate-45" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4 transition-transform hover:-rotate-12" aria-hidden="true" />
      )}
    </button>
  );
}

export default ThemeToggle;
