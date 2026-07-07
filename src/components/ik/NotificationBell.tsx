"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/actions/notifications";
import { isNextNavigationError } from "@/lib/next-error";
import { formatIST } from "@/lib/time";
import { playChime } from "@/lib/chime";

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | string | null;
  createdAt: Date | string;
}

/**
 * Sidebar bell — shows an unread count badge, opens a dropdown of the
 * latest 10 notifications on click. Polls the count on mount + every
 * 60 s while mounted (no realtime; the user explicitly opens the bell
 * when they want fresh data).
 */
export function NotificationBell({ placement = "up" }: { placement?: "up" | "down" } = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number>(0);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  // Last count we saw from the server. Starts null so the very first load
  // (which may surface pre-existing unread items) doesn't chime.
  const lastCountRef = useRef<number | null>(null);
  // Build fingerprint from the server. When it changes mid-session the app
  // was redeployed under this tab — its server-action IDs are stale and
  // every button would fail with "Server Action not found", so prompt one
  // refresh instead. Only ever prompts once per tab.
  const buildRef = useRef<string | null>(null);
  const refreshPromptedRef = useRef(false);
  // Page title without our "(N) " unread prefix, captured on first poll.
  const baseTitleRef = useRef<string | null>(null);
  // Chime on/off, persisted in localStorage. The ref mirrors state so the
  // polling closure always reads the current preference.
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);

  // Load the saved chime preference once on mount.
  useEffect(() => {
    const saved = typeof window !== "undefined" && window.localStorage.getItem("ik.chime.muted") === "1";
    setMuted(saved);
    mutedRef.current = saved;
  }, []);

  function toggleMuted() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    try {
      window.localStorage.setItem("ik.chime.muted", next ? "1" : "0");
    } catch {
      // private mode / storage disabled — preference just won't persist
    }
    if (!next) playChime(); // quick confirmation that sound is back on
  }

  // Initial + polled unread count. Chimes whenever the count rises — i.e.
  // a new notification arrived (order placed, approval, etc.).
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        // Poll a route handler (not a server action) so a stale tab left open
        // across a redeploy keeps working instead of spamming the server logs.
        const res = await fetch("/api/notifications/unread-count", { cache: "no-store" });
        if (!res.ok) return;
        const { count: c, build } = (await res.json()) as { count: number; build?: string };
        if (cancelled) return;
        if (build) {
          if (buildRef.current === null) {
            buildRef.current = build;
          } else if (buildRef.current !== build && !refreshPromptedRef.current) {
            refreshPromptedRef.current = true;
            toast.info("Greenpath was just updated — refresh to keep working.", {
              duration: Infinity,
              action: { label: "Refresh", onClick: () => window.location.reload() },
            });
          }
        }
        setCount(c);
        // Unread badge in the browser tab, so a desk that keeps Greenpath
        // in a background tab still sees work arriving at a glance.
        if (baseTitleRef.current === null) baseTitleRef.current = document.title.replace(/^\(\d+\)\s*/, "");
        document.title = c > 0 ? `(${c}) ${baseTitleRef.current}` : baseTitleRef.current;
        const prev = lastCountRef.current;
        // Chime on every rise in unread count — including background tabs,
        // so the chef/store desk hears new work without watching the screen.
        // (Browsers keep audio suspended until the user has interacted with
        // the page once per session; after that, background chimes play.)
        if (prev !== null && c > prev && !mutedRef.current) playChime();
        lastCountRef.current = c;
      } catch {
        // benign — bell is optional UI
      }
    }
    refresh();
    // 60s cadence in the foreground; hidden tabs still poll (so they can
    // chime + badge the tab title) but at half rate to keep the background
    // query load down.
    let tick = 0;
    const t = window.setInterval(() => {
      tick += 1;
      if (document.visibilityState === "visible" || tick % 2 === 0) refresh();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDocClick);
    return () => window.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function loadItems() {
    setLoading(true);
    try {
      const rows = await listMyNotifications({ limit: 10 });
      setItems(
        rows.map((r) => ({
          ...r,
          createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
          readAt: r.readAt
            ? r.readAt instanceof Date
              ? r.readAt
              : new Date(r.readAt)
            : null,
        })),
      );
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) loadItems();
  }

  function onItemClick(n: NotificationRow) {
    if (!n.readAt) {
      startTransition(async () => {
        try {
          await markNotificationRead(n.id);
          setItems((xs) =>
            xs.map((x) => (x.id === n.id ? { ...x, readAt: new Date() } : x)),
          );
          setCount((c) => Math.max(0, c - 1));
          lastCountRef.current = Math.max(0, (lastCountRef.current ?? 1) - 1);
        } catch (err) {
          if (isNextNavigationError(err)) throw err;
        }
      });
    }
    if (n.link) {
      setOpen(false);
      router.push(n.link);
    }
  }

  function markAll() {
    startTransition(async () => {
      try {
        await markAllNotificationsRead();
        setItems((xs) => xs.map((x) => ({ ...x, readAt: x.readAt ?? new Date() })));
        setCount(0);
        lastCountRef.current = 0;
        toast.success("All marked read");
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error("Could not mark all read");
      }
    });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ""}`}
        onClick={toggle}
        className="relative grid h-8 w-8 place-items-center rounded-md text-ik-ink-2 hover:bg-ik-paper-alt hover:text-ik-ink"
      >
        <Bell size={16} />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-h-[16px] min-w-[16px] place-items-center rounded-full bg-alert px-1 font-mono text-[9.5px] font-bold leading-none text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className={
            "absolute right-0 z-50 w-[320px] rounded-md border border-ik-rule bg-ik-card shadow-lg " +
            (placement === "down" ? "top-10" : "bottom-10")
          }
          style={{ maxHeight: "60vh" }}
        >
          <header className="flex items-center justify-between border-b border-ik-rule px-3 py-2">
            <span className="text-[12px] font-medium text-ik-ink-2">Notifications</span>
            <div className="flex items-center gap-3">
              {count > 0 && (
                <button
                  type="button"
                  onClick={markAll}
                  disabled={pending}
                  className="text-[10.5px] text-ik-ink-3 hover:text-brand"
                >
                  Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={toggleMuted}
                aria-label={muted ? "Turn notification sound on" : "Turn notification sound off"}
                title={muted ? "Sound off — click to turn on" : "Sound on — click to mute"}
                className="grid h-6 w-6 place-items-center rounded text-ik-ink-3 hover:bg-ik-paper-alt hover:text-ik-ink"
              >
                {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
            </div>
          </header>
          <div className="max-h-[50vh] overflow-y-auto">
            {loading && (
              <p className="p-4 text-[12.5px] text-ik-ink-3">Loading…</p>
            )}
            {!loading && items.length === 0 && (
              <p className="p-4 text-[12.5px] text-ik-ink-3">No notifications yet.</p>
            )}
            {!loading &&
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onItemClick(n)}
                  className={
                    "block w-full border-b border-ik-rule px-3 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-ik-paper-alt " +
                    (!n.readAt ? "bg-brand-50/40" : "")
                  }
                >
                  <div className="flex items-center gap-2">
                    {!n.readAt && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                    )}
                    <span className="font-medium text-ik-ink">{n.title}</span>
                  </div>
                  {n.body && (
                    <p className="mt-0.5 text-[11.5px] text-ik-ink-2">{n.body}</p>
                  )}
                  <p className="mt-0.5 text-[10.5px] text-ik-ink-3">
                    {formatIST(
                      n.createdAt instanceof Date ? n.createdAt : new Date(n.createdAt),
                      "dd MMM, HH:mm",
                    )}
                  </p>
                </button>
              ))}
          </div>
          <footer className="border-t border-ik-rule px-3 py-2 text-right">
            <Link
              href="/notifications"
              className="text-[11px] text-ik-ink-3 hover:text-brand"
              onClick={() => setOpen(false)}
            >
              View all →
            </Link>
          </footer>
        </div>
      )}
    </div>
  );
}
