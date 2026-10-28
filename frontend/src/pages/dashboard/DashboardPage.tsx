import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { buttonClass } from "../../components/common/Button";
import { Difficulty } from "../../components/common/Difficulty";
import { ErrorMessage, Loading } from "../../components/common/Feedback";
import { ProgressBar } from "../../components/common/ProgressBar";
import { CertificatesList, StreakAndBadges } from "../../components/student/DashboardExtras";
import { Recommendations } from "../../components/student/Recommendations";
import { enrollmentsApi } from "../../services/lms";
import { useAuth } from "../../store/auth";

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, error, isPending } = useQuery({ queryKey: ["enrollments"], queryFn: enrollmentsApi.mine });

  return (
    <div>
      <h1 className="text-3xl font-semibold">Welcome back, {user?.full_name.split(" ")[0]}</h1>

      <StreakAndBadges />

      <h2 className="mt-10 text-xl font-semibold">Your courses</h2>
      {isPending && <Loading label="Loading your courses" />}
      <ErrorMessage error={error} />

      {data && data.length === 0 && (
        <div className="mt-4">
          <p className="text-muted">You haven't enrolled in anything yet.</p>
          <Link to="/courses" className={`${buttonClass("primary")} mt-4`}>
            Browse courses
          </Link>
        </div>
      )}

      {data && data.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-md border border-line bg-white">
          {data.map((e) => (
            <li key={e.id} className="grid gap-3 p-5 sm:grid-cols-[1fr_16rem] sm:items-center sm:gap-8">
              <div>
                <Link to={`/courses/${e.course.id}`} className="text-lg font-medium hover:text-pen hover:underline">
                  {e.course.title}
                </Link>
                <p className="mt-0.5 text-sm text-muted">{e.course.instructor_name}</p>
                <div className="mt-2">
                  <Difficulty level={e.course.difficulty} />
                </div>
              </div>
              <div>
                <Link to={`/learn/${e.course.id}`} className={`${buttonClass(e.progress_percent >= 100 ? "secondary" : "primary")} mb-3 w-full`}>
                  {e.progress_percent >= 100 ? "Review course" : e.progress_percent > 0 ? "Continue learning" : "Start learning"}
                </Link>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="text-muted">Progress</span>
                  <span className="font-medium">{Math.round(e.progress_percent)}%</span>
                </div>
                <ProgressBar percent={e.progress_percent} label={`Progress in ${e.course.title}`} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <Recommendations />

      <CertificatesList />
    </div>
  );
}
