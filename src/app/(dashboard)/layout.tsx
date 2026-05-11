import { redirect } from "next/navigation";
import { auth, signOut } from "@/server/auth";
import { SignOutButton } from "@/components/ik";
import { DashboardShell } from "@/components/ik/DashboardShell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <DashboardShell
      userName={session.user.name ?? "User"}
      userRole={session.user.role ?? "USER"}
      topBarRight={
        <form action={handleSignOut}>
          <SignOutButton />
        </form>
      }
    >
      {children}
    </DashboardShell>
  );
}
