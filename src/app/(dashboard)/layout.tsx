import { redirect } from "next/navigation";
import { auth, signOut } from "@/server/auth";
import { SignOutButton } from "@/components/ik";
import { DashboardShell } from "@/components/ik/DashboardShell";
import { getNavBadges } from "@/server/actions/nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const navBadges = await getNavBadges();

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <DashboardShell
      userName={session.user.name ?? "User"}
      userRole={session.user.role ?? "USER"}
      navBadges={navBadges}
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
