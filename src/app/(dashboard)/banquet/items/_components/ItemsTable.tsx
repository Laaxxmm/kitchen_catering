"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BanquetItemSource } from "@prisma/client";
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
import { BANQUET_SOURCE_LABELS } from "@/lib/stock-movement";
import { isNextNavigationError } from "@/lib/next-error";

interface Item {
  id: string;
  name: string;
  sku: string | null;
  source: BanquetItemSource;
  category: string | null;
  unit: string;
  rate: string | null;
  currentStock: string;
  minStock: string | null;
  active: boolean;
}

const SOURCES = [BanquetItemSource.IN_HOUSE, BanquetItemSource.HIRED] as const;

// The grades the client actually uses, offered as datalist suggestions —
// category stays free text so a new grade doesn't need a deploy.
const CATEGORY_HINTS: Record<BanquetItemSource, string[]> = {
  [BanquetItemSource.IN_HOUSE]: ["Disposables", "Crockery"],
  [BanquetItemSource.HIRED]: ["Regulars", "Melamine", "Bonechina"],
};

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
  const [source, setSource] = useState<BanquetItemSource>(BanquetItemSource.IN_HOUSE);
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("piece");
  const [rate, setRate] = useState("");
  const [minStock, setMinStock] = useState("");
  const [openingStock, setOpeningStock] = useState("");
  // Catalogue filter — 154 in-house + 42 hired is too many to scan as one list.
  const [filterSource, setFilterSource] = useState<BanquetItemSource | "">("");
  const shown = filterSource ? items.filter((i) => i.source === filterSource) : items;

  function startCreate() {
    setEditing({ id: undefined });
    setName(""); setSource(BanquetItemSource.IN_HOUSE); setCategory("");
    setUnit("piece"); setRate(""); setMinStock(""); setOpeningStock("");
  }
  function startEdit(it: Item) {
    setEditing(it);
    setName(it.name);
    setSource(it.source);
    setCategory(it.category ?? "");
    setUnit(it.unit);
    setRate(it.rate ?? "");
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
            source,
            category: category.trim() || null,
            unit: unit.trim() || "piece",
            rate: rate.trim() || null,
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
            // Re-send rate: the update writes it unconditionally, so omitting
            // it here would clear the item's rate on reactivation.
            category: it.category,
            unit: it.unit,
            rate: it.rate,
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" placeholder="e.g. Ripple Tea Cups 100ml" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="source">Source</Label>
              {/* Create-only: the GP prefix encodes it and (name, source,
                  category) is the item's identity. */}
              {editing.id ? (
                <div id="source" className="flex h-9 items-center text-[13px] text-ik-ink-2">
                  {BANQUET_SOURCE_LABELS[source]}
                </div>
              ) : (
                <select
                  id="source"
                  value={source}
                  onChange={(e) => setSource(e.target.value as BanquetItemSource)}
                  className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
                >
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>{BANQUET_SOURCE_LABELS[s]}</option>
                  ))}
                </select>
              )}
              <p className="text-[10.5px] text-ik-ink-3">
                {editing.id ? "Permanent — cannot be changed." : "Owned stock, or hired in per event."}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="code">Item code</Label>
              <div id="code" className="flex h-9 items-center font-mono text-[13px] text-ik-ink-2">
                {editing.sku ?? "—"}
              </div>
              <p className="text-[10.5px] text-ik-ink-3">
                {editing.id ? "Permanent — cannot be changed." : "Assigned automatically on save."}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                list="banquet-category-hints"
                placeholder={CATEGORY_HINTS[source].join(" / ")}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <datalist id="banquet-category-hints">
                {CATEGORY_HINTS[source].map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="unit">Unit</Label>
              <Input id="unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rate">Rate / unit (₹)</Label>
              <Input id="rate" type="number" inputMode="decimal" placeholder="optional" value={rate} onChange={(e) => setRate(e.target.value)} />
              <p className="text-[10.5px] text-ik-ink-3">
                Hire charge per event, or the purchase rate on disposables.
              </p>
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

      <div className="flex items-center gap-2">
        <Label htmlFor="filterSource" className="text-[12px] text-ik-ink-2">Show</Label>
        <select
          id="filterSource"
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value as BanquetItemSource | "")}
          className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
        >
          <option value="">All sources ({items.length})</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {BANQUET_SOURCE_LABELS[s]} ({items.filter((i) => i.source === s).length})
            </option>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">
          {items.length === 0 ? "No items yet. Add the first one above." : "No items for that source."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="text-right">Min</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((it) => {
              const low = it.minStock !== null && Number(it.currentStock) <= Number(it.minStock);
              return (
                <TableRow key={it.id}>
                  <TableCell className="whitespace-nowrap font-mono text-[12px] text-ik-ink-2">{it.sku ?? "—"}</TableCell>
                  <TableCell className="font-medium">{it.name}</TableCell>
                  <TableCell className="whitespace-nowrap text-[12px] text-ik-ink-2">
                    {BANQUET_SOURCE_LABELS[it.source]}
                  </TableCell>
                  <TableCell className="text-[11.5px] uppercase tracking-wide text-ik-ink-2">
                    {it.category ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12.5px]">{it.unit}</TableCell>
                  <TableCell className="text-right font-mono text-[12px] text-ik-ink-2">
                    {it.rate ? `₹${it.rate}` : "—"}
                  </TableCell>
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
