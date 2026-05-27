import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { listMyNotifications } from "@/server/actions/notifications";
import { formatIST } from "@/lib/time";
import { MarkAllReadButton } from "./_components/MarkAllReadButton";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const notifs = await listMyNotifications({ limit: 200 });

  return (
    <>
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        description="Every event that needs your attention. Bell icon in the sidebar shows new ones live."
        actions={<MarkAllReadButton />}
      />

      {notifs.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No notifications yet.</p>
      ) : (
        <ul className="grid divide-y divide-ik-rule rounded-md border border-ik-rule bg-ik-card">
          {notifs.map((n) => {
            const inner = (
              <div
                className={
                  "px-4 py-3 text-[13px] " +
                  (!n.readAt ? "bg-brand-50/40" : "")
                }
              >
                <div className="flex items-center gap-2">
                  {!n.readAt && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  )}
                  <span className="font-medium">{n.title}</span>
                  <span className="ml-auto text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                    {n.kind.replace(/_/g, " ").toLowerCase()}
                  </span>
                </div>
                {n.body && (
                  <p className="mt-0.5 text-[12px] text-ik-ink-2">{n.body}</p>
                )}
                <p className="mt-0.5 text-[10.5px] text-ik-ink-3">
                  {formatIST(n.createdAt, "dd MMM yyyy, HH:mm")}
                </p>
              </div>
            );
            return (
              <li key={n.id}>
                {n.link ? (
                  <Link href={n.link} className="block hover:bg-ik-paper-alt">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
