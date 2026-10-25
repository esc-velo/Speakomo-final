import React from "react";

export function Footer() {
  return (
    <footer className="w-full border-t border-[var(--border-header)] bg-[var(--paper)]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6 sm:flex-row sm:items-center sm:py-7 lg:px-10">
        <span className="text-sm font-bold tracking-tight text-[var(--ink-heading)] sm:text-base">
          Speakomo
        </span>
        <p className="text-xs font-medium text-[var(--ink-muted)] sm:text-sm">
          Made with{" "}
          <span className="text-[var(--olive-primary)]" aria-label="love">
            ♥
          </span>{" "}
          by Rahini Raneru
        </p>
      </div>
    </footer>
  );
}

export default Footer;
