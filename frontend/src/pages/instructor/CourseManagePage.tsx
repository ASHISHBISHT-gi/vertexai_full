import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { CommunityPanel } from "../../components/community/CommunityPanel";
import { AnalyticsTab } from "../../components/instructor/AnalyticsTab";
import { AssignmentsTab } from "../../components/instructor/AssignmentsTab";
import { ContentTab } from "../../components/instructor/ContentTab";
import { DetailsTab } from "../../components/instructor/DetailsTab";
import { QuizBuilder } from "../../components/instructor/QuizBuilder";
import { ErrorMessage, Loading } from "../../components/common/Feedback";
import { StatusChip } from "../../components/common/StatusChip";
import { coursesApi } from "../../services/lms";
import { useAuth } from "../../store/auth";

const TABS = [
  { id: "content", label: "Content" },
  { id: "details", label: "Details" },
  { id: "assignments", label: "Assignments" },
  { id: "quizzes", label: "Quizzes" },
  { id: "analytics", label: "Analytics" },
  { id: "community", label: "Community" },
] as const;

export default function CourseManagePage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "content";

  const { data: course, error, isPending } = useQuery({ queryKey: ["course", id, user?.id ?? "anonymous"], queryFn: () => coursesApi.get(id) });

  if (isPending) return <Loading label="Loading course" />;
  if (error) return <ErrorMessage error={error} />;
  if (!course.can_edit) return <p className="py-10 text-muted">You can only manage your own courses.</p>;

  return (
    <div>
      <Link to="/teach" className="text-sm text-pen hover:underline">Your courses</Link>
      <div className="mt-1 flex flex-wrap items-center gap-4">
        <h1 className="text-3xl font-semibold">{course.title}</h1>
        <StatusChip status={course.status} />
      </div>

      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-b border-line" role="tablist" aria-label="Course management sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams(t.id === "content" ? {} : { tab: t.id })}
            className={`pb-2 text-sm ${tab === t.id ? "border-b-2 border-pen font-medium" : "text-muted hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "content" && <ContentTab course={course} />}
        {tab === "details" && <DetailsTab course={course} />}
        {tab === "assignments" && <AssignmentsTab courseId={id} />}
        {tab === "quizzes" && <QuizBuilder course={course} />}
        {tab === "analytics" && <AnalyticsTab courseId={id} />}
        {tab === "community" && <CommunityPanel courseId={id} />}
      </div>
    </div>
  );
}
