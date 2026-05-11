import { db } from "@/server/db";
import {
  MobileAuthError,
  mobileError,
  rotateMobileSession,
  signAccessToken,
} from "@/server/mobile-auth";

/**
 * Rotate the refresh token (single-use). Body: { refreshToken }.
 * Response: { accessToken, refreshToken, refreshExpiresAt }
 *
 * The old refresh token is invalidated; a new pair is returned. Mobile
 * client must replace its stored refresh token with the new one.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { refreshToken?: string };
    const oldRefresh = body.refreshToken;
    if (!oldRefresh) throw new MobileAuthError(400, "Missing refreshToken");

    const rotated = await rotateMobileSession(oldRefresh);
    const user = await db.user.findUnique({ where: { id: rotated.userId } });
    if (!user || !user.active) throw new MobileAuthError(401, "User no longer active");

    const accessToken = await signAccessToken(user);
    return Response.json({
      accessToken,
      refreshToken: rotated.refreshToken,
      refreshExpiresAt: rotated.expiresAt.toISOString(),
    });
  } catch (err) {
    return mobileError(err);
  }
}
