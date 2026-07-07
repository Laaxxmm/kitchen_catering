import { PageHeader } from "@/components/ui/page-header";
import { createSalaryRun } from "@/server/actions/salary";
import { NewSalaryRunForm } from "./_components/NewSalaryRunForm";

export default function NewSalaryRunPage() {
  async function create(input: { periodMonth: string }) {
    "use server";
    return await createSalaryRun(input);
  }
  return (
    <>
      <PageHeader
        eyebrow="Finance · Salary"
        title="New salary run"
        description="Pick a month. The run computes gross pay from active SalaryStructures and approved TimeEntries within that month."
      />
      <NewSalaryRunForm onSubmit={create} />
    </>
  );
}
