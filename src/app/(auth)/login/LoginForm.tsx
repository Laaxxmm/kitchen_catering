"use client";

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";

// Styled with IK tokens to match the mobile shell. Inputs use ik-rule
// borders with an orange focus ring; the submit button is the signal orange
// used for punch + submit-for-approval elsewhere.

/**
 * Open-redirect guard: only let `callbackUrl` through if it's a same-origin
 * relative path. NextAuth validates this on its side, but we also call
 * `router.push(callbackUrl)` directly — without this check, a link like
 * `/login?callbackUrl=https://evil.com` would land an authenticated user on
 * a phishing site post-login.
 */
function safeCallback(raw: string | undefined): string {
  if (!raw) return "/";
  // Must start with a single "/", and must NOT be protocol-relative ("//"),
  // a full URL ("http(s)://"), or contain a backslash (some clients
  // normalize \\ → //). Reject everything else.
  if (
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:/i.test(raw)
  ) {
    return "/";
  }
  return raw;
}

export function LoginForm({
  callbackUrl,
  error,
}: {
  callbackUrl?: string;
  error?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const [localError, setLocalError] = useState<string | null>(error ?? null);
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    const safe = safeCallback(callbackUrl);
    startTransition(async () => {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: safe,
      });
      if (!res || res.error) {
        setLocalError("Invalid email or password");
        toast.error("Invalid email or password");
        return;
      }
      router.push(safe);
      router.refresh();
    });
  }

  const inputClass =
    "block w-full rounded-[8px] border border-ik-rule bg-ik-card px-3 py-[10px] " +
    "font-ik-sans text-[14px] text-ik-ink placeholder:text-ik-ink-4 " +
    "outline-none transition " +
    "focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-[6px]">
        <label htmlFor="email" className="ik-eyebrow block">
          Email
        </label>
        <input
          id="email"
          type="email"
          placeholder="you@greenpath.in"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="space-y-[6px]">
        <label htmlFor="password" className="ik-eyebrow block">
          Password
        </label>
        <input
          id="password"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </div>
      {localError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[8px] border border-alert/25 bg-alert-wash px-3 py-2 font-ik-sans text-[12.5px] text-alert"
        >
          <AlertCircle className="mt-[2px] h-[14px] w-[14px] flex-shrink-0" />
          <span>{localError}</span>
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="flex h-11 w-full items-center justify-center rounded-[10px] bg-brand-500 font-ik-sans text-[14px] font-semibold tracking-[-0.005em] text-white transition hover:brightness-[1.05] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
