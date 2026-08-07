import Link from "next/link";
import { ManpowerRequestStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/ik/StatusPill";
import { gateRolePage } from "@/server/rbac";
import { listManpowerRequests, type ManpowerRequestRow } from "@/server/actions/manpower";
import {
  costVariance,
  effectiveFigures,
  requestedFigures,
  wasEditedAtApproval,
} from "@/lib/manpower";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { APPROVE_ROLES, MONEY_ROLES, RAISE_ROLES, VIEW_ROLES, can } from "./_components/gates";
import { STATUS_META, figureLine } from "./_components/display";

export const dynamic = "force-dynamic";

const S = ManpowerRequestStatus;
const CLOSED = [S.PAID, S.REJECTED, S.CANCELLED];

/**
 * The working list. Every live request lands in exactly one bucket, and which
 * bucket you get depends on what you can actually do about it — a manager's
 * first section is what needs approving, accounts' is what needs a cost and a
 * payment, a chef's is their own. The lifecycle itself happens on the detail
 * page, where the numbers, the reason and the cost can be entered; nothing
 * here is a one-click money move.
 */
export default async function ManpowerPage({
  searchParams,
}: {
  searchParams: Promise<{ closed?: string }>;
}) {
  const session = await gateRolePage(VIEW_ROLES);
  const sp = await searchParams;
  const showClosed = sp.closed === "1";
  const role = session.user.role;

  const [live, closed] = await Promise.all([
    listManpowerRequests(),
    // Closed rows only on request — the default page load stays bounded no
    // matter how many months of paid requests have piled up.
    showClosed ? listManpowerRequests({ statuses: CLOSED }) : Promise.resolve([]),
  ]);

  const canRaise = can(role, RAISE_ROLES);
  const canApprove = can(role, APPROVE_ROLES);
  const canMoney = can(role, MONEY_ROLES);

  const buckets: { key: string; title: string; hint: string; rows: ManpowerRequestRow[] }[] = [];
  if (canApprove) {
    buckets.push({
      key: "approve",
      title: "Waiting on your approval",
      hint: "Open one to approve as asked, or change the count, days or rate first.",
      rows: [],
    });
  }
  if (canMoney) {
    buckets.push({
      key: "money",
      title: "Job done — settle and pay",
      hint: "Record what the labour actually invoiced, then pay it out.",
      rows: [],
    });
  }
  if (canRaise) {
    buckets.push({ key: "mine", title: "Your requests", hint: "Where each of your asks has got to.", rows: [] });
  }
  buckets.push({ key: "rest", title: "Everything else in flight", hint: "", rows: [] });

  // First match wins, so nothing is listed twice for someone who wears more
  // than one hat (an admin is approver, money desk and requester at once).
  for (const r of live) {
    const key =
      canApprove && r.status === S.REQUESTED
        ? "approve"
        : canMoney && r.status === S.COMPLETED
          ? "money"
          : canRaise && r.requestedById === session.user.id
            ? "mine"
            : "rest";
    buckets.find((b) => b.key === key)!.rows.push(r);
  }

  const filled = buckets.filter((b) => b.rows.length > 0);

  return (
    <>
      <PageHeader
        eyebrow="Make & deliver"
        title="Manpower"
        description="Casual labour hired in for a job — requested with an approximate cost, approved by a manager, settled at what it actually came to."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/manpower/reports"><Button variant="outline">Monthly report</Button></Link>
            {canRaise && <Link href="/manpower/new"><Button>Request manpower</Button></Link>}
          </div>
        }
      />

      {filled.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">Nothing in flight right now.</p>
      ) : (
        <div className="grid gap-6">
          {filled.map((b) => (
            <section key={b.key}>
              <h2 className="mb-1 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">
                {b.title} · {b.rows.length}
              </h2>
              {b.hint && <p className="mb-2 text-[12px] text-ik-ink-3">{b.hint}</p>}
              <RequestTable rows={b.rows} />
            </section>
          ))}
        </div>
      )}

      <div className="mt-6">
        {showClosed ? (
          <section>
            <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">
              Closed · {closed.length}
            </h2>
            {closed.length === 0 ? (
              <p className="text-[13px] text-ik-ink-3">Nothing closed yet.</p>
            ) : (
              <RequestTable rows={closed} />
            )}
            <Link href="/manpower" className="mt-2 inline-block text-[12px] text-brand hover:underline">
              Hide closed requests
            </Link>
          </section>
        ) : (
          <Link href="/manpower?closed=1" className="text-[12px] text-brand hover:underline">
            Show closed requests (paid, turned down, called off)
          </Link>
        )}
      </div>
    </>
  );
}

function RequestTable({ rows }: { rows: ManpowerRequestRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Work</TableHead>
          <TableHead>Order</TableHead>
          <TableHead>People × days × rate</TableHead>
          <TableHead className="text-right">Estimate</TableHead>
          <TableHead className="text-right">Actual</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const meta = STATUS_META[r.status];
          const asked = requestedFigures(r);
          const effective = effectiveFigures(r);
          const variance = costVariance(r);
          return (
            <TableRow key={r.id}>
              <TableCell>
                <Link href={`/manpower/${r.id}`} className="text-brand hover:underline">
                  {r.workDescription}
                </Link>
                <div className="text-[11px] text-ik-ink-3">
                  {r.requestedBy?.name ?? "—"} · {formatIST(r.createdAt, "d MMM")}
                </div>
              </TableCell>
              <TableCell>
                {r.order ? (
                  <Link href={`/orders/${r.orderId}`} className="font-mono text-[12px] text-brand hover:underline">
                    {r.order.code}
                  </Link>
                ) : (
                  <span className="text-[12px] text-ik-ink-3">No order</span>
                )}
              </TableCell>
              <TableCell className="font-mono text-[12px]">
                {figureLine(effective.people, effective.days, effective.rate)}
                {/* The manager moved the numbers — the gap is the point, so it
                    travels with the row rather than hiding on the detail page. */}
                {wasEditedAtApproval(r) && (
                  <div className="text-[11px] text-ik-ink-3">
                    asked for {figureLine(asked.people, asked.days, asked.rate)}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-[12.5px]">
                {formatINR(variance.estimate)}
              </TableCell>
              <TableCell className="text-right font-mono text-[12.5px]">
                {variance.actual === null ? (
                  <span className="text-ik-ink-3">—</span>
                ) : (
                  <>
                    {formatINR(variance.actual)}
                    {variance.overrun && (
                      <div className="text-[11px] text-alert">+{formatINR(variance.variance)}</div>
                    )}
                  </>
                )}
              </TableCell>
              <TableCell><StatusPill tone={meta.tone}>{meta.label}</StatusPill></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
