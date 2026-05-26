"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/server/db";

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
  await db.order.update({
    where: { id: order.id },
    data: {
      feedbackRating: rating,
      feedbackComment: input.comment?.slice(0, 2000) ?? null,
      feedbackSubmittedAt: new Date(),
    },
  });
  // No audit log — customer-facing, not an authenticated mutation.
  revalidatePath(`/f/${input.token}`);
}
