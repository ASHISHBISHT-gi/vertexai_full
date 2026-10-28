import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Button, buttonClass } from "../../components/common/Button";
import { Difficulty } from "../../components/common/Difficulty";
import { ErrorMessage, Loading } from "../../components/common/Feedback";
import { inputClass } from "../../components/common/Field";
import { Pager } from "../../components/common/Pager";
import { StatusChip } from "../../components/common/StatusChip";
import { adminApi } from "../../services/lms";
import type { AdminCourse } from "../../services/types";
import { formatDate, formatPrice } from "../../utils/format";

const FILTERS = [
  { value: "pending", label: "Waiting for approval" },
  { value: "approved", label: "Published" },
  { value: "rejected", label: "Rejected" },
  { value: "", label: "All" },
];

function CourseRow({ course }: { course: AdminCourse }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");

  const decide = useMutation({
    mutationFn: (v: { decision: "approved" | "rejected"; comment?: string }) => adminApi.decide(course.id, v.decision, v.comment),
    onSuccess: () => {
      setRejecting(false);
      setComment("");
      queryClient.invalidateQueries({ queryKey: ["admin-courses"] });
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    },
  });
  const canApprove = course.status !== "approved";
  const reject = (e: FormEvent) => {
    e.preventDefault();
    decide.mutate({ decision: "rejected", comment: comment.trim() });
  };

  return (
    <li className="rounded-md border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{course.title}</h3>
          <p className="mt-0.5 text-sm text-muted">
            {course.instructor_name} ({course.instructor_email}) · submitted {formatDate(course.created_at)}
          </p>
        </div>
        <StatusChip status={course.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        {course.category && <span>{course.category}</span>}
        <Difficulty level={course.difficulty} />
        <span>{formatPrice(course.price)}</span>
        <span className="text-muted">
          {course.module_count} {course.module_count === 1 ? "module" : "modules"} · {course.lecture_count} {course.lecture_count === 1 ? "lecture" : "lectures"} · {course.video_count} with video · {course.enrollment_count} {course.enrollment_count === 1 ? "student" : "students"}
        </span>
      </div>
      {course.last_review_comment && course.status === "rejected" && (
        <p className="mt-3 rounded-md bg-paper px-3 py-2 text-sm"><span className="font-medium">Reason given: </span>{course.last_review_comment}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link to={`/learn/${course.id}`} className={buttonClass("secondary")}>Preview content</Link>
        <Link to={`/courses/${course.id}`} className={buttonClass("secondary")}>Course page</Link>
        {canApprove && (
          <Button onClick={() => decide.mutate({ decision: "approved" })} disabled={decide.isPending}>
            {decide.isPending && !rejecting ? "Publishing…" : "Approve"}
          </Button>
        )}
        {!rejecting && course.status !== "rejected" && (
          <Button variant="secondary" onClick={() => setRejecting(true)}>
            {course.status === "approved" ? "Unpublish" : "Reject"}
          </Button>
        )}
      </div>

      {rejecting && (
        <form onSubmit={reject} className="mt-4 space-y-2 rounded-md border border-line bg-paper p-4">
          <label htmlFor={`why-${course.id}`} className="block text-sm font-medium">What should the instructor change?</label>
          <textarea id={`why-${course.id}`} rows={3} required minLength={5} className={inputClass} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="They'll see this in their notifications." />
          <div className="flex gap-3">
            <Button type="submit" disabled={decide.isPending || comment.trim().length < 5}>{decide.isPending ? "Sending…" : course.status === "approved" ? "Unpublish and send" : "Reject and send"}</Button>
            <Button type="button" variant="quiet" onClick={() => setRejecting(false)}>Cancel</Button>
          </div>
        </form>
      )}
      <div className="mt-2"><ErrorMessage error={decide.error} /></div>
    </li>
  );
}

export default function CoursesPage() {
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, isPending } = useQuery({ queryKey: ["admin-courses", status, q, page], queryFn: () => adminApi.courses({ status, q, page }) });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button key={f.value} role="tab" aria-selected={status === f.value} onClick={() => { setStatus(f.value); setPage(1); }}
              className={`rounded-md border px-3 py-1.5 text-sm ${status === f.value ? "border-pen bg-pen text-white" : "border-line bg-white hover:border-pen"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setQ(search.trim()); setPage(1); }} className="flex gap-2">
          <label htmlFor="course-search" className="sr-only">Search courses or instructors</label>
          <input id="course-search" type="search" className={`${inputClass} w-64`} placeholder="Search courses or instructors" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
      </div>

      <ErrorMessage error={error} />
      {isPending && <Loading label="Loading courses" />}
      {data && data.data.length === 0 && (
        <p className="py-12 text-muted">{status === "pending" && !q ? "Nothing is waiting for approval. You're all caught up." : "No courses match."}</p>
      )}
      {data && data.data.length > 0 && <ul className="mt-6 space-y-4">{data.data.map((c) => <CourseRow key={c.id} course={c} />)}</ul>}
      {data && <Pager pagination={data.pagination} onPage={setPage} />}
    </div>
  );
}
