"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { MaintenanceActivityStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { updateMaintenanceActivityStatus } from "@/server/actions/maintenance";

type Next = "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

const DONE: Record<Next, string> = {
  IN_PROGRESS: "Job started",
  COMPLETED: "Job completed",
  CANCELLED: "Job cancelled — spares back in stock",
};

/** Start / Complete / Cancel for one open job. Terminal jobs render nothing. */
export function ActivityRowActions({ id, status }: { id: string; status: MaintenanceActivityStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (status === "COMPLETED" || status === "CANCELLED") return null;

  function move(next: Next) {
    let workDone: string | null = null;
    if (next === "COMPLETED") {
      const typed = window.prompt("Work done (optional)");
      if (typed === null) return;
      workDone = typed.trim() || null;
    }
    if (next === "CANCELLED" && !window.confirm("Cancel this job? Any spares it drew go back to stock.")) return;
    startTransition(async () => {
      const res = await updateMaintenanceActivityStatus(id, { status: next, workDone });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(DONE[next]);
      router.refresh();
    });
  }

  return (
    <div className="flex justify-end gap-1">
      {status === "PENDING" && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => move("IN_PROGRESS")}>Start</Button>
      )}
      <Button size="sm" disabled={pending} onClick={() => move("COMPLETED")}>Complete</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => move("CANCELLED")}>Cancel</Button>
    </div>
  );
}
