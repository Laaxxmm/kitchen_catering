"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ProductionJobItemStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";

interface Chef { id: string; name: string }

interface Props {
  itemId: string;
  chefUserId: string | null;
  status: ProductionJobItemStatus;
  chefs: Chef[];
  onAssign: (itemId: string, chefUserId: string) => Promise<void>;
  onStart: (itemId: string) => Promise<void>;
  onReady: (itemId: string) => Promise<void>;
  mode: "assign" | "actions";
}

export function ItemControls({ itemId, chefUserId, status, chefs, onAssign, onStart, onReady, mode }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function call(fn: () => Promise<void>) {
    startTransition(async () => {
      try {
        await fn();
        toast.success("Saved");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Action failed");
      }
    });
  }

  if (mode === "assign") {
    return (
      <select
        defaultValue={chefUserId ?? ""}
        onChange={(e) => {
          const val = e.target.value;
          if (val) call(() => onAssign(itemId, val));
        }}
        disabled={pending || status === ProductionJobItemStatus.READY || status === ProductionJobItemStatus.CANCELLED}
        className="h-8 rounded border border-ik-rule bg-ik-card px-1 text-[12.5px]"
      >
        <option value="">— pick chef —</option>
        {chefs.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    );
  }

  if (status === ProductionJobItemStatus.READY || status === ProductionJobItemStatus.CANCELLED) {
    return <span className="text-[12px] text-ik-ink-3">—</span>;
  }
  if (status === ProductionJobItemStatus.QUEUED) {
    return (
      <Button size="sm" disabled={pending} onClick={() => call(() => onStart(itemId))}>
        Start
      </Button>
    );
  }
  return (
    <Button size="sm" disabled={pending} onClick={() => call(() => onReady(itemId))}>
      Mark ready
    </Button>
  );
}
