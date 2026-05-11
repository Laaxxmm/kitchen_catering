import { randomBytes, createHash } from "node:crypto";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { db } from "./db";

// Bearer-token auth for the mobile app. Parallel to NextAuth (cookies + Server
// Actions) — we cannot share the cookie because the Capacitor WebView on iOS
// loses it across app restarts. Access tokens are short-lived (15 min);
// refresh tokens are 30 days, stored hashed (never plaintext) in MobileSession.

const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;
const ISSUER = "indefine-kitchen";
const AUDIENCE = "ik-mobile";

function secretKey(): Uint8Array {
  const raw = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!raw) throw new Error("AUTH_SECRET is not configured");
  return new TextEncoder().encode(raw);
}

export interface AccessPayload extends JWTPayload {
  sub: string; // userId
  role: Role;
  name?: string;
}

export async function signAccessToken(
  user: { id: string; role: Role; name?: string | null },
): Promise<string> {
  return new SignJWT({ role: user.role, name: user.name ?? undefined })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<AccessPayload> {
  const { payload } = await jwtVerify<AccessPayload>(token, secretKey(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (!payload.sub) throw new Error("token missing sub");
  return payload;
}

// Refresh tokens are opaque random strings; we sign them as JWTs so the client
// can treat them as bearers, but the DB-side hash is what gates them.
export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface MobileSessionView {
  user: { id: string; role: Role; name: string | null; email: string };
}

/** Read the Authorization header on a REST request, verify the JWT, and return
 *  a session-compatible object so existing rbac helpers continue to work. */
export async function requireMobileAuth(
  req: NextRequest | Request,
): Promise<MobileSessionView> {
  const auth = req.headers.get("authorization") ?? "";
  const [scheme, token] = auth.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new MobileAuthError(401, "Missing bearer token");
  }
  let payload: AccessPayload;
  try {
    payload = await verifyAccessToken(token);
  } catch {
    throw new MobileAuthError(401, "Invalid or expired token");
  }
  const user = await db.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, name: true, email: true, active: true },
  });
  if (!user || !user.active) {
    throw new MobileAuthError(401, "User not found or deactivated");
  }
  return { user: { id: user.id, role: user.role, name: user.name, email: user.email } };
}

export class MobileAuthError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "MobileAuthError";
  }
}

export async function createMobileSession(params: {
  userId: string;
  deviceId: string;
}): Promise<{ refreshToken: string; expiresAt: Date }> {
  const refreshToken = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SEC * 1000);
  await db.mobileSession.create({
    data: {
      userId: params.userId,
      deviceId: params.deviceId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt,
    },
  });
  return { refreshToken, expiresAt };
}

export async function rotateMobileSession(
  oldRefreshToken: string,
): Promise<{
  refreshToken: string;
  expiresAt: Date;
  userId: string;
  deviceId: string;
}> {
  const hash = hashRefreshToken(oldRefreshToken);
  const session = await db.mobileSession.findFirst({
    where: { refreshTokenHash: hash, expiresAt: { gt: new Date() } },
  });
  if (!session) throw new MobileAuthError(401, "Refresh token not recognized");
  const newToken = generateRefreshToken();
  const newExpires = new Date(Date.now() + REFRESH_TTL_SEC * 1000);
  await db.mobileSession.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: hashRefreshToken(newToken),
      expiresAt: newExpires,
    },
  });
  return {
    refreshToken: newToken,
    expiresAt: newExpires,
    userId: session.userId,
    deviceId: session.deviceId,
  };
}

export async function revokeMobileSession(refreshToken: string): Promise<void> {
  await db.mobileSession.deleteMany({
    where: { refreshTokenHash: hashRefreshToken(refreshToken) },
  });
}

/** Uniform JSON error for all /api/mobile/* routes. */
export function mobileError(err: unknown) {
  if (err instanceof MobileAuthError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Internal error";
  return Response.json({ error: message }, { status: 500 });
}
