import Link from "next/link";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import {
  createCustomerInvoiceFromOrder,
  listBillableOrders,
} from "@/server/actions/customer-invoices";
import { EmptyState } from "@/components/ik/FormKit";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

// Client-centric invoicing: instead of hunting for a delivered order, the
// finance user picks the customer, sees every order of theirs that's ready
// to bill, and generates the tax invoice in one click.

export default async function GenerateInvoicePage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);
  const orders = await listBillableOrders();

  // Group the billable orders by customer so each client is one section.
  const byCustomer = new Map<
    string,
    { name: string; orders: typeof orders }
  >();
  for (const o of orders) {
    const g = byCustomer.get(o.customer.id);
    if (g) g.orders.push(o);
    else byCustomer.set(o.customer.id, { name: o.customer.name, orders: [o] });
  }
  const groups = [...byCustomer.entries()].sort((a, b) =>
    a[1].name.localeCompare(b[1].name),
  );

  async function generate(orderId: string) {
    "use server";
    const r = await createCustomerInvoiceFromOrder(orderId);
    if (!r.ok) return r;
    redirect(`/invoices/${r.id}`);
  }

  return (
    <>
      <PageHeader
        eyebrow="Money · Invoice"
        title="Generate invoice"
        description="Pick a client, see every delivered order that's still to be billed, and raise the tax invoice in one click."
        actions={
          <Link href="/invoices">
            <Button variant="outline">All invoices</Button>
          </Link>
        }
      />

      {groups.length === 0 ? (
        <EmptyState
          title="Nothing to bill right now"
          body="An order shows up here once it's been delivered. Deliver an order from the kitchen/delivery board, then come back to raise its invoice."
          action={
            <Link href="/orders">
              <Button>Go to orders →</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4">
          {groups.map(([customerId, g]) => {
            const total = g.orders.reduce(
              (s, o) => s + Number(o.contractValue),
              0,
            );
            return (
              <section
                key={customerId}
                className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 sm:p-5"
              >
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">
                    {g.name}
                  </h3>
                  <span className="text-[12px] text-ik-ink-3">
                    {g.orders.length} order{g.orders.length === 1 ? "" : "s"} to bill ·{" "}
                    <span className="font-mono text-ik-ink-2">{formatINR(total)}</span>
                  </span>
                </div>
                <ul className="grid gap-2">
                  {g.orders.map((o) => (
                    <li
                      key={o.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ik-rule bg-ik-paper-alt px-3 py-2"
                    >
                      <div className="min-w-0">
                        {/* Plain identifier, not a link — accounts (who live
                            on this screen) intentionally don't have order
                            access; generating the invoice is the only action
                            needed here. */}
                        <span className="font-mono text-[12.5px] text-ik-ink">
                          {o.code}
                        </span>
                        <span className="ml-2 text-[12px] text-ik-ink-3">
                          {o.channel.toLowerCase().replace(/_/g, " ")} ·{" "}
                          {formatIST(o.eventDate, "d MMM yyyy")}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[13px] text-ik-ink">
                          {formatINR(o.contractValue)}
                        </span>
                        <ActionResultButton action={generate.bind(null, o.id)} size="sm">
                          Generate invoice
                        </ActionResultButton>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
