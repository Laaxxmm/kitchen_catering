import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerInvoiceStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCustomerGroups } from "@/server/actions/customer-groups";
import { deactivateCustomer, getCustomer, reactivateCustomer, updateCustomer } from "@/server/actions/customers";
import { listCustomerInvoicesForCustomer } from "@/server/actions/customer-invoices";
import { listOrders } from "@/server/actions/orders";
import { CustomerForm } from "../_components/CustomerForm";
import { CustomerOrders } from "./_components/CustomerOrders";
import { DetailTabs } from "@/components/ik/DetailTabs";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import { StatusPill, type PillTone } from "@/components/ik/StatusPill";
import { toDecimal, formatINRWhole } from "@/lib/money";
import { formatIST } from "@/lib/time";
import type { CustomerInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; from?: string; to?: string }>;
}) {
  const { id } = await params;
  const { tab, from, to } = await searchParams;
  const [customer, groups, orders, invoices] = await Promise.all([
    getCustomer(id),
    listCustomerGroups({ active: true }),
    listOrders({ customerId: id }),
    listCustomerInvoicesForCustomer(id, { from, to }),
  ]);
  if (!customer) notFound();

  async function update(input: CustomerInputT) {
    "use server";
    const res = await updateCustomer(id, input);
    if (!res.ok) return res;
    return { ok: true as const, id };
  }
  async function deactivate() {
    "use server";
    return await deactivateCustomer(id);
  }
  async function reactivate() {
    "use server";
    return await reactivateCustomer(id);
  }

  // Totals for the filtered range — cancelled invoices don't count as
  // billed money.
  const live = invoices.filter((i) => i.status !== CustomerInvoiceStatus.CANCELLED);
  const billed = live.reduce((s, i) => s.plus(toDecimal(i.grandTotal)), toDecimal(0));
  const collected = live.reduce((s, i) => s.plus(toDecimal(i.amountPaid)), toDecimal(0));
  const outstanding = billed.minus(collected);
  const filtered = !!(from || to);

  return (
    <>
      <PageHeader
        eyebrow={`Customer · ${customer.active ? "Active" : "Inactive"}`}
        title={customer.name}
        description={customer.gstin ? `GSTIN ${customer.gstin}` : "No GSTIN on file"}
        actions={
          <div className="flex gap-2">
            <Link href="/customers"><Button variant="outline">Back to list</Button></Link>
            {customer.active ? (
              <ActionResultButton action={deactivate} variant="outline" successMessage="Customer deactivated">
                Deactivate
              </ActionResultButton>
            ) : (
              <ActionResultButton action={reactivate} variant="outline" successMessage="Customer reactivated">
                Reactivate
              </ActionResultButton>
            )}
          </div>
        }
      />

      <DetailTabs
        defaultKey={tab === "invoices" ? "invoices" : undefined}
        tabs={[
          {
            key: "details",
            label: "Details",
            content: (
              <CustomerForm
                defaults={{
                  name: customer.name,
                  gstin: customer.gstin,
                  pan: customer.pan,
                  billingAddress: customer.billingAddress,
                  shippingAddress: customer.shippingAddress,
                  stateCode: customer.stateCode,
                  contactName: customer.contactName,
                  email: customer.email,
                  phone: customer.phone ?? "",
                  notes: customer.notes,
                  groupId: customer.groupId,
                  billingCompanyName: customer.billingCompanyName,
                  creditLimit: customer.creditLimit.toString(),
                  creditDays: customer.creditDays,
                }}
                groups={groups.map((g) => ({ id: g.id, name: g.name }))}
                onSubmit={update}
                submitLabel="Save changes"
              />
            ),
          },
          {
            key: "orders",
            label: "Orders",
            count: orders.length,
            content: (
              <CustomerOrders
                orders={orders.map((o) => ({
                  id: o.id,
                  code: o.code,
                  eventDate: o.eventDate.toISOString(),
                  mealType: o.mealType,
                  headcount: o.headcount,
                  contractValue: o.contractValue.toString(),
                  status: o.status,
                }))}
              />
            ),
          },
          {
            key: "invoices",
            label: "Invoices",
            count: invoices.length,
            content: (
              <section className="grid gap-4">
                {/* Plain GET form — the filter round-trips via searchParams so
                    the invoice list is filtered server-side. */}
                <form
                  method="get"
                  action={`/customers/${id}`}
                  className="flex flex-wrap items-end gap-3 rounded-md border border-ik-rule bg-ik-card p-3"
                >
                  <input type="hidden" name="tab" value="invoices" />
                  <label className="grid gap-1 text-[12px] text-ik-ink-3">
                    From
                    <input
                      type="date"
                      name="from"
                      defaultValue={from ?? ""}
                      className="h-8 rounded border border-ik-rule bg-ik-card px-2 text-[13px] text-ik-ink"
                    />
                  </label>
                  <label className="grid gap-1 text-[12px] text-ik-ink-3">
                    To
                    <input
                      type="date"
                      name="to"
                      defaultValue={to ?? ""}
                      className="h-8 rounded border border-ik-rule bg-ik-card px-2 text-[13px] text-ik-ink"
                    />
                  </label>
                  <Button type="submit" size="sm" variant="outline">Apply</Button>
                  {filtered && (
                    <Link href={`/customers/${id}?tab=invoices`} className="text-[12.5px] text-brand hover:underline">
                      All time
                    </Link>
                  )}
                </form>

                <p className="text-[13px] text-ik-ink-2">
                  <span className="text-ik-ink-3">{filtered ? "Filtered range" : "All time"} · </span>
                  Billed <span className="font-mono font-medium">{formatINRWhole(billed)}</span>
                  <span className="text-ik-ink-3"> · </span>
                  Collected <span className="font-mono font-medium text-positive">{formatINRWhole(collected)}</span>
                  <span className="text-ik-ink-3"> · </span>
                  Outstanding <span className={`font-mono font-medium ${outstanding.gt(0) ? "text-alert" : ""}`}>{formatINRWhole(outstanding)}</span>
                </p>

                {invoices.length === 0 ? (
                  <p className="text-[13px] text-ik-ink-3">
                    No invoices {filtered ? "in this range" : "for this customer yet"}.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead>Issued</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((inv) => {
                        const tone: PillTone =
                          inv.status === CustomerInvoiceStatus.PAID ? "green"
                            : inv.status === CustomerInvoiceStatus.CANCELLED || inv.status === CustomerInvoiceStatus.DRAFT ? "grey"
                              : "amber";
                        const label =
                          inv.status === CustomerInvoiceStatus.PARTIAL
                            ? "Part paid"
                            : inv.status.charAt(0) + inv.status.slice(1).toLowerCase();
                        return (
                          <TableRow key={inv.id}>
                            <TableCell>
                              <Link href={`/invoices/${inv.id}`} className="font-mono text-brand hover:underline">
                                {inv.invoiceNo}
                              </Link>
                            </TableCell>
                            <TableCell className="text-[12px] text-ik-ink-2">{inv.kind}</TableCell>
                            <TableCell className="font-mono text-[12px]">
                              {formatIST(inv.issuedAt ?? inv.createdAt, "yyyy-MM-dd")}
                            </TableCell>
                            <TableCell className="text-right font-mono">{formatINRWhole(inv.grandTotal)}</TableCell>
                            <TableCell className="text-right font-mono text-ik-ink-3">{formatINRWhole(inv.amountPaid)}</TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-1">
                                <StatusPill tone={tone}>{label}</StatusPill>
                                {inv.onHoldAt && <StatusPill tone="red">ON HOLD</StatusPill>}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </section>
            ),
          },
        ]}
      />
    </>
  );
}
