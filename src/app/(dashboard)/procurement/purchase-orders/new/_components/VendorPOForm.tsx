"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Decimal } from "decimal.js";
import type { BanquetItemSource } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { BANQUET_SOURCE_LABELS } from "@/lib/stock-movement";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResultWith } from "@/lib/action-result";

interface Vendor { id: string; name: string; code: string; stateCode: string }
interface Ingredient { id: string; sku: string; name: string; unit: string; gstRatePct: string }
interface BanquetItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  gstRatePct?: string;
  source: BanquetItemSource;
  /** In-house: Disposables / Crockery. Hired: Regulars / Melamine / Bonechina. */
  category: string | null;
  /** Hire charge / purchase rate per unit — two same-named grades differ only here. */
  rate: string | null;
}
interface OrderOption { id: string; code: string; customerName: string }

interface DraftLine {
  ingredientId: string;
  banquetItemId: string;
  /** Chef requisition line this PO line is buying for (?reqId= prefill). */
  chefReqLineId?: string | null;
  /** Banquet requisition line this PO line is buying for (?banquetReqId=). */
  banquetReqLineId?: string | null;
  /** Only prefilled rows carry this. false = shown but left off this PO, so
   *  the item stays on the requisition for a second supplier's PO. */
  included?: boolean;
  sku: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  gstRatePct: string;
}

interface Props {
  vendors: Vendor[];
  ingredients: Ingredient[];
  banquetItems?: BanquetItem[];
  /** Optional "For order" picker — links the PO to the catering order it's
   *  buying for (shown on the PO detail/list). */
  orders?: OrderOption[];
  initialOrderId?: string | null;
  onSubmit: (input: {
    vendorId: string;
    orderId: string | null;
    procurementType: "STANDARD" | "LOCAL" | "ONLINE";
    placeOfSupplyStateCode: string;
    expectedDate: string | undefined;
    notes: string | null;
    lines: Array<{ ingredientId: string | null; banquetItemId: string | null; chefReqLineId: string | null; banquetReqLineId: string | null; sku: string; description: string; unit: string; quantity: string; unitPrice: string; gstRatePct: string }>;
    /** Prefilled rows were left off this PO — the caller skips its redirect
     *  and returns the new PO id so we can offer the next one. */
    moreToOrder?: boolean;
  }) => Promise<ActionResultWith<{ id?: string }> | void>;
  // Pre-fill when the PO is being spun out of an approved PR — the lines
  // come straight from the request so the user only has to fill in prices.
  initialVendorId?: string | null;
  initialLines?: DraftLine[] | null;
  // Inline vendor creator — lets the store add a brand-new supplier (e.g. for
  // a one-off online order) without leaving the PO form.
  onQuickAddVendor?: (input: { name: string; stateCode: string }) => Promise<
    | { ok: true; id: string; name: string; code: string; stateCode: string }
    | { ok: false; error: string }
  >;
  /** Admin/manager only: allow a non-catalogue (free text) line, e.g.
   *  transport charges. Everyone else must pick items from the dropdown —
   *  free-typed items are where the duplicate catalogue entries came from. */
  canFreeText?: boolean;
  /** The ?reqId=/?banquetReqId= URL this prefill came from — offered again
   *  after saving when some prefilled rows were left for another supplier. */
  requisitionHref?: string | null;
}

function emptyLine(): DraftLine {
  return { ingredientId: "", banquetItemId: "", chefReqLineId: null, banquetReqLineId: null, sku: "", description: "", unit: "kg", quantity: "1", unitPrice: "0", gstRatePct: "5" };
}

export function VendorPOForm({ vendors, ingredients, banquetItems = [], orders = [], initialOrderId, onSubmit, initialVendorId, initialLines, onQuickAddVendor, canFreeText = false, requisitionHref = null }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [vendorOptions, setVendorOptions] = useState(vendors);
  const [vendorId, setVendorId] = useState(initialVendorId || "");
  const [orderId, setOrderId] = useState(initialOrderId || "");
  const [procurementType, setProcurementType] = useState<"STANDARD" | "LOCAL" | "ONLINE">("STANDARD");
  // Inline "add vendor" toggle.
  const [addingVendor, setAddingVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");
  const [newVendorState, setNewVendorState] = useState("29");
  const [addingVendorBusy, setAddingVendorBusy] = useState(false);

  async function saveNewVendor() {
    if (!onQuickAddVendor) return;
    if (newVendorName.trim().length < 2) return toast.error("Enter the vendor name");
    setAddingVendorBusy(true);
    try {
      const v = await onQuickAddVendor({ name: newVendorName.trim(), stateCode: newVendorState.trim() || "29" });
      if (!v.ok) {
        toast.error(v.error);
        return;
      }
      setVendorOptions((prev) => [{ id: v.id, name: v.name, code: v.code, stateCode: v.stateCode }, ...prev]);
      setVendorId(v.id);
      setAddingVendor(false);
      setNewVendorName("");
      toast.success(`Vendor ${v.name} added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add vendor");
    } finally {
      setAddingVendorBusy(false);
    }
  }
  const [placeOfSupplyStateCode, setPos] = useState("29");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  // Prefilled rows arrive ticked, so "order the lot from one supplier" is
  // unchanged. Unticking leaves the row on screen (and on the requisition)
  // but off this PO — that's how one requisition is split across suppliers.
  const [lines, setLines] = useState<DraftLine[]>(
    initialLines && initialLines.length > 0
      ? initialLines.map((l) => ({ ...l, included: true }))
      : [emptyLine()],
  );
  // `included` is defined on prefilled rows only; manual rows always go on.
  const prefilledCount = lines.filter((l) => l.included !== undefined).length;
  const onThisPO = lines.filter((l) => l.included === true).length;
  const leftForLater = prefilledCount - onThisPO;
  // Set on a split save, where the server hands back the id instead of
  // redirecting — see the panel this renders below.
  const [createdPOId, setCreatedPOId] = useState<string | null>(null);

  const totals = useMemo(() => {
    let subtotal = new Decimal(0);
    let tax = new Decimal(0);
    for (const l of lines) {
      if (l.included === false) continue;
      const q = new Decimal(l.quantity || "0");
      const u = new Decimal(l.unitPrice || "0");
      const g = new Decimal(l.gstRatePct || "0").div(100);
      const s = q.times(u);
      subtotal = subtotal.plus(s);
      tax = tax.plus(s.times(g));
    }
    return { subtotal: subtotal.toDecimalPlaces(2), tax: tax.toDecimalPlaces(2), total: subtotal.plus(tax).toDecimalPlaces(2) };
  }, [lines]);

  // The option value is type-prefixed so the two catalogues don't collide:
  // "ing:<id>" (kitchen), "bq:<id>" (banquet), "" (free text). A line links to
  // EITHER an ingredient OR a banquet item, never both.
  function pickItem(idx: number, value: string) {
    const ing = value.startsWith("ing:") ? ingredients.find((i) => i.id === value.slice(4)) : undefined;
    const bq = value.startsWith("bq:") ? banquetItems.find((b) => b.id === value.slice(3)) : undefined;
    setLines((p) => p.map((x, i) => {
      if (i !== idx) return x;
      // Changing the item breaks any requisition back-link the prefill
      // carried (kitchen or F&B) — the requisition line must not end up tied
      // to a PO line buying a different item.
      if (ing) {
        return { ...x, ingredientId: ing.id, banquetItemId: "", chefReqLineId: null, banquetReqLineId: null, sku: ing.sku, description: ing.name, unit: ing.unit, gstRatePct: ing.gstRatePct };
      }
      if (bq) {
        // Banquet items don't carry GST in the catalogue — keep the line's
        // current rate (bq.gstRatePct if a caller ever provides one).
        return { ...x, ingredientId: "", banquetItemId: bq.id, chefReqLineId: null, banquetReqLineId: null, sku: bq.sku, description: bq.name, unit: bq.unit, gstRatePct: bq.gstRatePct ?? x.gstRatePct };
      }
      // Free text — clear both ids, leave sku/description as typed.
      return { ...x, ingredientId: "", banquetItemId: "", chefReqLineId: null, banquetReqLineId: null };
    }));
  }

  // Combobox has no optgroups, so the Kitchen/Banquet split is carried as a
  // label prefix — and it filters on the label, so "hired" or "bonechina"
  // narrows the list the same way the source dropdown does on the F&B forms.
  // Value encoding is unchanged: "ing:<id>" / "bq:<id>" / "".
  //
  // F&B labels carry source, grade and rate because the name does not
  // identify the item: "soup bowl" is in-house, hired-Melamine and
  // hired-Bonechina at three different rates, and a PO must buy the one the
  // requisition was short of.
  const itemOptions: ComboOption[] = useMemo(() => [
    ...(canFreeText ? [{ value: "", label: "— free text —" }] : []),
    ...ingredients.map((i) => ({ value: `ing:${i.id}`, label: `Kitchen · ${i.sku} · ${i.name}` })),
    ...banquetItems.map((b) => ({
      value: `bq:${b.id}`,
      label: [
        `F&B · ${BANQUET_SOURCE_LABELS[b.source]}`,
        b.sku,
        b.name,
        b.category,
        b.rate ? `₹${b.rate}` : null,
      ].filter(Boolean).join(" · "),
    })),
  ], [ingredients, banquetItems, canFreeText]);

  const vendorComboOptions: ComboOption[] = useMemo(
    () => vendorOptions.map((v) => ({ value: v.id, label: `${v.code} · ${v.name}` })),
    [vendorOptions],
  );

  // Live duplicate check while typing a "new" supplier — compares the way the
  // server does (trimmed, case-insensitive) so the warning always matches the
  // record that would be reused.
  const duplicateVendor = useMemo(() => {
    const typed = newVendorName.trim().toLowerCase();
    if (typed.length < 2) return null;
    return vendorOptions.find((v) => v.name.trim().toLowerCase() === typed) ?? null;
  }, [newVendorName, vendorOptions]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendorId) return toast.error("Pick a vendor");
    // Unticked rows are left for another supplier's PO; of the rest, rows
    // that are entirely empty are ignored, but a row with content and a
    // missing/zero quantity is an error, not a silent drop.
    const touched = lines.filter(
      (l) => l.included !== false && (l.description.trim() || l.sku.trim() || l.quantity.trim() || l.unitPrice.trim()),
    );
    for (const l of touched) {
      if (!canFreeText && !l.ingredientId && !l.banquetItemId) {
        return toast.error("Pick each item from the list — free-typed items aren't allowed.");
      }
      if (!l.description.trim()) return toast.error("A line is missing its description");
      const q = Number(l.quantity);
      if (!l.quantity.trim() || Number.isNaN(q) || q <= 0) {
        return toast.error(`"${l.description.trim()}": enter a quantity above 0`);
      }
      if (l.unitPrice.trim() && Number.isNaN(Number(l.unitPrice))) {
        return toast.error(`"${l.description.trim()}": the unit price isn't a number`);
      }
    }
    const payload = touched.map((l) => ({
      ...l,
      quantity: l.quantity.trim(),
      unitPrice: l.unitPrice.trim() || "0",
      gstRatePct: (l.gstRatePct ?? "").trim() || "0",
    }));
    if (payload.length === 0) {
      return toast.error(
        prefilledCount > 0
          ? "Nothing is ticked — tick the items going on this purchase order, or add a line."
          : "Add at least one line",
      );
    }
    // Only worth staying on the page when there is a requisition to go back
    // to for the rest (the low-stock prefill has none).
    const moreToOrder = leftForLater > 0 && !!requisitionHref;
    startTransition(async () => {
      try {
        const res = await onSubmit({
          moreToOrder,
          vendorId,
          orderId: orderId || null,
          procurementType,
          placeOfSupplyStateCode,
          expectedDate: expectedDate || undefined,
          notes: notes || null,
          lines: payload.map((l) => ({
            ingredientId: l.ingredientId || null,
            banquetItemId: l.banquetItemId || null,
            chefReqLineId: l.chefReqLineId || null,
            banquetReqLineId: l.banquetReqLineId || null,
            sku: l.sku,
            description: l.description,
            unit: l.unit,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            gstRatePct: l.gstRatePct,
          })),
        });
        if (res && !res.ok) {
          toast.error(res.error);
          return;
        }
        // A split save returns instead of redirecting: show where to go next.
        if (res && res.ok && res.id) setCreatedPOId(res.id);
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  if (createdPOId && requisitionHref) {
    const nextPOHref = requisitionHref;
    return (
      <div className="mx-auto grid max-w-4xl gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 sm:p-5">
        <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">Purchase order created</h3>
        <p className="text-[13px] text-ik-ink-2">
          {onThisPO} item{onThisPO === 1 ? "" : "s"} {onThisPO === 1 ? "is" : "are"} on it. The other{" "}
          {leftForLater} {leftForLater === 1 ? "is" : "are"} still on the requisition — raise the next
          purchase order for {leftForLater === 1 ? "it" : "them"} with the other supplier.
        </p>
        <div className="flex flex-wrap gap-2">
          {/* Full page load, not router.push: this is the URL we are already
              on, and a soft navigation would re-use the cached pre-fill and
              offer the items we just ordered a second time. */}
          <Button type="button" onClick={() => { window.location.href = nextPOHref; }}>
            Raise the next PO for the remaining {leftForLater}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(`/procurement/purchase-orders/${createdPOId}`)}>
            View the PO just created
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto grid max-w-4xl gap-4">
      <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 sm:p-5">
        <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">Supplier</h3>
        {/* Vendor gets its own full-width row — the name is the most
            important field here and was being truncated in the old
            three-up grid. */}
        <div className="grid gap-1">
          <Label htmlFor="vendorId">Vendor<span className="text-gold" aria-hidden> *</span></Label>
          {/* Searchable, like the ingredient picker below. A plain dropdown of
              every supplier was unusable on a phone, so staff reached for
              "+ Add new vendor" instead of scrolling — which is where the
              duplicate suppliers came from. */}
          <Combobox
            options={vendorComboOptions}
            value={vendorId}
            onChange={setVendorId}
            placeholder="Type to search a supplier…"
          />
          <div className="flex items-center justify-between">
            <p className="text-[11.5px] text-ik-ink-3">Who you&apos;re buying from. Search by name or code, then set their prices below.</p>
            {onQuickAddVendor && !addingVendor && (
              <button type="button" className="text-[11.5px] text-brand hover:underline" onClick={() => setAddingVendor(true)}>
                + Add new vendor
              </button>
            )}
          </div>
          {onQuickAddVendor && addingVendor && (
            <div className="grid gap-2 rounded-md border border-brand-200 bg-brand-50 p-3 sm:grid-cols-[1fr,120px,auto]">
              <div className="grid gap-1">
                <Label htmlFor="newVendorName">New vendor name</Label>
                <Input id="newVendorName" value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} placeholder="e.g. Amazon Business" />
                {/* Catch the duplicate before it's created, not after. */}
                {duplicateVendor && (
                  <button
                    type="button"
                    className="text-left text-[11.5px] font-medium text-amber-700 hover:underline"
                    onClick={() => {
                      setVendorId(duplicateVendor.id);
                      setAddingVendor(false);
                      setNewVendorName("");
                    }}
                  >
                    “{duplicateVendor.name}” already exists — tap to use it instead of adding a copy.
                  </button>
                )}
              </div>
              <div className="grid gap-1">
                <Label htmlFor="newVendorState">State code</Label>
                <Input id="newVendorState" maxLength={2} value={newVendorState} onChange={(e) => setNewVendorState(e.target.value)} />
              </div>
              <div className="flex items-end gap-2">
                <Button type="button" size="sm" disabled={addingVendorBusy} onClick={saveNewVendor}>{addingVendorBusy ? "Adding…" : "Add"}</Button>
                <Button type="button" size="sm" variant="ghost" disabled={addingVendorBusy} onClick={() => setAddingVendor(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
        <div className="grid gap-1">
          <Label htmlFor="procurementType">Procurement type</Label>
          <select
            id="procurementType"
            value={procurementType}
            onChange={(e) => setProcurementType(e.target.value as "STANDARD" | "LOCAL" | "ONLINE")}
            className="h-9 w-full rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
          >
            <option value="STANDARD">Standard (vendor PO)</option>
            <option value="LOCAL">Local purchase</option>
            <option value="ONLINE">Online order</option>
          </select>
          <p className="text-[11.5px] text-ik-ink-3">
            Approval by value: under ₹5,000 the manager signs off; ₹5,000 and above needs admin.
          </p>
        </div>
        {orders.length > 0 && (
          <div className="grid gap-1">
            <Label htmlFor="forOrder">For order (optional)</Label>
            <Combobox
              value={orderId}
              onChange={setOrderId}
              options={[
                { value: "", label: "— not for a specific order —" },
                ...orders.map((o) => ({ value: o.id, label: `${o.code} · ${o.customerName}` })),
              ]}
              placeholder="Type an order code or customer…"
              emptyText="No order matches"
            />
            <p className="text-[11.5px] text-ik-ink-3">
              Link this purchase to the catering order it&apos;s buying for — it then shows on the PO.
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="pos">Place of supply (state code)</Label>
            <Input id="pos" maxLength={2} value={placeOfSupplyStateCode} onChange={(e) => setPos(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="expectedDate">Expected by</Label>
            <Input id="expectedDate" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="font-medium text-[14px] text-ik-ink">Lines</h3>
            {prefilledCount > 0 && (
              <span className="text-[11.5px] text-ik-ink-3">
                {onThisPO} of {prefilledCount} item{prefilledCount === 1 ? "" : "s"} on this order
                {leftForLater > 0 ? ` — ${leftForLater} left for another supplier` : ""}
              </span>
            )}
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => setLines((p) => [...p, emptyLine()])}>+ Add line</Button>
        </div>
        <p className="mb-3 rounded border border-ik-rule bg-ik-paper-alt p-2 text-[11.5px] text-ik-ink-2">
          <strong>About the prices:</strong> the <em>Est. unit ₹</em> and <em>GST %</em> are an
          estimate — they pre-fill from each ingredient&apos;s last paid cost so the system can compute a
          total and decide whether the manager or admin needs to approve. The supplier&apos;s actual price
          is captured later, when you record their bill against the delivery. Leave a row at 0 if you
          have no estimate.
        </p>
        <div className="overflow-x-auto">
          {/* min-w so the wrapper above actually scrolls. Without it the
              table squeezes to the viewport and the three numeric columns —
              the only ones being typed into — collapse to a few pixels,
              because the item picker and description soak up the width. */}
          <table className="w-full min-w-[1080px] text-[12.5px]">
            <thead className="border-b border-ik-rule text-left text-ik-ink-3">
              <tr>
                {prefilledCount > 0 && (
                  <th className="w-8 whitespace-nowrap py-1 pr-2" title="Tick the items going on this purchase order">On PO</th>
                )}
                <th className="py-1 pr-2">Ingredient (optional)</th>
                <th className="py-1 pr-2">SKU</th>
                <th className="py-1 pr-2">Description</th>
                <th className="py-1 pr-2">Unit</th>
                <th className="w-24 min-w-[88px] py-1 pr-2 text-right">Qty</th>
                <th className="w-28 min-w-[104px] py-1 pr-2 text-right" title="Estimated supplier rate — used to compute approval tier. Actual rate comes from the bill at delivery.">Est. unit ₹</th>
                <th className="w-20 min-w-[76px] py-1 pr-2 text-right">GST %</th>
                <th className="w-28 py-1 pr-2 text-right">Est. total ₹</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const sub = new Decimal(l.quantity || "0").times(new Decimal(l.unitPrice || "0"));
                const tax = sub.times(new Decimal(l.gstRatePct || "0").div(100));
                return (
                  <tr key={idx} className={"border-b border-ik-rule" + (l.included === false ? " opacity-50" : "")}>
                    {prefilledCount > 0 && (
                      <td className="py-1 pr-2">
                        {l.included !== undefined && (
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={l.included}
                            aria-label={`Put ${l.description || "this item"} on this purchase order`}
                            onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, included: e.target.checked } : x))}
                          />
                        )}
                      </td>
                    )}
                    <td className="py-1 pr-2 min-w-[220px]">
                      <Combobox
                        value={l.banquetItemId ? `bq:${l.banquetItemId}` : l.ingredientId ? `ing:${l.ingredientId}` : ""}
                        onChange={(v) => pickItem(idx, v)}
                        options={itemOptions}
                        placeholder="Type to search an item…"
                        emptyText="No item matches"
                      />
                    </td>
                    {/* Catalogue lines are the catalogue's words: sku, name and
                        UNIT come from the picked item and cannot be edited here
                        — mixed-up units ("pkt" bought as "kg") are what corrupted
                        stock. Only an admin/manager free-text line types these. */}
                    {(() => {
                      const locked = !canFreeText || l.ingredientId !== "" || l.banquetItemId !== "";
                      return (
                        <>
                          <td className="py-1 pr-2 font-mono text-[12px] text-ik-ink-3">
                            {locked ? (l.sku || "—") : (
                              <input value={l.sku} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, sku: e.target.value } : x))} className="h-8 w-20 rounded border border-ik-rule bg-ik-card px-1 font-mono" />
                            )}
                          </td>
                          <td className="py-1 pr-2">
                            {locked ? <span className="text-[12.5px] text-ik-ink">{l.description || "— pick an item —"}</span> : (
                              <input value={l.description} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1" />
                            )}
                          </td>
                          <td className="py-1 pr-2 text-[12.5px] text-ik-ink-2">
                            {locked ? (l.unit || "—") : (
                              <input value={l.unit} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x))} className="h-8 w-12 rounded border border-ik-rule bg-ik-card px-1" />
                            )}
                          </td>
                        </>
                      );
                    })()}
                    <td className="w-24 min-w-[88px] py-1 pr-2"><input type="number" step="any" min="0.001" value={l.quantity} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1.5 text-right font-mono" /></td>
                    <td className="w-28 min-w-[104px] py-1 pr-2"><input type="number" step="0.01" min="0" value={l.unitPrice} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, unitPrice: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1.5 text-right font-mono" /></td>
                    <td className="w-20 min-w-[76px] py-1 pr-2"><input type="number" step="0.01" min="0" value={l.gstRatePct} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, gstRatePct: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1.5 text-right font-mono" /></td>
                    <td className="py-1 pr-2 text-right font-mono">{sub.plus(tax).toDecimalPlaces(2).toString()}</td>
                    {/* Prefilled rows are un-ticked, not deleted — the item
                        has to stay visible so it can go on the next PO. */}
                    <td>{l.included === undefined && <button type="button" className="text-alert" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}>×</button>}</td>
                  </tr>
                );
              })}
            </tbody>
            {/* Totals cover the ticked rows only — they set the approval tier,
                so an un-ticked row must not inflate them. */}
            <tfoot className="font-mono">
              <tr><td colSpan={prefilledCount > 0 ? 8 : 7} className="py-1 pr-2 text-right text-ik-ink-3">Est. subtotal</td><td className="py-1 pr-2 text-right">{totals.subtotal.toString()}</td><td></td></tr>
              <tr><td colSpan={prefilledCount > 0 ? 8 : 7} className="py-1 pr-2 text-right text-ik-ink-3">Est. tax</td><td className="py-1 pr-2 text-right">{totals.tax.toString()}</td><td></td></tr>
              <tr className="font-medium"><td colSpan={prefilledCount > 0 ? 8 : 7} className="py-1 pr-2 text-right">Est. total</td><td className="py-1 pr-2 text-right">₹{totals.total.toString()}</td><td></td></tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className="grid gap-1 max-w-2xl">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {requisitionHref && prefilledCount > 0 && (
        <p className="max-w-2xl rounded-md border border-amber bg-amber-wash p-2 text-[12px] text-ik-ink-2">
          {leftForLater > 0 ? (
            <>
              Only the {onThisPO} ticked item{onThisPO === 1 ? "" : "s"} go on this purchase order. The
              other {leftForLater} stay on the requisition — after you create this PO you can raise a
              second one for {leftForLater === 1 ? "it" : "them"} with the other supplier straight away.
            </>
          ) : (
            <>
              All {prefilledCount} item{prefilledCount === 1 ? "" : "s"} go on this purchase order.
              Buying some of them from a different supplier? Untick those rows — they stay on the
              requisition and you raise a second PO for them right after this one.
            </>
          )}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create draft PO"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
