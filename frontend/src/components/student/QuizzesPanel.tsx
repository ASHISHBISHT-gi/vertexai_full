import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { quizzesApi } from "../../services/lms";
import { buttonClass } from "../common/Button";
import { ErrorMessage, Loading } from "../common/Feedback";

export function QuizzesPanel({ courseId }: { courseId: string }) {
  const { data, error, isPending } = useQuery({ queryKey: ["quizzes", courseId], queryFn: () => quizzesApi.forCourse(courseId) });

  if (isPending) return <Loading label="Loading quizzes" />;
  if (error) return <ErrorMessage error={error} />;
  if (data.length === 0) return <p className="py-6 text-muted">This course has no quizzes yet.</p>;

  return (
    <ul className="divide-y divide-line rounded-md border border-line bg-white">
      {data.map((q) => (
        <li key={q.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h3 className="text-lg font-medium">{q.title}</h3>
            <p className="mt-0.5 text-sm text-muted">
              {q.module_title} · {q.question_count} {q.question_count === 1 ? "question" : "questions"}
              {q.attempts > 0 && ` · ${q.attempts} ${q.attempts === 1 ? "attempt" : "attempts"}`}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {q.best_score !== null && <p className="text-sm">Best score: <span className="font-semibold">{Math.round(q.best_score)}%</span></p>}
            <Link to={`/quizzes/${q.id}`} className={buttonClass(q.attempts > 0 ? "secondary" : "primary")}>
              {q.attempts > 0 ? "Try again" : "Start quiz"}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
