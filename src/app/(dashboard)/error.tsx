"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Dashboard error boundary. Catches any render error in a dashboard page and
 * shows a friendly, recoverable screen instead of the raw white "Application
 * error" — so a hiccup on one page never looks like the whole app (or the
 * data) is gone. "Try again" re-renders; "Reload" fetches a fresh build.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in the browser console for debugging; the digest ties to the
    // server log line.
    console.error("Dashboard render error", error);
  }, [error]);

  return (
    <div className="mx-auto grid max-w-lg gap-4 py-16 text-center">
      <div className="text-[40px]">⚠️</div>
      <h1 className="font-serif text-[20px] text-ik-ink">Something went wrong on this page</h1>
      <p className="text-[13px] text-ik-ink-2">
        This is a display error — <strong>your data is safe and nothing was deleted</strong>.
        The page just failed to load. Try again, or reload for the latest version.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" onClick={() => window.location.reload()}>Reload</Button>
        <Button variant="outline" onClick={() => (window.location.href = "/dashboard")}>Back to home</Button>
      </div>
      {error.digest && (
        <p className="text-[11px] text-ik-ink-3">Reference: {error.digest}</p>
      )}
    </div>
  );
}
