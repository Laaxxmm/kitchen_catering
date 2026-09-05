import { redirect } from "next/navigation";
import { auth, signOut } from "@/server/auth";
import { sessionIsLive } from "@/server/rbac";
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
  // A cookie the server no longer honours (deactivated, role changed, or
  // issued before session versions existed) would otherwise throw from the
  // first gated call below and land on the error boundary — with /login
  // bouncing the still-valid cookie straight back here. Clear it properly.
  if (!(await sessionIsLive(session))) redirect("/api/auth/ended");

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
