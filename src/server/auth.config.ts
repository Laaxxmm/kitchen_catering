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
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role: Role }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;

export default authConfig;
