"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { notifyRoles } from "@/server/actions/notifications";
import { ActionError, actionFailure, type ActionResult } from "@/server/action-result";
import { deferAfterResponse } from "@/server/defer";

// Public-facing feedback actions — NO auth required.
// Rate-limited at the token level: a token can be used once. Subsequent
// submissions return the existing record (idempotent display) but do
// not overwrite.

interface SubmitFeedbackInput {
  token: string;
  rating: number; // 1..5
  comment?: string;
}

export async function getOrderByFeedbackToken(token: string) {
  if (!token || token.length < 8) return null;
  return db.order.findUnique({
    where: { feedbackToken: token },
    select: {
      id: true,
      code: true,
      customer: { select: { name: true } },
      channel: true,
      feedbackRating: true,
      feedbackComment: true,
      feedbackSentAt: true,
      feedbackSubmittedAt: true,
    },
  });
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<ActionResult> {
  try {
    return await submitFeedbackInner(input);
  } catch (err) {
    return actionFailure(err);
  }
}

async function submitFeedbackInner(input: SubmitFeedbackInput): Promise<{ ok: true }> {
  const order = await db.order.findUnique({
    where: { feedbackToken: input.token },
    select: { id: true },
  });
  if (!order) throw new ActionError("Feedback link not found");
  const rating = Math.max(1, Math.min(5, Math.round(input.rating)));
  // Guarded write: only the first submission lands; a double-tap / bot
  // replay matches zero rows and gets a clear message instead of
  // silently overwriting the customer's original words.
  const updated = await db.order.updateMany({
    where: { id: order.id, feedbackSubmittedAt: null },
    data: {
      feedbackRating: rating,
      feedbackComment: input.comment?.slice(0, 2000) ?? null,
      feedbackSubmittedAt: new Date(),
    },
  });
  if (updated.count === 0) {
    throw new ActionError("Feedback has already been submitted for this order");
  }
  // Notify admin + sales (the people who own the customer relationship)
  // when feedback comes back — after the response, so the customer's
  // submit button doesn't wait on the fan-out. dedup so a bot replay
  // doesn't re-fire.
  deferAfterResponse("feedback:notify", async () => {
    const o = await db.order.findUnique({
      where: { id: order.id },
      select: { code: true, customer: { select: { name: true } } },
    });
    if (!o) return;
    await notifyRoles([Role.ADMIN, Role.MANAGER, Role.SALES], {
      kind: "FEEDBACK_RECEIVED",
      title: `${"★".repeat(rating)} feedback on ${o.code}`,
      body: `${o.customer.name}${input.comment ? ": " + input.comment.slice(0, 120) : ""}`,
      link: `/orders/${order.id}`,
      dedupeKey: `feedback:${order.id}`,
    });
  });
  // No audit log — customer-facing, not an authenticated mutation.
  revalidatePath(`/f/${input.token}`);
  return { ok: true };
}
