import { Link } from "react-router";
import type { CourseSummary } from "../../services/types";
import { assetUrl } from "../../utils/assetUrl";
import { formatPrice } from "../../utils/format";
import { Difficulty } from "../common/Difficulty";
import { Stars } from "../common/Stars";

export function CourseCard({ course }: { course: CourseSummary }) {
  return (
    <Link
      to={`/courses/${course.id}`}
      className="flex flex-col overflow-hidden rounded-md border border-line bg-white transition-colors hover:border-pen"
    >
      {course.thumbnail_url ? (
        <img src={assetUrl(course.thumbnail_url)} alt="" className="h-28 w-full object-cover" />
      ) : (
        <div aria-hidden className="flex h-28 items-end bg-pen/10 p-3 text-4xl font-semibold text-pen/40">
          {course.title.slice(0, 2)}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        {course.category && <p className="text-xs text-muted">{course.category}</p>}
        <h3 className="text-lg font-semibold leading-snug">{course.title}</h3>
        <p className="text-sm text-muted">{course.instructor_name}</p>
        <Stars value={course.rating_avg ?? 0} count={course.rating_count ?? 0} />
        <div className="mt-auto flex items-center justify-between pt-3">
          <Difficulty level={course.difficulty} />
          <span className="text-sm font-medium">{formatPrice(course.price)}</span>
        </div>
      </div>
    </Link>
  );
}
