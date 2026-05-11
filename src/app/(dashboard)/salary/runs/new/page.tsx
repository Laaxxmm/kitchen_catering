import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSalaryRun } from "@/server/actions/salary";

export default function NewSalaryRunPage() {
  async function create(formData: FormData) {
    "use server";
    const month = String(formData.get("periodMonth") ?? "");
    if (!month) return;
    // <input type="month"> returns "YYYY-MM"; convert to ISO date string.
    const periodMonth = `${month}-01T00:00:00`;
    const r = await createSalaryRun({ periodMonth });
    redirect(`/salary/runs/${r.id}`);
  }
  return (
    <>
      <PageHeader
        eyebrow="Finance · Salary"
        title="New salary run"
        description="Pick a month. The run computes gross pay from active SalaryStructures and approved TimeEntries within that month."
      />
      <form action={create} className="grid max-w-xs gap-4">
        <div className="grid gap-1">
          <Label htmlFor="periodMonth">Period (month)</Label>
          <Input id="periodMonth" name="periodMonth" type="month" required />
        </div>
        <Button type="submit">Create run</Button>
      </form>
    </>
  );
}
