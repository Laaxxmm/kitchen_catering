"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitFeedback } from "@/server/actions/feedback";
import { isNextNavigationError } from "@/lib/next-error";

export function FeedbackForm({ token }: { token: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      toast.error("Please pick a rating");
      return;
    }
    startTransition(async () => {
      try {
        const res = await submitFeedback({ token, rating, comment: comment.trim() });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Thanks for your feedback!");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not submit");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-5 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-5">
      <div className="grid gap-2 text-center">
        <span className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">
          Your rating
        </span>
        <div className="flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => {
            const filled = (hover || rating) >= n;
            return (
              <button
                key={n}
                type="button"
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setRating(n)}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                className="text-[32px] leading-none transition"
                style={{ color: filled ? "#F5A623" : "#D6D3C8" }}
              >
                ★
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2">
        <label htmlFor="comment" className="text-[12px] font-medium text-ik-ink-2">
          Any comments? (optional)
        </label>
        <Textarea
          id="comment"
          rows={4}
          placeholder="Tell us what we did well — or what we should fix."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={2000}
        />
        <span className="text-[10.5px] text-ik-ink-3">{comment.length}/2000</span>
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Send feedback"}
      </Button>
    </form>
  );
}
