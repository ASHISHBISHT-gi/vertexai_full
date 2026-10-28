import { useQuery } from "@tanstack/react-query";
import { contentApi } from "../../services/lms";
import { ErrorMessage, Loading } from "../common/Feedback";

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-line bg-white p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold">{value}</p>
    </div>
  );
}

export function AnalyticsTab({ courseId }: { courseId: string }) {
  const { data, error, isPending } = useQuery({ queryKey: ["analytics", courseId], queryFn: () => contentApi.analytics(courseId) });
  if (isPending) return <Loading label="Loading analytics" />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <div className="space-y-10">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Students enrolled" value={data.enrolled} />
        <Stat label="Finished the course" value={data.completed} />
        <Stat label="Average progress" value={`${Math.round(data.avg_progress)}%`} />
        <Stat label="Time watched" value={`${Math.round(data.total_watched_seconds / 60)} min`} />
      </div>

      <section>
        <h3 className="text-lg font-semibold">Where students drop off</h3>
        <p className="mt-1 text-sm text-muted">For each lecture: how many enrolled students started it, and how many finished it.</p>
        {data.lectures.length === 0 ? (
          <p className="mt-3 text-muted">No lectures yet.</p>
        ) : (
          <ul className="mt-4 space-y-4 rounded-md border border-line bg-white p-5">
            {data.lectures.map((l) => (
              <li key={l.id}>
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <span className="font-medium">{l.title} <span className="font-normal text-muted">· {l.module_title}</span></span>
                  <span className="text-muted">{l.started} started · {l.completed} finished</span>
                </div>
                <div className="relative mt-1.5 h-3 rounded-sm bg-line" role="img" aria-label={`${pct(l.started, data.enrolled)}% started, ${pct(l.completed, data.enrolled)}% finished`}>
                  <div className="absolute inset-y-0 left-0 rounded-sm bg-pen/30" style={{ width: `${pct(l.started, data.enrolled)}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-sm bg-pen" style={{ width: `${pct(l.completed, data.enrolled)}%` }} />
                </div>
              </li>
            ))}
            <li className="flex gap-5 pt-1 text-xs text-muted">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-pen/30" /> Started</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-pen" /> Finished</span>
            </li>
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-lg font-semibold">Quizzes</h3>
        {data.quizzes.length === 0 ? <p className="mt-3 text-muted">No quizzes yet.</p> : (
          <table className="mt-3 w-full overflow-hidden rounded-md border border-line bg-white text-left text-sm">
            <thead className="bg-paper text-muted"><tr><th className="p-3 font-medium">Quiz</th><th className="p-3 font-medium">Students</th><th className="p-3 font-medium">Attempts</th><th className="p-3 font-medium">Average score</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.quizzes.map((q) => (
                <tr key={q.id}><td className="p-3">{q.title}{!q.is_published && <span className="ml-2 text-xs text-muted">(draft)</span>}</td><td className="p-3">{q.students}</td><td className="p-3">{q.attempts}</td><td className="p-3">{q.avg_score === null ? "None yet" : `${Math.round(q.avg_score)}%`}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3 className="text-lg font-semibold">Assignments</h3>
        {data.assignments.length === 0 ? <p className="mt-3 text-muted">No assignments yet.</p> : (
          <table className="mt-3 w-full overflow-hidden rounded-md border border-line bg-white text-left text-sm">
            <thead className="bg-paper text-muted"><tr><th className="p-3 font-medium">Assignment</th><th className="p-3 font-medium">Submitted</th><th className="p-3 font-medium">Graded</th><th className="p-3 font-medium">Average grade</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.assignments.map((a) => (
                <tr key={a.id}><td className="p-3">{a.title}</td><td className="p-3">{a.submitted}</td><td className="p-3">{a.graded}</td><td className="p-3">{a.avg_grade_percent === null ? "None yet" : `${Math.round(a.avg_grade_percent)}%`}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
