import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";

/**
 * Edge-safe NextAuth config.
 *
 * This file MUST NOT import anything that pulls in Prisma, bcrypt, or any
 * Node-only module. Middleware imports this config so `middleware.ts` can
 * stay on the Edge runtime — if we ever re-introduce `./db` or `bcryptjs`
 * here, middleware silently falls back to the Node runtime and every page
 * navigation pays the cost of loading the Prisma client bundle.
 *
 * The Credentials provider (which needs Prisma + bcrypt) is defined in
 * `./auth.ts` and is merged in there — not here.
 */
const authConfig = {
  // 24h, down from Auth.js's 30-day default. The lifetime is the outer
  // bound only — the real revocation is `sessionVersion` (see rbac.ts):
  // every guarded call compares the version in the token with the User
  // row, so a deactivated account or a changed role takes effect on the
  // next request, not on the next login.
  session: { strategy: "jwt", maxAge: 24 * 60 * 60 },
  pages: {
    signIn: "/login",
    // Bounce auth errors back to /login (with the error code in the
    // query string) instead of NextAuth's default /api/auth/error,
    // which on next-auth v5 + app-router blows up with
    //   `UnknownAction: Cannot parse action at /api/auth/error`
    // and surfaces as a generic "Bad Request" to the user.
    error: "/login",
  },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role: Role }).role;
        token.sv = (user as { sessionVersion?: number }).sessionVersion ?? 0;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        // A token minted before sessionVersion existed has no `sv`. -1 can
        // never equal a row's version, so those sessions end on their next
        // guarded call and the user signs in once to get a current token.
        session.user.sessionVersion =
          typeof token.sv === "number" ? token.sv : -1;
      }
      return session;
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;

export default authConfig;
