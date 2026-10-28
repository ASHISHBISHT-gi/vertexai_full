import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { assignmentsApi } from "../../services/lms";
import type { StudentAssignment } from "../../services/types";
import { formatDateTime } from "../../utils/format";
import { Button } from "../common/Button";
import { ErrorMessage, Loading } from "../common/Feedback";
import { inputClass } from "../common/Field";

const ACCEPT = ".pdf,.zip,.txt,.md,.py,.js,.ts,.java,.c,.cpp,.h,.sql,.json,.html,.css,.ipynb";

function SubmitForm({ assignment, courseId }: { assignment: StudentAssignment; courseId: string }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const submit = useMutation({
    mutationFn: () => assignmentsApi.submit(assignment.id, file!),
    onSuccess: () => {
      setFile(null);
      if (input.current) input.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["assignments", courseId] });
      queryClient.invalidateQueries({ queryKey: ["streak"] });
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (file) submit.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-2">
      <label htmlFor={`file-${assignment.id}`} className="block text-sm font-medium">
        {assignment.submission ? "Replace your submission" : "Upload your work"}
      </label>
      <input
        id={`file-${assignment.id}`}
        ref={input}
        type="file"
        accept={ACCEPT}
        className={inputClass}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <p className="text-xs text-muted">PDF, ZIP or a code file, up to 10 MB.</p>
      <ErrorMessage error={submit.error} />
      <Button type="submit" disabled={!file || submit.isPending}>
        {submit.isPending ? "Uploading…" : assignment.submission ? "Replace submission" : "Submit"}
      </Button>
    </form>
  );
}

export function AssignmentsPanel({ courseId }: { courseId: string }) {
  const { data, error, isPending } = useQuery({ queryKey: ["assignments", courseId], queryFn: () => assignmentsApi.forStudent(courseId) });

  if (isPending) return <Loading label="Loading assignments" />;
  if (error) return <ErrorMessage error={error} />;
  if (data.length === 0) return <p className="py-6 text-muted">This course has no assignments.</p>;

  return (
    <ul className="space-y-5">
      {data.map((a) => (
        <li key={a.id} className="rounded-md border border-line bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">{a.title}</h3>
              <p className="mt-0.5 text-sm text-muted">
                {a.due_date ? `${a.is_past_due ? "Was due" : "Due"} ${formatDateTime(a.due_date)}` : "No deadline"} · {a.max_points} points
              </p>
            </div>
            {a.status === "graded" && a.submission?.grade != null ? (
              <p className="rounded bg-ok/10 px-2.5 py-1 text-sm font-medium text-ok">
                Graded: {a.submission.grade} / {a.max_points}
              </p>
            ) : a.status === "submitted" ? (
              <p className="rounded bg-highlight/40 px-2.5 py-1 text-sm font-medium">Submitted, waiting for grade</p>
            ) : a.is_past_due ? (
              <p className="rounded bg-danger/10 px-2.5 py-1 text-sm font-medium text-danger">Missed</p>
            ) : (
              <p className="rounded bg-line px-2.5 py-1 text-sm font-medium text-muted">Not submitted</p>
            )}
          </div>

          {a.instructions && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{a.instructions}</p>}
          {a.rubric && a.rubric.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium">How it's graded</p>
              <ul className="mt-1 text-sm text-muted">
                {a.rubric.map((r) => (
                  <li key={r.criterion}>
                    {r.criterion}: {r.points} points
                  </li>
                ))}
              </ul>
            </div>
          )}

          {a.submission && (
            <p className="mt-3 text-sm">
              Your file: <span className="font-medium">{a.submission.original_name}</span>{" "}
              <span className="text-muted">({formatDateTime(a.submission.submitted_at)})</span>
            </p>
          )}
          {a.submission?.feedback && (
            <p className="mt-2 rounded-md bg-paper px-3 py-2 text-sm">
              <span className="font-medium">Feedback: </span>
              {a.submission.feedback}
            </p>
          )}

          {a.status !== "graded" && !a.is_past_due && <SubmitForm assignment={a} courseId={courseId} />}
        </li>
      ))}
    </ul>
  );
}
