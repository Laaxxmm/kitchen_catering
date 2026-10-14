import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Role, type StoreDepartment } from "@prisma/client";
import { Decimal } from "decimal.js";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pill } from "@/components/ik/Pill";
import { gateRolePage } from "@/server/rbac";
import {
  getDeptPurchaseOrder,
  listDeptItemsForPurchase,
  listDeptPurchaseOrders,
} from "@/server/actions/dept-purchase";
import { formatIST } from "@/lib/time";
import { formatINR } from "@/lib/money";
import { indefineAddress, indefineCompanyName } from "@/lib/org";
import { DEPT, LIST_TABS, STATUS } from "./meta";
import { PurchaseForm, type PickItem } from "./PurchaseForm";
import { PrintButton, PurchaseActions } from "./PurchaseActions";

// Server halves of the department stock request / PO screens. The route
// files under /housekeeping/purchase and /maintenance/purchase are one-line
// wrappers that pass their department in; the gate and the department
// check live here, once.

type Dept = { department: StoreDepartment };
type IdParams = Dept & { params: Promise<{ id: string }> };

const CARD = "rounded-2xl border border-ik-rule bg-ik-card p-4 shadow-ik-card";

function gate(department: StoreDepartment) {
  const head = department === "HOUSEKEEPING" ? Role.HOUSEKEEPING_MANAGER : Role.MAINTENANCE_MANAGER;
  return gateRolePage([Role.ADMIN, Role.MANAGER, head]);
}

/** The order, or a 404 — also for a valid order of the other department. */
async function loadPo(department: StoreDepartment, id: string) {
  const res = await getDeptPurchaseOrder(id);
  if (!res.ok || res.po.department !== department) notFound();
  return res.po;
}
type Po = Awaited<ReturnType<typeof loadPo>>;

const dec = (v: { toString(): string } | null | undefined) => new Decimal(v ? v.toString() : 0);
const approvedOf = (l: Po["lines"][number]) => dec(l.approvedQty ?? l.quantity);

function StatusPill({ status }: { status: Po["status"] }) {
  return (
    <Pill tone={STATUS[status].tone} dot>
      {STATUS[status].label}
    </Pill>
  );
}

const back = (href: string, label = "← Back") => (
  <Link href={href}>
    <Button variant="outline" size="sm">
      {label}
    </Button>
  </Link>
);

// ─── List ───────────────────────────────────────────────────────────────

export async function DeptPurchaseListPage({
  department,
  searchParams,
}: Dept & { searchParams: Promise<{ tab?: string }> }) {
  await gate(department);
  const { tab: tabKey } = await searchParams;
  const tab = LIST_TABS.find((t) => t.key === tabKey) ?? LIST_TABS[0];
  const pos = await listDeptPurchaseOrders({ department, status: tab.statuses });
  const d = DEPT[department];

  return (
    <>
      <PageHeader
        eyebrow={d.label}
        title="Stock requests & POs"
        description="Ask for stock, get it approved by an admin or manager, place the order and receive it into the store."
        actions={
          <div className="flex gap-2">
            <Link href={`${d.base}/purchase/new`}>
              <Button>+ New request</Button>
            </Link>
            {back(d.base)}
          </div>
        }
      />
      <nav className="mb-4 flex flex-wrap gap-1.5">
        {LIST_TABS.map((t) => (
          <Link
            key={t.key}
            href={`${d.base}/purchase?tab=${t.key}`}
            className={`rounded-full border px-3 py-1 text-[12.5px] ${
              t.key === tab.key ? "border-brand bg-brand-50 text-brand-700" : "border-ik-rule text-ik-ink-2 hover:bg-ik-card"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {pos.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">Nothing here.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO no</TableHead>
              <TableHead>Raised</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Est. total</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pos.map((po) => (
              <TableRow key={po.id}>
                <TableCell>
                  <Link href={`${d.base}/purchase/${po.id}`} className="font-mono text-[12.5px] text-brand hover:underline">
                    {po.number}
                  </Link>
                </TableCell>
                <TableCell className="text-[12.5px]">
                  {formatIST(po.createdAt, "dd MMM yyyy")}
                  <div className="text-[11.5px] text-ik-ink-3">{po.createdBy.name}</div>
                </TableCell>
                <TableCell className="max-w-[320px] text-[12.5px]">{po.reason}</TableCell>
                <TableCell className="text-[12.5px]">{po.supplierName ?? "—"}</TableCell>
                <TableCell className="text-right">{po._count.lines}</TableCell>
                <TableCell className="text-right font-mono text-[12.5px]">{formatINR(po.estimatedTotal)}</TableCell>
                <TableCell>
                  <StatusPill status={po.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

// ─── New / edit ─────────────────────────────────────────────────────────

async function pickItems(department: StoreDepartment): Promise<PickItem[]> {
  const items = await listDeptItemsForPurchase(department);
  return items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, currentStock: i.currentStock.toString() }));
}

function NoItems({ department }: Dept) {
  return (
    <p className="text-[13px] text-ik-ink-3">
      No items in the {DEPT[department].label.toLowerCase()} store yet.{" "}
      <Link href={`${DEPT[department].base}/items`} className="text-brand hover:underline">
        Add some first
      </Link>
      .
    </p>
  );
}

export async function DeptPurchaseNewPage({ department }: Dept) {
  await gate(department);
  const items = await pickItems(department);
  const d = DEPT[department];
  return (
    <>
      <PageHeader
        eyebrow={d.label}
        title="New stock request"
        description="An admin or manager approves it; then you place the order and receive the goods."
        actions={back(`${d.base}/purchase`)}
      />
      {items.length === 0 ? <NoItems department={department} /> : <PurchaseForm department={department} items={items} />}
    </>
  );
}

export async function DeptPurchaseEditPage({ department, params }: IdParams) {
  await gate(department);
  const { id } = await params;
  const po = await loadPo(department, id);
  const d = DEPT[department];
  if (po.status !== "DRAFT") redirect(`${d.base}/purchase/${po.id}`);
  const items = await pickItems(department);
  return (
    <>
      <PageHeader eyebrow={d.label} title={`Edit ${po.number}`} actions={back(`${d.base}/purchase/${po.id}`)} />
      <PurchaseForm
        department={department}
        items={items}
        initial={{
          id: po.id,
          reason: po.reason,
          supplierName: po.supplierName ?? "",
          supplierPhone: po.supplierPhone ?? "",
          expectedAt: po.expectedAt ? formatIST(po.expectedAt, "yyyy-MM-dd") : "",
          notes: po.notes ?? "",
          lines: po.lines.map((l) => ({
            itemId: l.hkItemId ?? l.mtItemId ?? "",
            quantity: l.quantity.toString(),
            rate: l.rate?.toString() ?? "",
          })),
        }}
      />
    </>
  );
}

// ─── Detail ─────────────────────────────────────────────────────────────

export async function DeptPurchaseDetailPage({ department, params }: IdParams) {
  const session = await gate(department);
  const { id } = await params;
  const po = await loadPo(department, id);
  const d = DEPT[department];
  const canDecide = session.user.role === Role.ADMIN || session.user.role === Role.MANAGER;
  const decided = po.status !== "DRAFT" && po.status !== "PENDING_APPROVAL" && po.decidedAt != null;
  const tracking = ["APPROVED", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(po.status);
  const lineName = new Map(po.lines.map((l) => [l.id, l.itemName]));

  const facts: Array<[string, React.ReactNode]> = [
    ["Status", <StatusPill key="s" status={po.status} />],
    ["Raised", `${formatIST(po.createdAt, "dd MMM yyyy, HH:mm")} by ${po.createdBy.name}`],
    ["Submitted", po.submittedAt ? formatIST(po.submittedAt, "dd MMM yyyy, HH:mm") : "—"],
    [
      po.status === "REJECTED" ? "Rejected" : "Approved",
      po.decidedAt ? `${formatIST(po.decidedAt, "dd MMM yyyy, HH:mm")} by ${po.decidedBy?.name ?? "—"}` : "—",
    ],
    ["Supplier", [po.supplierName, po.supplierPhone].filter(Boolean).join(" · ") || "—"],
    ["Needed / expected", po.expectedAt ? formatIST(po.expectedAt, "dd MMM yyyy") : "—"],
    ["Ordered", po.orderedAt ? formatIST(po.orderedAt, "dd MMM yyyy, HH:mm") : "—"],
    ["Est. total", formatINR(po.estimatedTotal)],
  ];

  return (
    <>
      <PageHeader
        eyebrow={`${d.label} · Stock request`}
        title={po.number}
        description={po.reason}
        actions={back(`${d.base}/purchase`, "← All requests")}
      />
      <div className="grid gap-4">
        <section className={CARD}>
          <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-wide text-ik-ink-3">{k}</dt>
                <dd className="text-ik-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {po.decisionNote && (
            <p className="mt-3 rounded bg-ik-paper-alt p-2 text-[12.5px] text-ik-ink-2">
              <strong>Approver&apos;s note:</strong> {po.decisionNote}
            </p>
          )}
          {po.notes && <p className="mt-3 whitespace-pre-line text-[12.5px] text-ik-ink-2">{po.notes}</p>}
        </section>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Asked</TableHead>
              <TableHead className="text-right">Approved</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead className="text-right">Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {po.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-[13px]">
                  {l.itemName} <span className="text-ik-ink-3">({l.unit})</span>
                </TableCell>
                <TableCell className="text-right font-mono text-[12.5px]">{l.quantity.toString()}</TableCell>
                <TableCell className="text-right font-mono text-[12.5px]">{decided ? approvedOf(l).toString() : "—"}</TableCell>
                <TableCell className="text-right font-mono text-[12.5px]">{l.receivedQty.toString()}</TableCell>
                <TableCell className="text-right font-mono text-[12.5px]">
                  {tracking ? approvedOf(l).minus(dec(l.receivedQty)).toString() : "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-[12.5px]">{l.rate ? formatINR(l.rate) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <PurchaseActions
          id={po.id}
          department={department}
          status={po.status}
          canDecide={canDecide}
          supplierName={po.supplierName ?? ""}
          supplierPhone={po.supplierPhone ?? ""}
          expectedAt={po.expectedAt ? formatIST(po.expectedAt, "yyyy-MM-dd") : ""}
          lines={po.lines.map((l) => ({
            id: l.id,
            itemName: l.itemName,
            unit: l.unit,
            quantity: l.quantity.toString(),
            remaining: approvedOf(l).minus(dec(l.receivedQty)).toString(),
            rate: l.rate?.toString() ?? null,
          }))}
        />

        {po.receipts.length > 0 && (
          <section className="grid gap-2">
            <h2 className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Goods received against this PO</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Bill no</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Recorded by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {po.receipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-[12px]">{formatIST(r.receivedAt, "dd MMM yyyy, HH:mm")}</TableCell>
                    <TableCell className="text-[12.5px]">{r.supplierBillNo ?? "—"}</TableCell>
                    <TableCell className="text-[12.5px]">
                      <ul className="grid gap-0.5">
                        {r.lines.map((rl) => (
                          <li key={rl.id}>
                            {(rl.poLineId && lineName.get(rl.poLineId)) || rl.item.name} —{" "}
                            <span className="font-mono">
                              {rl.quantity.toString()} {rl.item.unit}
                            </span>
                            {rl.costPerUnit && <span className="text-ik-ink-3"> @ {formatINR(rl.costPerUnit)}</span>}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell className="text-[12.5px]">{r.recordedBy.name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        )}
      </div>
    </>
  );
}

// ─── Print ──────────────────────────────────────────────────────────────

// Only the PO prints: the dashboard shell around it is hidden on paper.
const PRINT_CSS = `@media print {
  body * { visibility: hidden; }
  #dept-po-print, #dept-po-print * { visibility: visible; }
  #dept-po-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0; border: 0; box-shadow: none; }
}`;

export async function DeptPurchasePrintPage({ department, params }: IdParams) {
  await gate(department);
  const { id } = await params;
  const po = await loadPo(department, id);
  const d = DEPT[department];
  const approved = po.decidedAt != null && po.status !== "REJECTED" && po.status !== "PENDING_APPROVAL";
  const rows = po.lines
    .map((l) => ({ l, qty: approved ? approvedOf(l) : dec(l.quantity) }))
    .filter((r) => r.qty.gt(0));
  const total = rows.reduce((s, r) => (r.l.rate ? s.plus(r.qty.times(dec(r.l.rate))) : s), new Decimal(0));
  const dated = po.orderedAt ?? po.decidedAt ?? po.createdAt;

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="mb-3 flex gap-2 print:hidden">
        <PrintButton />
        {back(`${d.base}/purchase/${po.id}`)}
      </div>
      <article id="dept-po-print" className={`${CARD} mx-auto max-w-3xl bg-white text-[13px] text-black`}>
        <header className="flex flex-wrap justify-between gap-4 border-b border-ik-rule pb-3">
          <div>
            <div className="text-[17px] font-semibold">{indefineCompanyName()}</div>
            <div className="whitespace-pre-line text-[12px]">{indefineAddress()}</div>
          </div>
          <div className="text-right">
            <div className="text-[17px] font-semibold tracking-wide">PURCHASE ORDER</div>
            <div className="font-mono">{po.number}</div>
            <div>Date: {formatIST(dated, "dd MMM yyyy")}</div>
            <div>{d.label} department</div>
          </div>
        </header>
        {!approved && (
          <p className="mt-3 rounded border border-red-400 p-2 text-[12.5px] font-semibold text-red-700">
            NOT APPROVED — {STATUS[po.status].label}. Not valid as a purchase order.
          </p>
        )}
        <section className="mt-3 grid gap-1 sm:grid-cols-2">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Supplier</div>
            <div>{po.supplierName ?? "—"}</div>
            {po.supplierPhone && <div>{po.supplierPhone}</div>}
          </div>
          <div className="sm:text-right">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Expected by</div>
            <div>{po.expectedAt ? formatIST(po.expectedAt, "dd MMM yyyy") : "—"}</div>
          </div>
        </section>
        <table className="mt-4 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">Item</th>
              <th className="py-1 pr-2">Unit</th>
              <th className="py-1 pr-2 text-right">Qty</th>
              <th className="py-1 pr-2 text-right">Rate</th>
              <th className="py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ l, qty }, i) => (
              <tr key={l.id} className="border-b border-gray-200">
                <td className="py-1 pr-2">{i + 1}</td>
                <td className="py-1 pr-2">{l.itemName}</td>
                <td className="py-1 pr-2">{l.unit}</td>
                <td className="py-1 pr-2 text-right font-mono">{qty.toString()}</td>
                <td className="py-1 pr-2 text-right font-mono">{l.rate ? formatINR(l.rate) : "—"}</td>
                <td className="py-1 text-right font-mono">{l.rate ? formatINR(qty.times(dec(l.rate)).toString()) : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="pt-2 text-right font-semibold">
                Estimated total
              </td>
              <td className="pt-2 text-right font-mono font-semibold">{formatINR(total.toString())}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-3 text-[12px]">
          <strong>Reason:</strong> {po.reason}
        </p>
        {po.notes && <p className="mt-1 whitespace-pre-line text-[12px]">{po.notes}</p>}
        <footer className="mt-8 grid grid-cols-2 gap-6 text-[12px]">
          <div>
            Requested by <strong>{po.createdBy.name}</strong>
            <div>{formatIST(po.createdAt, "dd MMM yyyy")}</div>
          </div>
          <div className="text-right">
            {approved ? (
              <>
                Approved by <strong>{po.decidedBy?.name ?? "—"}</strong>
                <div>{po.decidedAt ? formatIST(po.decidedAt, "dd MMM yyyy") : ""}</div>
              </>
            ) : (
              "Not approved"
            )}
          </div>
        </footer>
      </article>
    </>
  );
}
