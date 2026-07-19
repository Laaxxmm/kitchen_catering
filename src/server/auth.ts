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

// Emails are PII — mask them in production logs ("l***@example.com");
// keep them readable in dev where the logs stay on the developer's machine.
function logSafeEmail(email: string): string {
  if (process.env.NODE_ENV !== "production") return email;
  const [local, domain] = email.split("@");
  return `${local?.[0] ?? ""}***@${domain ?? ""}`;
}

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
        if (!parsed.success) {
          console.warn("[login] payload failed Zod parse", parsed.error.issues);
          return null;
        }

        const limit = rateLimit(
          `web-login:email:${parsed.data.email.toLowerCase()}`,
          5,
          60_000,
        );
        if (!limit.allowed) {
          console.warn("[login] rate-limited", logSafeEmail(parsed.data.email));
          return null;
        }

        const user = await db.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (!user) {
          console.warn("[login] no user with email:", logSafeEmail(parsed.data.email));
          return null;
        }
        if (!user.active) {
          console.warn("[login] user is inactive:", logSafeEmail(parsed.data.email));
          return null;
        }

        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) {
          console.warn(
            "[login] bcrypt mismatch for",
            logSafeEmail(parsed.data.email),
            "(hash prefix",
            user.passwordHash.slice(0, 7),
            ")",
          );
          return null;
        }

        console.log("[login] OK", logSafeEmail(parsed.data.email), "role", user.role);
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
