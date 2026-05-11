import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/server/auth";

/**
 * Mobile-route layout. Used inside the Capacitor WebView OR on any
 * narrow-screen browser hitting /m/*. Strips the desktop sidebar +
 * topbar; uses a slim header + bottom tab bar instead.
 *
 * Inherits NextAuth session from the same cookie the desktop uses,
 * so a user signed in on the web works on mobile without re-auth.
 * Phase 5+ will also accept the bearer-JWT path via the /api/mobile/*
 * endpoints for the native APK build.
 */
export default async function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div
      className="flex min-h-screen flex-col bg-ik-paper font-ik-sans text-ik-ink"
      style={{ paddingTop: "max(env(safe-area-inset-top), 28px)" }}
    >
      <header className="flex items-center justify-between border-b border-ik-rule bg-ik-card px-4 py-3">
        <Link href="/m/deliveries" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-500">
            <svg width="16" height="16" viewBox="0 0 40 40">
              <path d="M20 9 C13 13, 11 22, 14 28 C16 31, 19 31, 21 30 C25 28, 28 22, 28 16 C28 12, 24 9, 20 9 Z" fill="#fff" />
            </svg>
          </span>
          <span className="text-[14px] font-medium">Indefine Kitchen</span>
        </Link>
        <div className="text-[11px] text-ik-ink-3">{session.user.role}</div>
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-24 pt-2">{children}</main>
      <nav className="fixed bottom-0 left-0 right-0 border-t border-ik-rule bg-ik-card px-2 py-2 text-[11px]">
        <div className="mx-auto flex max-w-lg items-center justify-around">
          <Link href="/m/deliveries" className="flex flex-col items-center gap-1 px-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3h10l5 5v9a2 2 0 0 1-2 2H3z" />
              <circle cx="7" cy="19" r="2" />
              <circle cx="17" cy="19" r="2" />
            </svg>
            Deliveries
          </Link>
          <Link href="/m/me" className="flex flex-col items-center gap-1 px-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 22a8 8 0 0 1 16 0" />
            </svg>
            Me
          </Link>
          <form action={handleSignOut} className="flex">
            <button type="submit" className="flex flex-col items-center gap-1 px-3 text-ik-ink-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      </nav>
    </div>
  );
}
