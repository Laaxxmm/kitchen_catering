import { Role, CustomerInvoiceStatus, VendorBillStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";
import { listCustomerInvoices } from "@/server/actions/customer-invoices";
import { listVendorBills } from "@/server/actions/procurement";
import { toDecimal, formatINRWhole } from "@/lib/money";
import { SummaryStrip } from "@/components/ik/StatChips";
import { PaymentsActionView } from "./_components/PaymentsActionView";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);
  const now = new Date();

  const [invoices, bills] = await Promise.all([
    listCustomerInvoices(),
    listVendorBills(),
  ]);

  const toPay = bills
    .filter((b) =>
      b.status === VendorBillStatus.MATCHED ||
      b.status === VendorBillStatus.APPROVED ||
      b.status === VendorBillStatus.OVERDUE,
    )
    .map((b) => ({
      id: b.id,
      billNo: b.billNo,
      vendor: b.vendor.name,
      amount: toDecimal(b.grandTotal).minus(toDecimal(b.amountPaid)),
      due: b.dueDate ? b.dueDate.toISOString() : null,
      overdue: !!(b.dueDate && b.dueDate < now),
    }))
    .filter((b) => b.amount.gt(0));

  const toCollect = invoices
    .filter((inv) => inv.status === CustomerInvoiceStatus.ISSUED || inv.status === CustomerInvoiceStatus.PARTIAL)
    .map((inv) => ({
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      customer: inv.customer.name,
      amount: toDecimal(inv.grandTotal).minus(toDecimal(inv.amountPaid)),
      due: inv.dueAt ? inv.dueAt.toISOString() : null,
      overdue: !!(inv.dueAt && inv.dueAt < now),
    }))
    .filter((inv) => inv.amount.gt(0));

  // Over-payment / duplicate detection: more recorded than the invoice total.
  const overpaid = invoices
    .filter((inv) => toDecimal(inv.amountPaid).gt(toDecimal(inv.grandTotal)))
    .map((inv) => ({
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      customer: inv.customer.name,
      total: toDecimal(inv.grandTotal).toString(),
      paid: toDecimal(inv.amountPaid).toString(),
    }));

  const oweVendors = toPay.reduce((s, b) => s.plus(b.amount), toDecimal(0));
  const customersOwe = toCollect.reduce((s, inv) => s.plus(inv.amount), toDecimal(0));
  const arOverdue = toCollect.filter((inv) => inv.overdue).reduce((s, inv) => s.plus(inv.amount), toDecimal(0));

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Bills & pay"
        description="What needs paying and collecting — first. Recorded-payment history is below."
      />
      <div className="mb-5">
        <SummaryStrip
          chips={[
            { label: `You owe vendors · ${toPay.length} ${toPay.length === 1 ? "bill" : "bills"}`, value: formatINRWhole(oweVendors), tone: oweVendors.gt(0) ? "amber" : "grey" },
            { label: `Customers owe you${arOverdue.gt(0) ? ` · overdue ${formatINRWhole(arOverdue)}` : ""}`, value: formatINRWhole(customersOwe), tone: arOverdue.gt(0) ? "red" : "ink" },
          ]}
        />
      </div>
      <PaymentsActionView
        toPay={toPay.map((b) => ({ ...b, amount: b.amount.toFixed(2) }))}
        toCollect={toCollect.map((inv) => ({ ...inv, amount: inv.amount.toFixed(2) }))}
        overpaid={overpaid}
      />
    </>
  );
}
