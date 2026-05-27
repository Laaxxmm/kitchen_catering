"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { notifyRoles } from "@/server/actions/notifications";

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
      feedbackSubmittedAt: true,
    },
  });
}

export async function submitFeedback(input: SubmitFeedbackInput) {
  const order = await db.order.findUnique({
    where: { feedbackToken: input.token },
    select: { id: true, feedbackSubmittedAt: true },
  });
  if (!order) throw new Error("Feedback link not found");
  if (order.feedbackSubmittedAt) {
    throw new Error("Feedback has already been submitted for this order");
  }
  const rating = Math.max(1, Math.min(5, Math.round(input.rating)));
  const updated = await db.order.update({
    where: { id: order.id },
    data: {
      feedbackRating: rating,
      feedbackComment: input.comment?.slice(0, 2000) ?? null,
      feedbackSubmittedAt: new Date(),
    },
    select: { code: true, customer: { select: { name: true } } },
  });
  // Notify admin + sales (the people who own the customer relationship)
  // when feedback comes back. dedup so a bot replay doesn't re-fire.
  await notifyRoles([Role.ADMIN, Role.MANAGER, Role.SALES], {
    kind: "FEEDBACK_RECEIVED",
    title: `${"★".repeat(rating)} feedback on ${updated.code}`,
    body: `${updated.customer.name}${input.comment ? ": " + input.comment.slice(0, 120) : ""}`,
    link: `/orders/${order.id}`,
    dedupeKey: `feedback:${order.id}`,
  });
  // No audit log — customer-facing, not an authenticated mutation.
  revalidatePath(`/f/${input.token}`);
}
