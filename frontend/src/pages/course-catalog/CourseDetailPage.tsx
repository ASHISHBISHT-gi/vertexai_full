import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router";
import { Button, buttonClass } from "../../components/common/Button";
import { Difficulty } from "../../components/common/Difficulty";
import { ErrorMessage, Loading, PageMessage } from "../../components/common/Feedback";
import { StatusChip } from "../../components/common/StatusChip";
import { Stars } from "../../components/common/Stars";
import { ReviewsSection } from "../../components/course/ReviewsSection";
import { assetUrl } from "../../utils/assetUrl";
import { ApiError } from "../../services/api";
import { coursesApi, enrollmentsApi } from "../../services/lms";
import { useAuth } from "../../store/auth";
import { formatDuration, formatPrice } from "../../utils/format";

export default function CourseDetailPage() {
  const { id = "" } = useParams();
  const { user, hasRole } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();

  // The server returns different data depending on who's asking (video links only for enrolled
  // students), so the viewer's id is part of the cache key. Otherwise logging in as someone else
  // could show the previous person's cached copy.
  const key = ["course", id, user?.id ?? "anonymous"];
  const { data: course, error, isPending } = useQuery({ queryKey: key, queryFn: () => coursesApi.get(id) });

  const enroll = useMutation({
    mutationFn: () => enrollmentsApi.enroll(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["course", id] });
      queryClient.invalidateQueries({ queryKey: ["enrollments"] });
    },
  });

  if (isPending) return <Loading label="Loading course" />;
  if (error instanceof ApiError && error.status === 404) {
    return (
      <PageMessage title="Course not found">
        It may have been removed, or it isn't published yet. <Link to="/courses" className="text-pen hover:underline">Back to all courses</Link>
      </PageMessage>
    );
  }
  if (error) return <ErrorMessage error={error} />;

  const lectureCount = course.modules.reduce((n, m) => n + m.lectures.length, 0);
  const totalSeconds = course.modules.reduce((n, m) => n + m.lectures.reduce((s, l) => s + (l.duration_seconds ?? 0), 0), 0);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
      <div>
        <p className="text-sm text-muted">{course.category}</p>
        <h1 className="mt-1 text-3xl font-semibold leading-tight">{course.title}</h1>
        <p className="mt-2 text-muted">Taught by {course.instructor_name}</p>
        <div className="mt-2"><Stars value={course.rating_avg ?? 0} count={course.rating_count ?? 0} /></div>
        {course.description && <p className="mt-6 max-w-prose leading-relaxed">{course.description}</p>}

        <h2 className="mt-10 text-xl font-semibold">What's inside</h2>
        {course.modules.length === 0 ? (
          <p className="mt-2 text-muted">The instructor hasn't added any lessons yet.</p>
        ) : (
          <ol className="mt-4 space-y-5">
            {course.modules.map((m) => (
              <li key={m.id}>
                <h3 className="font-medium">{m.title}</h3>
                <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-white">
                  {m.lectures.map((l) => (
                    <li key={l.id} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                      <span>{l.title}</span>
                      <span className="text-muted">{formatDuration(l.duration_seconds)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      
        <ReviewsSection courseId={course.id} />
      </div>

      <aside className="h-fit space-y-4 rounded-md border border-line bg-white p-5">
        {course.thumbnail_url && <img src={assetUrl(course.thumbnail_url)} alt="" className="aspect-video w-full rounded-md border border-line object-cover" />}
        <p className="text-2xl font-semibold">{formatPrice(course.price)}</p>
        <Difficulty level={course.difficulty} />
        <p className="text-sm text-muted">
          {lectureCount} {lectureCount === 1 ? "lecture" : "lectures"}
          {totalSeconds > 0 && ` · ${formatDuration(totalSeconds)}`}
        </p>

        {course.can_edit && (
          <div className="space-y-2">
            <StatusChip status={course.status} />
            {course.status !== "approved" && <p className="text-sm text-muted">Only you and admins can see this course until it's published.</p>}
            <Link to={`/teach/courses/${id}`} className={`${buttonClass("primary")} w-full`}>
              Manage course
            </Link>
            <Link to={`/learn/${id}`} className={`${buttonClass("secondary")} w-full`}>
              Preview as a student
            </Link>
          </div>
        )}

        {course.is_enrolled ? (
          <div className="space-y-3">
            <p className="font-medium text-ok">You're enrolled</p>
            <Link to={`/learn/${id}`} className={`${buttonClass("primary")} w-full`}>
              Continue learning
            </Link>
          </div>
        ) : !user ? (
          <Link to="/login" state={{ from: location.pathname }} className={`${buttonClass("primary")} w-full`}>
            Log in to enroll
          </Link>
        ) : hasRole("student") ? (
          <>
            <Button className="w-full" disabled={enroll.isPending} onClick={() => enroll.mutate()}>
              {enroll.isPending ? "Enrolling…" : "Enroll"}
            </Button>
            <ErrorMessage error={enroll.error} />
          </>
        ) : null}
      </aside>
    </div>
  );
}
