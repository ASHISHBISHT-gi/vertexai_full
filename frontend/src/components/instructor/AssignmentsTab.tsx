import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { assignmentsApi } from "../../services/lms";
import type { OwnerAssignment, Submission } from "../../services/types";
import { formatBytes, formatDateTime } from "../../utils/format";
import { Button } from "../common/Button";
import { ErrorMessage, Loading } from "../common/Feedback";
import { TextArea, TextField } from "../common/Field";

function GradeRow({ s, assignment }: { s: Submission; assignment: OwnerAssignment }) {
  const queryClient = useQueryClient();
  const [grade, setGrade] = useState(s.grade?.toString() ?? "");
  const [feedback, setFeedback] = useState(s.feedback ?? "");
  const [downloadError, setDownloadError] = useState<unknown>(null);

  const save = useMutation({
    mutationFn: () => assignmentsApi.grade(s.id, { grade: Number(grade), feedback: feedback || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["submissions", assignment.id] });
      queryClient.invalidateQueries({ queryKey: ["owner-assignments"] });
    },
  });

  return (
    <li className="grid gap-3 p-4 lg:grid-cols-[1fr_auto]">
      <div>
        <p className="font-medium">{s.student_name} <span className="font-normal text-muted">({s.student_email})</span></p>
        <p className="mt-0.5 text-sm text-muted">Submitted {formatDateTime(s.submitted_at)}</p>
        <button className="mt-1 text-sm text-pen hover:underline" onClick={() => assignmentsApi.download(s.id, s.original_name).catch(setDownloadError)}>
          Download {s.original_name} ({formatBytes(s.file_size)})
        </button>
        <ErrorMessage error={downloadError} />
      </div>
      <form
        className="grid gap-2 sm:grid-cols-[6rem_1fr_auto] lg:w-[34rem] lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <TextField label={`Grade (max ${assignment.max_points})`} type="number" min={0} max={assignment.max_points} step="0.5" required value={grade} onChange={(e) => setGrade(e.target.value)} />
        <TextField label="Feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        <Button type="submit" disabled={save.isPending || grade === ""}>{s.grade !== null ? "Update" : "Save grade"}</Button>
        <div className="sm:col-span-3"><ErrorMessage error={save.error} /></div>
      </form>
    </li>
  );
}

function Submissions({ assignment }: { assignment: OwnerAssignment }) {
  const { data, error, isPending } = useQuery({ queryKey: ["submissions", assignment.id], queryFn: () => assignmentsApi.submissions(assignment.id) });
  if (isPending) return <Loading label="Loading submissions" />;
  if (error) return <ErrorMessage error={error} />;
  if (data.length === 0) return <p className="p-4 text-sm text-muted">Nothing submitted yet.</p>;
  return <ul className="divide-y divide-line">{data.map((s) => <GradeRow key={s.id} s={s} assignment={assignment} />)}</ul>;
}

export function AssignmentsTab({ courseId }: { courseId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", instructions: "", due: "", points: "100" });
  // Optional grading criteria shown to students: [{criterion, points}]. Points are kept as text while typing.
  const [rubric, setRubric] = useState<{ criterion: string; points: string }[]>([]);
  const rubricTotal = rubric.reduce((sum, r) => sum + (Number(r.points) || 0), 0);

  const list = useQuery({ queryKey: ["owner-assignments", courseId], queryFn: () => assignmentsApi.forOwner(courseId) });
  const create = useMutation({
    mutationFn: () =>
      assignmentsApi.create({
        course_id: courseId,
        title: form.title,
        instructions: form.instructions || undefined,
        due_date: form.due ? new Date(form.due).toISOString() : undefined,
        max_points: Number(form.points) || 100,
        rubric: rubric.filter((r) => r.criterion.trim() && Number(r.points) > 0).map((r) => ({ criterion: r.criterion.trim(), points: Number(r.points) })),
      }),
    onSuccess: () => {
      setForm({ title: "", instructions: "", due: "", points: "100" });
      setRubric([]);
      queryClient.invalidateQueries({ queryKey: ["owner-assignments", courseId] });
    },
  });
  const remove = useMutation({
    mutationFn: assignmentsApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["owner-assignments", courseId] }),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="space-y-8">
      <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-line bg-white p-5">
        <h3 className="text-lg font-semibold">New assignment</h3>
        <TextField label="Title" required minLength={3} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <TextArea label="Instructions" rows={3} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Deadline" type="datetime-local" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} hint="Leave empty for no deadline." />
          <TextField label="Maximum points" type="number" min={1} max={1000} value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Grading rubric (optional)</legend>
          <p className="text-xs text-muted">Students see these criteria before they submit, so they know what you're looking for.</p>
          {rubric.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={`Criterion ${i + 1}`} className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm" placeholder="e.g. Queries run without errors" value={r.criterion} onChange={(e) => setRubric(rubric.map((x, k) => (k === i ? { ...x, criterion: e.target.value } : x)))} />
              <input aria-label={`Points for criterion ${i + 1}`} type="number" min={0} max={1000} className="w-24 rounded-md border border-line bg-white px-3 py-2 text-sm" placeholder="Points" value={r.points} onChange={(e) => setRubric(rubric.map((x, k) => (k === i ? { ...x, points: e.target.value } : x)))} />
              <button type="button" className="text-sm text-muted hover:text-danger" onClick={() => setRubric(rubric.filter((_, k) => k !== i))}>Remove<span className="sr-only"> criterion {i + 1}</span></button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-4">
            <Button type="button" variant="quiet" onClick={() => setRubric([...rubric, { criterion: "", points: "" }])}>Add a criterion</Button>
            {rubric.length > 0 && (
              <span className={`text-sm ${rubricTotal === (Number(form.points) || 100) ? "text-ok" : "text-muted"}`}>
                Criteria add up to {rubricTotal} of {Number(form.points) || 100} points
              </span>
            )}
          </div>
        </fieldset>
        <ErrorMessage error={create.error} />
        <Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving…" : "Create assignment"}</Button>
      </form>

      {list.isPending && <Loading label="Loading assignments" />}
      <ErrorMessage error={list.error} />
      {list.data?.length === 0 && <p className="text-muted">No assignments yet.</p>}
      <ul className="space-y-4">
        {list.data?.map((a) => (
          <li key={a.id} className="rounded-md border border-line bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <h3 className="font-semibold">{a.title}</h3>
                <p className="text-sm text-muted">
                  {a.due_date ? `Due ${formatDateTime(a.due_date)}` : "No deadline"} · {a.max_points} points · {a.submission_count} submitted
                  {a.ungraded_count > 0 && `, ${a.ungraded_count} to grade`}
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>
                  {open === a.id ? "Hide submissions" : "View submissions"}
                </Button>
                <button className="text-sm text-muted hover:text-danger" onClick={() => window.confirm(`Delete "${a.title}" and all its submissions?`) && remove.mutate(a.id)}>
                  Delete
                </button>
              </div>
            </div>
            {open === a.id && <div className="border-t border-line"><Submissions assignment={a} /></div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
