"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackageOpen } from "lucide-react";
import { toast } from "sonner";
import { LeftoverDisposition } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isNextNavigationError } from "@/lib/next-error";
import { addOrderLeftover, removeOrderLeftover } from "@/server/actions/leftover-return";

// Where the returned food went — shown on the chips and offered in the form.
const DISPOSITION_LABELS: Record<LeftoverDisposition, string> = {
  REUSE_BREAKFAST: "Next-day breakfast",
  CHARITY: "Charity",
  DISCARDED: "Discarded",
};

export interface LoggedLeftover {
  id: string;
  itemName: string;
  /** Serialised Decimal from the server. */
  quantity: string;
  unit: string;
  disposition: LeftoverDisposition;
  note: string | null;
}

interface Props {
  orderId: string;
  /** Dish/item names that were on this order — offered as one-tap picks and
   *  type-ahead so staff choose what was actually served, not free-type it. */
  orderItems?: string[];
  leftovers: LoggedLeftover[];
  /** Whether the viewer may add/remove (the server gates anyway). */
  canEdit: boolean;
}

/**
 * Leftovers returned from a counter-sale / ODC event and where they went.
 * Traceability only — logging here posts no stock movement. Mirrors the
 * serving-staff allocator: chips with a one-tap remove, and a tiny inline
 * form that stays open so several items go in quickly (the same item can
 * come back more than once with different dispositions).
 */
export function LeftoverReturns({ orderId, orderItems = [], leftovers, canEdit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [disposition, setDisposition] = useState<LeftoverDisposition>("REUSE_BREAKFAST");
  const [note, setNote] = useState("");

  // Deduped order items, offered as one-tap picks + type-ahead.
  const itemChoices = Array.from(new Set(orderItems.map((n) => n.trim()).filter(Boolean)));
  const datalistId = `leftover-items-${orderId}`;

  // Nothing to show and nothing the viewer can do — render nothing.
  if (leftovers.length === 0 && !canEdit) return null;

  function add() {
    const name = itemName.trim();
    if (name.length < 2) {
      toast.error("Enter the item name (at least 2 characters)");
      return;
    }
    if (!(Number(quantity) > 0)) {
      toast.error("Enter a quantity greater than zero");
      return;
    }
    startTransition(async () => {
      try {
        const res = await addOrderLeftover({
          orderId,
          itemName: name,
          quantity: quantity.trim(),
          unit: unit.trim() || "pcs",
          disposition,
          note: note.trim() || null,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(`${name} logged`);
        // Keep the form open + unit/disposition as-is so a batch goes in item
        // after item; clear only the item name and quantity.
        setItemName("");
        setQuantity("");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not log leftover");
      }
    });
  }

  function remove(row: LoggedLeftover) {
    startTransition(async () => {
      try {
        const res = await removeOrderLeftover(row.id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(`${row.itemName} removed`);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not remove leftover");
      }
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {leftovers.map((l) => (
          <span
            key={l.id}
            className="inline-flex items-center gap-1 rounded-full bg-ik-paper-alt px-2 py-0.5 text-[11.5px] text-ik-ink ring-1 ring-ik-rule"
          >
            <span className="font-medium">{l.itemName}</span>
            <span className="text-ik-ink-3">
              {" "}· {l.quantity} {l.unit} · {DISPOSITION_LABELS[l.disposition]}
            </span>
            {l.note && <span className="italic text-ik-ink-3"> · {l.note}</span>}
            {canEdit && (
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(l)}
                aria-label={`Remove ${l.itemName}`}
                title={`Remove ${l.itemName}`}
                className="ml-0.5 rounded-full px-0.5 text-[11px] leading-none text-ik-ink-3 transition hover:text-alert disabled:opacity-50"
              >
                ✕
              </button>
            )}
          </span>
        ))}
        {canEdit && !open && (
          leftovers.length === 0 ? (
            // Nothing logged yet — a solid labelled button, not a faint chip.
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-[12.5px] font-medium text-brand-700 transition hover:bg-brand-100"
            >
              <PackageOpen className="h-3.5 w-3.5" />
              Log leftover
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-full border border-dashed border-ik-rule px-2 py-0.5 text-[11.5px] text-ik-ink-2 transition hover:border-brand-200 hover:text-brand"
            >
              + Log leftover
            </button>
          )
        )}
      </div>

      {canEdit && open && (
        <div className="mt-2 grid gap-1.5 rounded-md border border-ik-rule bg-ik-card p-2">
          {/* One-tap picks — what was actually on this order. Tapping fills the
              item name; staff still set qty + where it went. Free text stays
              allowed for anything off-menu. */}
          {itemChoices.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {itemChoices.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setItemName(name)}
                  className={
                    "rounded-full px-2 py-0.5 text-[11.5px] transition " +
                    (itemName === name
                      ? "bg-brand-500 text-white"
                      : "bg-ik-paper-alt text-ik-ink-2 ring-1 ring-ik-rule hover:bg-brand-50 hover:text-brand-700")
                  }
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          <datalist id={datalistId}>
            {itemChoices.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <div className="flex flex-wrap gap-1.5">
            <Input
              list={datalistId}
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="Item — pick above or type"
              className="h-8 min-w-[140px] flex-1 text-[12.5px]"
              autoFocus
            />
            <Input
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="Qty"
              className="h-8 w-20 text-[12.5px]"
            />
            <Input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="Unit"
              className="h-8 w-20 text-[12.5px]"
            />
            <select
              value={disposition}
              onChange={(e) => setDisposition(e.target.value as LeftoverDisposition)}
              className="h-8 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]"
            >
              {(Object.keys(DISPOSITION_LABELS) as LeftoverDisposition[]).map((d) => (
                <option key={d} value={d}>
                  {DISPOSITION_LABELS[d]}
                </option>
              ))}
            </select>
          </div>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Note (optional)"
            className="h-8 text-[12.5px]"
          />
          <div className="flex items-center gap-1.5">
            <Button size="sm" disabled={pending || itemName.trim().length < 2} onClick={add}>
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setItemName("");
                setQuantity("");
                setNote("");
              }}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
