"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deactivateHousekeepingItem,
  deleteHousekeepingItem,
  upsertHousekeepingItem,
} from "@/server/actions/housekeeping";
import { isNextNavigationError } from "@/lib/next-error";

interface Item {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  currentStock: string;
  minStock: string | null;
  active: boolean;
  reusable: boolean;
  inCirculation: string;
}

export function ItemsTable({ items }: { items: Item[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Partial<Item> | null>(null);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState("piece");
  const [minStock, setMinStock] = useState("");
  const [openingStock, setOpeningStock] = useState("");
  const [reusable, setReusable] = useState(false);

  function startCreate() {
    setEditing({ id: undefined });
    setName("");
    setSku("");
    setUnit("piece");
    setMinStock("");
    setOpeningStock("");
    setReusable(false);
  }
  function startEdit(it: Item) {
    setEditing(it);
    setName(it.name);
    setSku(it.sku ?? "");
    setUnit(it.unit);
    setMinStock(it.minStock ?? "");
    setOpeningStock(""); // not used on edit
    setReusable(it.reusable);
  }
  function cancel() {
    setEditing(null);
  }

  function save() {
    if (name.trim().length < 2) {
      toast.error("Name is required (min 2 chars)");
      return;
    }
    const isCreate = !editing?.id;
    startTransition(async () => {
      try {
        const res = await upsertHousekeepingItem(
          {
            name: name.trim(),
            sku: sku.trim() || null,
            unit: unit.trim() || "piece",
            reusable,
            minStock: minStock.trim() || null,
            // Only sent on create; ignored server-side on update.
            openingStock: isCreate && openingStock.trim() ? openingStock.trim() : null,
            active: true,
          },
          editing?.id
        );
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(
          isCreate
            ? openingStock.trim()
              ? `Item added with opening stock ${openingStock}`
              : "Item added"
            : "Updated"
        );
        setEditing(null);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  function deactivate(id: string) {
    if (!confirm("Deactivate this item?")) return;
    startTransition(async () => {
      try {
        await deactivateHousekeepingItem(id);
        toast.success("Deactivated");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  function hardDelete(it: Item) {
    if (
      !confirm(
        `Permanently delete "${it.name}"? This cannot be undone. If the item has any receipts or issues, the system will refuse and you should deactivate instead.`
      )
    )
      return;
    startTransition(async () => {
      try {
        const res = await deleteHousekeepingItem(it.id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Deleted");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  function reactivate(it: Item) {
    startTransition(async () => {
      try {
        const res = await upsertHousekeepingItem(
          {
            name: it.name,
            sku: it.sku,
            unit: it.unit,
            reusable: it.reusable,
            minStock: it.minStock,
            active: true,
          },
          it.id
        );
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Reactivated");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <div className="grid gap-4">
      {editing ? (
        <section className="grid gap-3 rounded-md border border-ik-rule bg-ik-card p-4">
          <div className="text-[12px] font-medium text-ik-ink-2">
            {editing.id ? "Edit item" : "Add item"}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g. Bath towel"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sku">SKU (optional)</Label>
              <Input
                id="sku"
                placeholder="e.g. BT-001"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="unit">Unit</Label>
              <Input
                id="unit"
                placeholder="piece"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="minStock">Low-stock alert at</Label>
              <Input
                id="minStock"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-start gap-2 text-[12.5px] text-ik-ink-2">
            <input type="checkbox" checked={reusable} onChange={(e) => setReusable(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium text-ik-ink">Reusable item</span> — washed and reused (towels, linens, robes).
              Issuing moves units to &ldquo;out in use&rdquo;; bring them back via <span className="font-medium">Return linen</span>.
            </span>
          </label>
          {!editing.id && (
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor="openingStock">
                Initial stock in hand
                <span className="ml-1 text-[10.5px] font-normal text-ik-ink-3">
                  (optional)
                </span>
              </Label>
              <Input
                id="openingStock"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={openingStock}
                onChange={(e) => setOpeningStock(e.target.value)}
              />
              <p className="text-[11px] text-ik-ink-3">
                Use this only when first setting up — for example, if you already
                have 50 towels on the shelf. The system records an internal
                &ldquo;Opening balance&rdquo; receipt for the audit trail. Later
                additions should go through{" "}
                <span className="font-medium">Record receipt</span>.
              </p>
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
          </div>
        </section>
      ) : (
        <div>
          <Button onClick={startCreate}>+ Add item</Button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">
          No items yet. Add the first one above.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="text-right">Min</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => {
              const low =
                it.minStock !== null && Number(it.currentStock) <= Number(it.minStock);
              return (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">
                    {it.name}
                    {it.reusable && (
                      <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700">reusable</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-[11.5px] text-ik-ink-2">
                    {it.sku ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12.5px]">{it.unit}</TableCell>
                  <TableCell className="text-right">
                    <span
                      className={
                        "font-mono " + (low ? "text-alert" : "text-ik-ink")
                      }
                    >
                      {it.currentStock}
                    </span>
                    {it.reusable && Number(it.inCirculation) > 0 && (
                      <span className="ml-1 font-mono text-[11px] text-amber-700">· {it.inCirculation} out</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] text-ik-ink-3">
                    {it.minStock ?? "—"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        "text-[11px] " +
                        (it.active ? "text-positive" : "text-ik-ink-3")
                      }
                    >
                      {it.active ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {it.active ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => startEdit(it)}
                            disabled={pending}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deactivate(it.id)}
                            disabled={pending}
                          >
                            Deactivate
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => reactivate(it)}
                          disabled={pending}
                        >
                          Reactivate
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => hardDelete(it)}
                        disabled={pending}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
