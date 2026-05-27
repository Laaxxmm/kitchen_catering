"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markAllNotificationsRead } from "@/server/actions/notifications";
import { isNextNavigationError } from "@/lib/next-error";

export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function markAll() {
    startTransition(async () => {
      try {
        await markAllNotificationsRead();
        toast.success("All marked read");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={markAll} disabled={pending}>
      {pending ? "Working…" : "Mark all read"}
    </Button>
  );
}
