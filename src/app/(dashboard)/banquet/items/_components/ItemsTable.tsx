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
  deactivateBanquetItem,
  deleteBanquetItem,
  upsertBanquetItem,
} from "@/server/actions/banquet";
import { isNextNavigationError } from "@/lib/next-error";

interface Item {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  currentStock: string;
  minStock: string | null;
  active: boolean;
}

export function ItemsTable({
  items,
  canManage = true,
  canCreate = canManage,
  startOpen = false,
}: {
  items: Item[];
  canManage?: boolean;
  /** Store keeper can add a new item but not edit/deactivate/delete. */
  canCreate?: boolean;
  /** Open the create form immediately (from the "New item" header link). */
  startOpen?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Partial<Item> | null>(
    startOpen ? { id: undefined } : null,
  );
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("piece");
  const [minStock, setMinStock] = useState("");
  const [openingStock, setOpeningStock] = useState("");

  function startCreate() {
    setEditing({ id: undefined });
    setName(""); setSku(""); setCategory("");
    setUnit("piece"); setMinStock(""); setOpeningStock("");
  }
  function startEdit(it: Item) {
    setEditing(it);
    setName(it.name);
    setSku(it.sku ?? "");
    setCategory(it.category ?? "");
    setUnit(it.unit);
    setMinStock(it.minStock ?? "");
    setOpeningStock("");
  }

  function save() {
    if (name.trim().length < 2) {
      toast.error("Name is required (min 2 chars)");
      return;
    }
    const isCreate = !editing?.id;
    startTransition(async () => {
      try {
        const res = await upsertBanquetItem(
          {
            name: name.trim(),
            sku: sku.trim() || null,
            category: category.trim() || null,
            unit: unit.trim() || "piece",
            minStock: minStock.trim() || null,
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
        const res = await deactivateBanquetItem(id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Deactivated");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }
  function hardDelete(it: Item) {
    if (!confirm(`Permanently delete "${it.name}"? Refused if it has history.`)) return;
    startTransition(async () => {
      try {
        const res = await deleteBanquetItem(it.id);
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
        const res = await upsertBanquetItem(
          {
            name: it.name,
            sku: it.sku,
            category: it.category,
            unit: it.unit,
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
      {!canCreate ? null : editing ? (
        <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
          <div className="text-[12px] font-medium text-ik-ink-2">
            {editing.id ? "Edit item" : "Add item"}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" placeholder="e.g. Ripple Tea Cups 100ml" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sku">SKU</Label>
              <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="category">Category</Label>
              <Input id="category" placeholder="Packaging / Tissue / Cutlery" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="unit">Unit</Label>
              <Input id="unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="minStock">Low-stock at</Label>
              <Input id="minStock" type="number" inputMode="decimal" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
            </div>
          </div>
          {!editing.id && (
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor="openingStock">
                Initial stock <span className="ml-1 text-[10.5px] font-normal text-ik-ink-3">(optional)</span>
              </Label>
              <Input id="openingStock" type="number" inputMode="decimal" value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} />
              <p className="text-[11px] text-ik-ink-3">
                Only at first setup. Records an internal &ldquo;Opening
                balance&rdquo; receipt.
              </p>
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>Cancel</Button>
          </div>
        </section>
      ) : (
        <div><Button onClick={startCreate}>+ Add item</Button></div>
      )}

      {items.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No items yet. Add the first one above.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="text-right">Min</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => {
              const low = it.minStock !== null && Number(it.currentStock) <= Number(it.minStock);
              return (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">{it.name}</TableCell>
                  <TableCell className="text-[11.5px] uppercase tracking-wide text-ik-ink-2">
                    {it.category ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-[11.5px] text-ik-ink-2">{it.sku ?? "—"}</TableCell>
                  <TableCell className="text-[12.5px]">{it.unit}</TableCell>
                  <TableCell className="text-right">
                    <span className={"font-mono " + (low ? "text-alert" : "text-ik-ink")}>{it.currentStock}</span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] text-ik-ink-3">{it.minStock ?? "—"}</TableCell>
                  <TableCell>
                    <span className={"text-[11px] " + (it.active ? "text-positive" : "text-ik-ink-3")}>
                      {it.active ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {it.active ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => startEdit(it)} disabled={pending}>Edit</Button>
                            <Button size="sm" variant="outline" onClick={() => deactivate(it.id)} disabled={pending}>Deactivate</Button>
                          </>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => reactivate(it)} disabled={pending}>Reactivate</Button>
                        )}
                        <Button size="sm" variant="destructive" onClick={() => hardDelete(it)} disabled={pending}>Delete</Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
