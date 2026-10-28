import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorMessage, Loading } from "../../components/common/Feedback";
import { inputClass } from "../../components/common/Field";
import { Pager } from "../../components/common/Pager";
import { adminApi } from "../../services/lms";
import type { AuditEntry } from "../../services/types";
import { formatDateTime } from "../../utils/format";

/** Turns a raw log row into a sentence a person can read. */
function describe(e: AuditEntry): string {
  const who = e.actor_name ?? "Someone (account deleted)";
  const m = e.metadata ?? {};
  switch (e.action) {
    case "user.roles_changed":
      return `${who} changed the roles of ${m.email}: ${(m.from ?? []).join(", ") || "none"} to ${(m.to ?? []).join(", ")}.`;
    case "user.suspended":
      return `${who} suspended ${m.email}${m.reason ? ` (${m.reason})` : ""}.`;
    case "user.reactivated":
      return `${who} reactivated ${m.email}.`;
    case "user.deleted":
      return `${who} deleted the account of ${m.name} (${m.email}).`;
    case "course.approved":
      return `${who} approved the course "${m.title}".`;
    case "course.rejected":
      return `${who} rejected or unpublished "${m.title}"${m.comment ? `: ${m.comment}` : ""}.`;
    case "post.removed":
      return `${who} removed ${m.whole_thread ? "a discussion" : "a forum post"}${m.thread_title ? ` in "${m.thread_title}"` : m.title ? `: "${m.title}"` : ""}${m.excerpt ? `: "${m.excerpt}"` : ""}.`;
    case "post.reports_dismissed":
      return `${who} reviewed a reported forum post and kept it${m.excerpt ? `: "${m.excerpt}"` : ""}.`;
    case "review.removed":
      return `${who} removed a course review.`;
    default:
      return `${who}: ${e.action}`;
  }
}

const FILTERS = [
  { value: "", label: "Everything" },
  { value: "user.", label: "Users" },
  { value: "course.", label: "Courses" },
  { value: "review.", label: "Reviews" },
  { value: "post.", label: "Forum moderation" },
];

export default function ActivityPage() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, isPending } = useQuery({ queryKey: ["admin-audit", action, page], queryFn: () => adminApi.audit({ action, page }) });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Activity log</h2>
        <label className="flex items-center gap-2 text-sm text-muted">
          Show
          <select className={`${inputClass} !w-auto`} value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
            {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-1 text-sm text-muted">A permanent record of administrative actions. Entries can't be edited or removed.</p>
      <ErrorMessage error={error} />
      {isPending && <Loading label="Loading the activity log" />}
      {data && data.data.length === 0 && <p className="py-12 text-muted">Nothing here yet.</p>}
      {data && data.data.length > 0 && (
        <ol className="mt-4 divide-y divide-line rounded-md border border-line bg-white">
          {data.data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 p-4">
              <p className="min-w-64 flex-1 text-sm">{describe(e)}</p>
              <time dateTime={e.created_at} className="text-xs text-muted">{formatDateTime(e.created_at)}</time>
            </li>
          ))}
        </ol>
      )}
      {data && <Pager pagination={data.pagination} onPage={setPage} />}
    </div>
  );
}
