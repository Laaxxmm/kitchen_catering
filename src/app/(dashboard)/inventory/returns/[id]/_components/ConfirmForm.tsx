"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

export interface ConfirmLine {
  id: string;
  ingredientName: string;
  unit: string;
  declaredQty: string;
  reason: string;
  orderCode: string | null;
}

/**
 * The store counting in a declared handover. Every line starts pre-filled at
 * the declared figure — the common case is that it all arrived — and the
 * store overwrites the ones that didn't. 0 is a legitimate answer.
 *
 * The declared figure is never edited here, only displayed beside the
 * received one: "chef declared 2 kg, we got 1.5 kg" is the whole reason
 * this screen exists.
 */
export function ConfirmForm({
  lines,
  onSubmit,
}: {
  lines: ConfirmLine[];
  /** Bound "use server" shim — it supplies the declaration's id. */
  onSubmit: (input: {
    note: string | null;
    lines: { lineId: string; receivedQty: string }[];
  }) => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [received, setReceived] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.declaredQty])),
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Blank is not 0 — a blank quantity reaching the server would be a
    // number nobody typed. Refuse it here and say so.
    const blank = lines.find((l) => (received[l.id] ?? "").trim() === "");
    if (blank) {
      return toast.error(
        `Enter what arrived for ${blank.ingredientName} — put 0 if none of it did`,
      );
    }
    const negative = lines.find((l) => Number(received[l.id]) < 0);
    if (negative) return toast.error("Received quantity can't be negative");

    startTransition(async () => {
      try {
        const res = await onSubmit({
          note: note.trim() || null,
          lines: lines.map((l) => ({ lineId: l.id, receivedQty: received[l.id].trim() })),
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Confirmed — stock is back on hand and the order has been credited");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ingredient</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead className="text-right">Chef declared</TableHead>
            <TableHead className="w-36">Actually received</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => {
            const diff =
              (received[l.id] ?? "").trim() !== "" &&
              Number(received[l.id]) !== Number(l.declaredQty);
            return (
              <TableRow key={l.id}>
                <TableCell>{l.ingredientName}</TableCell>
                <TableCell className="font-mono text-[12px]">{l.orderCode ?? "—"}</TableCell>
                <TableCell className="text-ik-ink-2">{l.reason}</TableCell>
                <TableCell className="text-right font-mono">
                  {l.declaredQty} {l.unit}
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={received[l.id] ?? ""}
                    onChange={(e) => setReceived((r) => ({ ...r, [l.id]: e.target.value }))}
                    aria-label={`Received quantity for ${l.ingredientName}`}
                  />
                  {diff && (
                    <span className="mt-1 block text-[11.5px] font-medium text-amber-700">
                      Differs from declared — say why in the note below
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="grid max-w-2xl gap-1">
        <Label htmlFor="confirm-note">Note (optional)</Label>
        <Textarea
          id="confirm-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. paneer tray came back short — 1.5 kg not 2 kg"
        />
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Confirm receipt & book stock in"}
        </Button>
      </div>
    </form>
  );
}
