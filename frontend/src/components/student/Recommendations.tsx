import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { learnExtrasApi } from "../../services/lms";
import { formatPrice } from "../../utils/format";
import { Difficulty } from "../common/Difficulty";

export function Recommendations() {
  const { data } = useQuery({ queryKey: ["recommendations"], queryFn: learnExtrasApi.recommendations, retry: false });
  if (!data || data.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold">Recommended for you</h2>
      <ul className="mt-4 grid gap-4 md:grid-cols-3">
        {data.slice(0, 3).map((c) => (
          <li key={c.id}>
            <Link to={`/courses/${c.id}`} className="flex h-full flex-col rounded-md border border-line bg-white p-4 transition-colors hover:border-pen">
              <span className="font-semibold leading-snug">{c.title}</span>
              <span className="mt-1 text-sm text-muted">{c.instructor_name}</span>
              <span className="mt-3 flex-1 text-sm">{c.reason}</span>
              <span className="mt-3 flex items-center justify-between">
                <Difficulty level={c.difficulty} />
                <span className="text-sm font-medium">{formatPrice(c.price)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
