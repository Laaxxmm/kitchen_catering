import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";
import { getReviewWorklist } from "@/server/actions/review";
import { ReviewWorklist } from "./_components/ReviewWorklist";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER]);
  const data = await getReviewWorklist();

  return (
    <>
      <PageHeader
        eyebrow="Needs you now"
        title="Review"
        description="Everything waiting on you, in one place. Clear each item without leaving this page."
        actions={
          data.total > 0 ? (
            <span className="inline-flex items-center rounded-full bg-alert px-2.5 py-1 font-mono text-[12px] font-bold text-white">
              {data.total}
            </span>
          ) : null
        }
      />
      <ReviewWorklist data={data} />
    </>
  );
}
