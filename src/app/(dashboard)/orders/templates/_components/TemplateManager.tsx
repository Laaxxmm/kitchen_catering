"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MealType, OrderChannel } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { isNextNavigationError } from "@/lib/next-error";
import { deactivateOrderTemplate, upsertOrderTemplate } from "@/server/actions/order-templates";

interface TemplateItem { dishId: string; dishName?: string; portions: string }
export interface Template {
  id: string;
  name: string;
  customerId: string;
  customerName: string;
  channel: OrderChannel;
  mealType: MealType;
  headcount: number;
  packageTotal: string;
  deliveryAddress: string;
  notes: string;
  items: TemplateItem[];
}

const CHANNELS: Array<{ value: OrderChannel; label: string }> = [
  { value: OrderChannel.BANQUET, label: "Banquet (corporate catering)" },
  { value: OrderChannel.BUFFET, label: "Buffet" },
  { value: OrderChannel.ODC, label: "ODC (outdoor catering)" },
  { value: OrderChannel.PACKET, label: "Packed meals" },
  { value: OrderChannel.COUNTER_SALE, label: "Counter sale (bulk)" },
];
const MEALS: Array<{ value: MealType; label: string }> = [
  { value: MealType.BREAKFAST, label: "Breakfast" },
  { value: MealType.LUNCH, label: "Lunch" },
  { value: MealType.DINNER, label: "Dinner" },
  { value: MealType.HIGH_TEA, label: "High tea" },
  { value: MealType.SNACKS, label: "Snacks" },
  { value: MealType.CUSTOM, label: "Custom" },
];

/** List + editor for recurring-order templates (manager/admin only — the
 *  page gates). "Use" hands the template to the New-order page prefilled. */
export function TemplateManager({
  templates,
  customers,
  dishes,
}: {
  templates: Template[];
  customers: Array<{ id: string; name: string }>;
  dishes: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Partial<Template> | null>(null);

  const dishOptions = dishes.map((d) => ({ value: d.id, label: d.name }));

  function startNew() {
    setEditing({
      name: "",
      customerId: customers[0]?.id ?? "",
      channel: OrderChannel.BANQUET,
      mealType: MealType.LUNCH,
      headcount: 10,
      packageTotal: "",
      deliveryAddress: "",
      notes: "",
      items: [],
    });
  }

  function save() {
    const e = editing;
    if (!e) return;
    if (!(e.items ?? []).some((it) => it.dishId)) return toast.error("Add at least one dish");
    startTransition(async () => {
      try {
        const res = await upsertOrderTemplate(
          {
            name: e.name ?? "",
            customerId: e.customerId ?? "",
            channel: e.channel,
            mealType: e.mealType,
            headcount: e.headcount ?? 1,
            packageTotal: e.packageTotal || null,
            deliveryAddress: e.deliveryAddress || null,
            notes: e.notes || null,
            items: (e.items ?? []).filter((it) => it.dishId).map((it) => ({ dishId: it.dishId, portions: it.portions || "1" })),
          },
          e.id,
        );
        if (!res.ok) return void toast.error(res.error);
        toast.success(e.id ? "Template updated" : "Template created");
        setEditing(null);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  function remove(id: string, name: string) {
    startTransition(async () => {
      const res = await deactivateOrderTemplate(id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${name} removed`);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4">
      {!editing && (
        <div>
          <Button onClick={startNew}>+ New template</Button>
        </div>
      )}

      {editing && (
        <section className="grid gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-4 shadow-ik-card">
          <h3 className="font-medium text-[14px] text-ik-ink">{editing.id ? "Edit template" : "New template"}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="tplName">Template name</Label>
              <Input id="tplName" value={editing.name ?? ""} onChange={(e) => setEditing((p) => ({ ...p!, name: e.target.value }))} placeholder="e.g. Infosys daily lunch — 150 pax" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="tplCustomer">Customer</Label>
              <select id="tplCustomer" value={editing.customerId} onChange={(e) => setEditing((p) => ({ ...p!, customerId: e.target.value }))} className="h-9 w-full min-w-0 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="grid gap-1">
              <Label htmlFor="tplChannel">Channel</Label>
              <select id="tplChannel" value={editing.channel} onChange={(e) => setEditing((p) => ({ ...p!, channel: e.target.value as OrderChannel }))} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
                {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="tplMeal">Meal</Label>
              <select id="tplMeal" value={editing.mealType} onChange={(e) => setEditing((p) => ({ ...p!, mealType: e.target.value as MealType }))} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
                {MEALS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="tplPax">Headcount</Label>
              <Input id="tplPax" type="number" min={1} value={String(editing.headcount ?? "")} onChange={(e) => setEditing((p) => ({ ...p!, headcount: Number(e.target.value) }))} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="tplPkg">Package total ₹ (optional)</Label>
              <Input id="tplPkg" inputMode="decimal" value={editing.packageTotal ?? ""} onChange={(e) => setEditing((p) => ({ ...p!, packageTotal: e.target.value }))} placeholder="e.g. 25000" />
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="tplAddr">Delivery address (optional)</Label>
            <Textarea id="tplAddr" rows={2} value={editing.deliveryAddress ?? ""} onChange={(e) => setEditing((p) => ({ ...p!, deliveryAddress: e.target.value }))} />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Dishes</Label>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing((p) => ({ ...p!, items: [...(p!.items ?? []), { dishId: "", portions: String(p!.headcount ?? 1) }] }))}>+ Add dish</Button>
            </div>
            <div className="grid gap-1.5">
              {(editing.items ?? []).map((it, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2">
                  <div className="min-w-[240px] flex-1">
                    <Combobox
                      value={it.dishId}
                      onChange={(v) => setEditing((p) => ({ ...p!, items: p!.items!.map((x, i) => (i === idx ? { ...x, dishId: v } : x)) }))}
                      options={dishOptions}
                      placeholder="Search a dish…"
                    />
                  </div>
                  <Input
                    type="number" min={1} step="any"
                    value={it.portions}
                    onChange={(e) => setEditing((p) => ({ ...p!, items: p!.items!.map((x, i) => (i === idx ? { ...x, portions: e.target.value } : x)) }))}
                    className="w-24 text-right font-mono"
                    aria-label="Portions"
                  />
                  <button type="button" className="text-alert" onClick={() => setEditing((p) => ({ ...p!, items: p!.items!.filter((_, i) => i !== idx) }))}>×</button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="tplNotes">Notes (optional)</Label>
            <Textarea id="tplNotes" rows={2} value={editing.notes ?? ""} onChange={(e) => setEditing((p) => ({ ...p!, notes: e.target.value }))} />
          </div>

          <div className="flex gap-2">
            <Button disabled={pending} onClick={save}>{pending ? "Saving…" : "Save template"}</Button>
            <Button variant="ghost" disabled={pending} onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((t) => (
          <div key={t.id} className="flex flex-col gap-2 rounded-2xl border border-ik-rule bg-ik-card p-4 shadow-ik-card">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[14px] font-semibold text-ik-ink">{t.name}</span>
              <span className="text-[11px] uppercase tracking-wide text-ik-ink-3">{t.mealType.replace("_", " ")}</span>
            </div>
            <div className="text-[12.5px] text-ik-ink-2">
              {t.customerName} · {t.headcount} pax · {t.items.length} dish{t.items.length === 1 ? "" : "es"}
              {t.packageTotal && <> · ₹{t.packageTotal}</>}
            </div>
            <div className="flex flex-wrap gap-1">
              {t.items.slice(0, 4).map((it, i) => (
                <span key={i} className="rounded-full bg-ik-paper-alt px-2 py-0.5 text-[11px] text-ik-ink-2 ring-1 ring-ik-rule">{it.dishName}</span>
              ))}
              {t.items.length > 4 && <span className="text-[11px] text-ik-ink-3">+{t.items.length - 4} more</span>}
            </div>
            <div className="mt-auto flex items-center gap-2 pt-1">
              <Link href={`/orders/new?templateId=${t.id}`} className="flex-1">
                <Button className="w-full">Order from this →</Button>
              </Link>
              <Button variant="outline" size="sm" disabled={pending} onClick={() => setEditing(t)}>Edit</Button>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => remove(t.id, t.name)}>Remove</Button>
            </div>
          </div>
        ))}
        {templates.length === 0 && !editing && (
          <p className="text-[13px] text-ik-ink-3">No templates yet — create the first one for an order you place regularly.</p>
        )}
      </div>
    </div>
  );
}
