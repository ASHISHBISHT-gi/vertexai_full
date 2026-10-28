import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { reviewsApi } from "../../services/lms";
import type { Review } from "../../services/types";
import { useAuth } from "../../store/auth";
import { formatDate } from "../../utils/format";
import { Button } from "../common/Button";
import { ErrorMessage, Loading } from "../common/Feedback";
import { inputClass } from "../common/Field";
import { StarInput, Stars } from "../common/Stars";

function ReviewForm({ courseId, existing, onDone }: { courseId: string; existing?: Review; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [comment, setComment] = useState(existing?.comment ?? "");
  const save = useMutation({
    mutationFn: () => reviewsApi.save(courseId, { rating, comment: comment.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reviews", courseId] });
      queryClient.invalidateQueries({ queryKey: ["course", courseId] });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (rating) save.mutate();
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-line bg-white p-5">
      <StarInput value={rating} onChange={setRating} />
      <div>
        <label htmlFor="review-comment" className="mb-1.5 block text-sm font-medium">Your review (optional)</label>
        <textarea id="review-comment" rows={3} maxLength={2000} className={inputClass} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What was good? What could be better?" />
      </div>
      <ErrorMessage error={save.error} />
      <div className="flex gap-3">
        <Button type="submit" disabled={!rating || save.isPending}>{save.isPending ? "Saving…" : existing ? "Update review" : "Post review"}</Button>
        {existing && <Button type="button" variant="quiet" onClick={onDone}>Cancel</Button>}
      </div>
    </form>
  );
}

export function ReviewsSection({ courseId }: { courseId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const { data, error, isPending } = useQuery({ queryKey: ["reviews", courseId, user?.id ?? "anonymous"], queryFn: () => reviewsApi.list(courseId) });
  const remove = useMutation({
    mutationFn: reviewsApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reviews", courseId] });
      queryClient.invalidateQueries({ queryKey: ["course", courseId] });
    },
  });

  if (isPending) return <Loading label="Loading reviews" />;
  if (error) return <ErrorMessage error={error} />;

  const mine = data.items.find((i) => i.mine);
  const others = data.items.filter((i) => !i.mine);
  const { summary } = data;

  return (
    <section className="mt-12" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading" className="text-xl font-semibold">Reviews</h2>

      {summary.count === 0 ? (
        <p className="mt-2 text-muted">No reviews yet.{data.can_review ? " Be the first to share what you thought." : ""}</p>
      ) : (
        <div className="mt-3 grid gap-6 sm:grid-cols-[10rem_1fr] sm:items-center">
          <div>
            <p className="text-4xl font-semibold">{summary.average.toFixed(1)}</p>
            <Stars value={summary.average} count={summary.count} />
          </div>
          <ul className="space-y-1" aria-label="Ratings breakdown">
            {([5, 4, 3, 2, 1] as const).map((n) => (
              <li key={n} className="flex items-center gap-3 text-sm">
                <span className="w-12 text-muted">{n} {n === 1 ? "star" : "stars"}</span>
                <span className="h-2.5 flex-1 rounded-sm bg-line"><span className="block h-full rounded-sm bg-highlight" style={{ width: `${(summary.distribution[n] / summary.count) * 100}%` }} /></span>
                <span className="w-6 text-right text-muted">{summary.distribution[n]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 space-y-4">
        {data.can_review && (!mine || editing) && <ReviewForm courseId={courseId} existing={mine} onDone={() => setEditing(false)} />}
        {mine && !editing && (
          <div className="rounded-md border border-pen/40 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">Your review</p>
              <span className="text-xs text-muted">{formatDate(mine.created_at)}</span>
            </div>
            <div className="mt-1"><Stars value={mine.rating} count={1} single /></div>
            {mine.comment && <p className="mt-2 whitespace-pre-wrap text-sm">{mine.comment}</p>}
            <div className="mt-3 flex gap-4 text-sm">
              <button className="text-pen hover:underline" onClick={() => setEditing(true)}>Edit</button>
              <button className="text-muted hover:text-danger" onClick={() => remove.mutate(mine.id)}>Delete</button>
            </div>
            <ErrorMessage error={remove.error} />
          </div>
        )}
        {others.map((r) => (
          <article key={r.id} className="rounded-md border border-line bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{r.author_name}</p>
              <span className="text-xs text-muted">{formatDate(r.created_at)}</span>
            </div>
            <div className="mt-1"><Stars value={r.rating} count={1} single /></div>
            {r.comment && <p className="mt-2 whitespace-pre-wrap text-sm">{r.comment}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
