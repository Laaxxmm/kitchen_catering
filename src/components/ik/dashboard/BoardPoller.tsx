"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The role boards are server-rendered and never refetch on their own, so a
 * revision raised while someone is staring at the screen would sit unseen
 * until they reloaded. Same 60s cadence as the notification bell, but only
 * while the tab is visible — a background board has nobody reading it.
 */
export function BoardPoller({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(t);
  }, [router, seconds]);
  return null;
}
