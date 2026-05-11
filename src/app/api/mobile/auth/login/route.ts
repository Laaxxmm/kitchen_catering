import bcrypt from "bcryptjs";
import { db } from "@/server/db";
import {
  createMobileSession,
  signAccessToken,
  mobileError,
  MobileAuthError,
} from "@/server/mobile-auth";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Mobile bearer-token login. Body: { email, password, deviceId }.
 * Response: { accessToken, refreshToken, refreshExpiresAt, user: { id, role, name } }
 *
 * Access tokens are short-lived (15 min, baked into mobile-auth.ts).
 * Refresh tokens are 30 days, opaque, stored bcrypt-hashed in MobileSession.
 * The client holds them in @capacitor/preferences (Android Keystore).
 *
 * SECURITY: rate-limited per email+deviceId at 5 attempts/min — same as web.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: string; password?: string; deviceId?: string };
    const email = body.email?.toLowerCase().trim();
    const password = body.password;
    const deviceId = body.deviceId?.trim();
    if (!email || !password || !deviceId) {
      throw new MobileAuthError(400, "Missing email / password / deviceId");
    }
    const limit = rateLimit(`mobile-login:${email}:${deviceId}`, 5, 60_000);
    if (!limit.allowed) {
      throw new MobileAuthError(429, "Too many login attempts");
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user || !user.active) throw new MobileAuthError(401, "Invalid credentials");
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new MobileAuthError(401, "Invalid credentials");

    const accessToken = await signAccessToken(user);
    const session = await createMobileSession({ userId: user.id, deviceId });

    return Response.json({
      accessToken,
      refreshToken: session.refreshToken,
      refreshExpiresAt: session.expiresAt.toISOString(),
      user: { id: user.id, name: user.name, role: user.role, email: user.email },
    });
  } catch (err) {
    return mobileError(err);
  }
}
