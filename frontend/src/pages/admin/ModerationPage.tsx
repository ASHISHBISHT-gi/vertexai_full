import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "../../components/common/Button";
import { ErrorMessage, Loading } from "../../components/common/Feedback";
import { Pager } from "../../components/common/Pager";
import { communityApi } from "../../services/lms";
import { formatDateTime } from "../../utils/format";

/** PRD FR-AD5: the queue of forum posts students have reported. The admin either keeps the post or removes it. */
export default function ModerationPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const { data, error, isPending } = useQuery({ queryKey: ["admin-flagged", page], queryFn: () => communityApi.flagged({ page }) });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-flagged"] });
  const keep = useMutation({ mutationFn: communityApi.dismissReports, onSuccess: refresh });
  const remove = useMutation({ mutationFn: communityApi.deletePost, onSuccess: refresh });

  return (
    <div>
      <h2 className="text-xl font-semibold">Reported posts</h2>
      <p className="mt-1 text-sm text-muted">Posts students flagged in course discussions. Keep a post to clear its reports, or remove it. Removals are written to the activity log.</p>
      <ErrorMessage error={error ?? keep.error ?? remove.error} />
      {isPending && <Loading label="Loading reported posts" />}
      {data && data.data.length === 0 && <p className="py-12 text-muted">Nothing is waiting for review.</p>}
      {data && data.data.length > 0 && (
        <ul className="mt-4 space-y-4">
          {data.data.map((p) => (
            <li key={p.id} className="rounded-md border border-line bg-white p-5">
              <p className="text-sm text-muted">
                In <Link className="text-pen hover:underline" to={`/teach/courses/${p.course_id}?tab=community&thread=${p.thread_id}`}>{p.thread_title}</Link> · {p.course_title}
              </p>
              <p className="mt-3 whitespace-pre-wrap break-words">{p.content}</p>
              <p className="mt-3 text-sm text-muted">
                By {p.author_name ?? "a deleted account"}{p.author_email ? ` (${p.author_email})` : ""} · {formatDateTime(p.created_at)} · {p.report_count} {p.report_count === 1 ? "report" : "reports"}
              </p>
              {p.reasons.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {p.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
              <div className="mt-4 flex gap-3">
                <Button variant="secondary" disabled={keep.isPending || remove.isPending} onClick={() => keep.mutate(p.id)}>Keep post</Button>
                <Button disabled={keep.isPending || remove.isPending} onClick={() => window.confirm("Remove this post? Replies under it are removed too.") && remove.mutate(p.id)}>Remove post</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && <Pager pagination={data.pagination} onPage={setPage} />}
    </div>
  );
}
