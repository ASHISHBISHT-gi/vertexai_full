import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { BarChart } from "../../components/common/BarChart";
import { ErrorMessage, Loading } from "../../components/common/Feedback";
import { adminApi } from "../../services/lms";
import { formatPrice } from "../../utils/format";

function Stat({ label, value, note }: { label: string; value: string | number; note?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-white p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

export default function OverviewPage() {
  const { data, error, isPending } = useQuery({ queryKey: ["admin-overview"], queryFn: adminApi.overview });
  if (isPending) return <Loading label="Loading the platform overview" />;
  if (error) return <ErrorMessage error={error} />;

  const pending = data.courses_by_status.pending ?? 0;
  return (
    <div className="space-y-8">
      <h2 className="text-xl font-semibold">Platform overview</h2>

      {pending > 0 && (
        <p role="status" className="rounded-md border border-highlight bg-highlight/30 px-4 py-3 text-sm">
          <span className="font-medium">{pending} {pending === 1 ? "course is" : "courses are"} waiting for approval.</span>{" "}
          <Link to="/admin/courses" className="text-pen underline">Review {pending === 1 ? "it" : "them"}</Link>
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users" value={data.users_total} note={`${data.new_users_7d} new this week${data.users_suspended ? `, ${data.users_suspended} suspended` : ""}`} />
        <Stat label="Active learners today" value={data.active_today} note={`${data.active_7d} in the last 7 days`} />
        <Stat label="Enrollments" value={data.enrollments_total} note={`${data.enrollments_7d} this week`} />
        <Stat label="Completion rate" value={`${data.completion_rate}%`} note={`${data.certificates_issued} certificates issued`} />
        <Stat label="Estimated revenue" value={formatPrice(data.estimated_revenue)} note="Listed prices of enrolled courses. There's no payment system yet." />
        <Stat label="Waiting for approval" value={pending} note={<Link to="/admin/courses" className="text-pen hover:underline">Open the queue</Link>} />
        <Stat label="Published courses" value={data.courses_by_status.approved ?? 0} note={`${data.courses_by_status.rejected ?? 0} rejected`} />
        <Stat label="Tutor questions" value={data.tutor_questions_7d} note="in the last 7 days" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <BarChart title="New enrollments per day" data={data.enrollments_per_day} />
        <BarChart title="Sign-ups per day" data={data.signups_per_day} />
        <BarChart title="Tutor questions per day" data={data.tutor_questions_per_day} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section>
          <h3 className="text-lg font-semibold">Most popular courses</h3>
          {data.top_courses.length === 0 ? (
            <p className="mt-2 text-muted">No enrollments yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-md border border-line bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-paper text-muted">
                  <tr><th className="p-3 font-medium">Course</th><th className="p-3 font-medium">Students</th><th className="p-3 font-medium">Avg. progress</th><th className="p-3 font-medium">Rating</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.top_courses.map((c) => (
                    <tr key={c.id}>
                      <td className="p-3"><Link to={`/courses/${c.id}`} className="font-medium hover:text-pen hover:underline">{c.title}</Link><span className="block text-xs text-muted">{c.instructor_name}</span></td>
                      <td className="p-3">{c.enrollments}</td>
                      <td className="p-3">{Math.round(c.avg_progress)}%</td>
                      <td className="p-3">{c.rating === null ? "None yet" : c.rating.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section>
          <h3 className="text-lg font-semibold">Who's here</h3>
          <dl className="mt-3 divide-y divide-line rounded-md border border-line bg-white text-sm">
            {Object.entries(data.users_by_role).map(([role, n]) => (
              <div key={role} className="flex justify-between p-3"><dt className="capitalize">{role}s</dt><dd className="font-medium">{n}</dd></div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
