"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MaintenanceCategory } from "@prisma/client";
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
  deactivateMaintenanceItem,
  deleteMaintenanceItem,
  upsertMaintenanceItem,
} from "@/server/actions/maintenance";
import { isNextNavigationError } from "@/lib/next-error";

interface Item {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  category: MaintenanceCategory;
  currentStock: string;
  minStock: string | null;
  active: boolean;
}

const CAT_LABEL: Record<MaintenanceCategory, string> = {
  ELECTRICAL: "Electrical",
  MECHANICAL: "Mechanical",
  GENERAL: "General",
};

export function ItemsTable({ items }: { items: Item[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Partial<Item> | null>(null);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState("piece");
  const [category, setCategory] = useState<MaintenanceCategory>(MaintenanceCategory.GENERAL);
  const [minStock, setMinStock] = useState("");
  const [openingStock, setOpeningStock] = useState("");

  function startCreate() {
    setEditing({ id: undefined });
    setName(""); setSku(""); setUnit("piece");
    setCategory(MaintenanceCategory.GENERAL);
    setMinStock(""); setOpeningStock("");
  }
  function startEdit(it: Item) {
    setEditing(it);
    setName(it.name);
    setSku(it.sku ?? "");
    setUnit(it.unit);
    setCategory(it.category);
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
        const res = await upsertMaintenanceItem(
          {
            name: name.trim(),
            sku: sku.trim() || null,
            unit: unit.trim() || "piece",
            category,
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
        await deactivateMaintenanceItem(id);
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
        `Permanently delete "${it.name}"? This cannot be undone. If the item has any history, the system will refuse.`
      )
    )
      return;
    startTransition(async () => {
      try {
        const res = await deleteMaintenanceItem(it.id);
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
        const res = await upsertMaintenanceItem(
          {
            name: it.name,
            sku: it.sku,
            unit: it.unit,
            category: it.category,
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" placeholder="e.g. 6A switch" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sku">SKU (optional)</Label>
              <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="category">Category</Label>
              <select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value as MaintenanceCategory)}
                className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
              >
                {Object.values(MaintenanceCategory).map((c) => (
                  <option key={c} value={c}>{CAT_LABEL[c]}</option>
                ))}
              </select>
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
              <Label htmlFor="openingStock">Initial stock in hand <span className="ml-1 text-[10.5px] font-normal text-ik-ink-3">(optional)</span></Label>
              <Input id="openingStock" type="number" inputMode="decimal" value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} />
              <p className="text-[11px] text-ik-ink-3">
                Use only at first setup. Records an internal &ldquo;Opening balance&rdquo; receipt for the audit trail. Later additions go through <span className="font-medium">Record receipt</span>.
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
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => {
              const low = it.minStock !== null && Number(it.currentStock) <= Number(it.minStock);
              return (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">{it.name}</TableCell>
                  <TableCell className="text-[11.5px] uppercase tracking-wide text-ik-ink-2">
                    {CAT_LABEL[it.category]}
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
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
