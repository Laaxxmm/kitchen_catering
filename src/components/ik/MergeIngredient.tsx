"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Merge } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isNextNavigationError } from "@/lib/next-error";
import { mergeIngredient } from "@/server/actions/inventory";

export interface MergeTarget {
  id: string;
  name: string;
  sku: string;
}

/**
 * "Merge into another item" control for the ingredient detail page. Duplicate
 * names split stock — this moves ALL stock and history from the current item
 * (source) into a chosen keeper (target), then hides the source. Admin/manager
 * only; the server gates too. Two-step: pick a target from the filtered list,
 * then confirm the irreversible copy before it fires.
 */
export function MergeIngredient({
  sourceId,
  sourceName,
  targets,
}: {
  sourceId: string;
  sourceName: string;
  targets: MergeTarget[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<MergeTarget | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? targets.filter((t) => t.name.toLowerCase().includes(q) || t.sku.toLowerCase().includes(q))
      : targets;
    return pool.slice(0, 50);
  }, [targets, query]);

  function confirmMerge() {
    if (!picked) return;
    startTransition(async () => {
      try {
        const res = await mergeIngredient(sourceId, picked.id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(`Merged "${sourceName}" into "${picked.name}"`);
        router.push(`/inventory/ingredients/${picked.id}`);
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not merge");
      }
    });
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Merge className="mr-1.5 h-3.5 w-3.5" />
        Merge into another item
      </Button>
    );
  }

  return (
    <div className="mt-4 rounded-md border border-amber/50 bg-amber-wash p-3">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[12.5px] font-medium text-ik-ink">Merge this duplicate into another item</h3>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPicked(null);
            setQuery("");
          }}
          className="text-[12px] text-ik-ink-3 hover:text-ik-ink"
        >
          Cancel
        </button>
      </div>

      {picked ? (
        <div className="grid gap-2">
          <p className="text-[12.5px] text-ik-ink-2">
            This moves <strong>ALL</strong> stock and history from <strong>{sourceName}</strong> into{" "}
            <strong>{picked.name}</strong> <span className="font-mono text-ik-ink-3">{picked.sku}</span>, then hides{" "}
            <strong>{sourceName}</strong>. This can&rsquo;t be undone.
          </p>
          <div className="flex items-center gap-1.5">
            <Button size="sm" disabled={pending} onClick={confirmMerge}>
              {pending ? "Merging…" : `Merge into ${picked.name}`}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setPicked(null)}>
              Pick a different item
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the item to keep by name or SKU…"
            className="h-8 text-[12.5px]"
            autoFocus
          />
          <div className="max-h-56 overflow-y-auto rounded border border-ik-rule bg-ik-card">
            {matches.length === 0 ? (
              <p className="px-3 py-2 text-[12.5px] text-ik-ink-3">No matching items.</p>
            ) : (
              matches.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setPicked(t)}
                  className="flex w-full items-center justify-between border-b border-ik-rule px-3 py-1.5 text-left text-[12.5px] last:border-b-0 hover:bg-ik-paper-alt"
                >
                  <span className="text-ik-ink">{t.name}</span>
                  <span className="font-mono text-[11px] text-ik-ink-3">{t.sku}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
