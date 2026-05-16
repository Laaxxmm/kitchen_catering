import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { LoginForm } from "./LoginForm";

// Two-pane login. Left pane: ink-on-paper brand copy (desktop only).
// Right pane: form card. Same shell on mobile (form only, with brand strip).
// Styled with the Fresh basil palette to match the dashboard shell.

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  const sp = await searchParams;
  if (session?.user) redirect(sp.callbackUrl ?? "/");

  return (
    <main className="relative min-h-screen overflow-hidden bg-ik-paper font-ik-sans">
      {/* Soft brand-wash background tint behind the right (form) pane. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(900px 500px at 30% 0%, #E1F5EE 0%, transparent 70%), radial-gradient(800px 400px at 110% 110%, #E1F5EE 0%, transparent 70%)",
        }}
      />
      {/* Full-bleed two-pane layout — no width cap so the brand panel
          stretches edge-to-edge on wide monitors. */}
      <div className="grid min-h-screen w-full grid-cols-1 lg:grid-cols-2">
        {/* Left: ink brand pane (desktop only) */}
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-ik-ink px-10 py-10 text-white lg:flex xl:px-16 xl:py-14">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(600px 320px at 15% 0%, rgba(29,158,117,0.22), transparent), radial-gradient(700px 400px at 100% 100%, rgba(29,158,117,0.10), transparent)",
            }}
          />
          <div className="relative flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[7px] bg-brand-500">
              {/* Chef's toque — three puffs + band, white on the
                  brand-green square that wraps this svg. */}
              <svg width="22" height="22" viewBox="0 0 40 40">
                <circle cx="14" cy="20" r="5" fill="#fff" />
                <circle cx="20" cy="17" r="6" fill="#fff" />
                <circle cx="26" cy="20" r="5" fill="#fff" />
                <rect x="10" y="25" width="20" height="6.5" rx="1.6" fill="#fff" />
              </svg>
            </span>
            <div className="flex flex-col leading-[1.1]">
              <span className="text-[14px] font-medium tracking-[-0.01em]">
                Green Park Eco Hotel
              </span>
              <span className="font-ik-mono text-[10px] font-medium uppercase tracking-[0.12em] text-white/60">
                Catering operations
              </span>
            </div>
          </div>

          <div className="relative">
            <div className="font-ik-mono text-[10px] font-medium uppercase tracking-[0.12em] text-white/60">
              B2B catering, end-to-end
            </div>
            <h1 className="mt-3 font-ik-sans text-[34px] font-medium leading-[1.1] tracking-[-0.025em]">
              Every order.
              <br />
              Every <span className="text-brand-300">plate</span>.
              <br />
              Every rupee.
            </h1>
            <p className="mt-4 max-w-md text-[13px] leading-[1.55] text-white/70">
              From order intake to kitchen prep, delivery and invoicing —
              one workflow, one source of truth, real-time per-order P&amp;L.
            </p>
          </div>

          <div className="relative grid grid-cols-3 gap-3 text-[11px]">
            {[
              { k: "Orders", v: "Chef-first approval" },
              { k: "Kitchen", v: "Recipe-aware prep" },
              { k: "Delivery", v: "One-tap dispatch" },
            ].map((item) => (
              <div
                key={item.k}
                className="rounded-[10px] border border-white/10 bg-white/[0.04] p-3"
              >
                <div className="font-ik-mono text-[9px] font-medium uppercase tracking-[0.12em] text-white/55">
                  {item.k}
                </div>
                <div className="mt-[3px] font-ik-sans text-[13px] font-medium tracking-[-0.01em]">
                  {item.v}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Right: login card */}
        <section className="flex items-center justify-center px-6 py-12 sm:px-10 lg:px-16">
          <div className="w-full max-w-sm">
            {/* Brand lockup (mobile only) */}
            <div className="mb-6 flex items-center gap-2.5 lg:hidden">
              <span className="flex h-9 w-9 items-center justify-center rounded-[7px] bg-brand-500">
                <svg width="22" height="22" viewBox="0 0 40 40">
                  <path
                    d="M20 9 C13 13, 11 22, 14 28 C16 31, 19 31, 21 30 C25 28, 28 22, 28 16 C28 12, 24 9, 20 9 Z"
                    fill="#fff"
                  />
                </svg>
              </span>
              <div className="flex flex-col leading-[1.1]">
                <span className="font-ik-sans text-[14px] font-medium tracking-[-0.01em] text-ik-ink">
                  Green Park Eco Hotel
                </span>
                <span className="font-ik-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ik-ink-3">
                  Catering operations
                </span>
              </div>
            </div>

            <div className="rounded-[14px] border border-ik-rule bg-ik-card p-6 shadow-card">
              <div className="mb-5">
                <div className="ik-eyebrow">Welcome back</div>
                <h2 className="mt-1 font-ik-sans text-[22px] font-medium tracking-[-0.025em] text-ik-ink">
                  Sign in
                </h2>
                <p className="mt-1 font-ik-sans text-[13px] text-ik-ink-3">
                  Use your Green Park Eco Hotel credentials to continue.
                </p>
              </div>
              <LoginForm callbackUrl={sp.callbackUrl} error={sp.error} />
            </div>

            <p className="mt-4 text-center font-ik-mono text-[10px] uppercase tracking-[0.12em] text-ik-ink-3">
              Secure session · Asia/Kolkata · IST timestamps
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
