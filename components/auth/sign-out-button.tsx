"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/supabase/client";

export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    if (busy) return;
    setBusy(true);
    try { await createClient().auth.signOut(); router.push("/auth/login"); router.refresh(); } catch { setBusy(false); }
  }
  return <button onClick={signOut} disabled={busy} className="text-sm text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)] underline-offset-4 hover:underline">{busy ? "Signing out…" : "Sign out"}</button>;
}