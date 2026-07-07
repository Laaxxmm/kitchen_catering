import { notFound } from "next/navigation";
import { getOrderByFeedbackToken } from "@/server/actions/feedback";
import { FeedbackForm } from "./_components/FeedbackForm";

export const dynamic = "force-dynamic";

// Public, no-auth feedback page reached via the link sent on order
// completion. Renders a 5-star + comment form, then a thank-you
// state once submitted. Layout intentionally borrows the public-
// invoice page styling so they read as a matched pair.
export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = await getOrderByFeedbackToken(token);
  if (!order) notFound();

  const submitted = order.feedbackSubmittedAt != null;

  // Feedback links go stale after 30 days — an old forwarded link
  // shouldn't accept ratings forever. Already-submitted feedback still
  // shows its thank-you state below.
  const FEEDBACK_LINK_MAX_AGE_DAYS = 30;
  const expired =
    !submitted &&
    order.feedbackSentAt != null &&
    Date.now() - order.feedbackSentAt.getTime() > FEEDBACK_LINK_MAX_AGE_DAYS * 24 * 3600 * 1000;
  if (expired) {
    return (
      <main className="mx-auto max-w-xl bg-ik-paper px-6 py-16 text-center font-ik-sans text-ik-ink">
        <h1 className="text-[18px] font-medium">This feedback link has expired</h1>
        <p className="mt-2 text-[13px] text-ik-ink-2">
          Feedback links stay open for {FEEDBACK_LINK_MAX_AGE_DAYS} days after your order.
          We&apos;d still love to hear from you — please reach out to us directly.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl bg-ik-paper px-6 py-12 font-ik-sans text-ik-ink">
      <header className="mb-6 text-center">
        <div className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">
          Greenpath
        </div>
        <h1 className="mt-2 text-[20px] font-medium">How was your order?</h1>
        <p className="mt-1 text-[13px] text-ik-ink-2">
          Order{" "}
          <span className="font-mono text-ik-ink">{order.code}</span> · {order.customer.name}
        </p>
      </header>

      {submitted ? (
        <section className="rounded-md border border-positive-wash bg-positive-wash p-5 text-center text-[13px]">
          <div className="text-[14px] font-medium text-positive">
            Thank you — feedback received
          </div>
          {order.feedbackRating != null && (
            <div className="mt-3 font-mono text-[22px]">
              {"★".repeat(order.feedbackRating)}
              <span className="text-ik-ink-3">
                {"★".repeat(5 - order.feedbackRating)}
              </span>
            </div>
          )}
          {order.feedbackComment && (
            <p className="mt-3 text-ik-ink-2 whitespace-pre-line">
              {order.feedbackComment}
            </p>
          )}
        </section>
      ) : (
        <FeedbackForm token={token} />
      )}

      <footer className="mt-10 text-center text-[11px] text-ik-ink-3">
        Greenpath · Sent because you recently placed an order with us. This
        link is single-use.
      </footer>
    </main>
  );
}
