import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type {} from "next-auth/jwt";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "./db";
import type { Role } from "@prisma/client";
import authConfig from "./auth.config";
import { rateLimit } from "@/lib/rate-limit";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Full NextAuth instance — imports Prisma + bcrypt. Only server routes
// (route handlers, layouts, server actions) should import from this file.
// Middleware imports `./auth.config` directly to stay edge-safe.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        // Rate-limit per email: 5 attempts per minute. Stops credential
        // brute-force without making the legitimate user's bad-typo retry
        // loop feel sluggish. Returning `null` here surfaces as "Invalid
        // credentials" which is what we want — don't disclose the limit.
        const limit = rateLimit(
          `web-login:email:${parsed.data.email.toLowerCase()}`,
          5,
          60_000,
        );
        if (!limit.allowed) return null;

        const user = await db.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (!user || !user.active) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
});
