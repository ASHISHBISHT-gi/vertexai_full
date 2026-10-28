import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "../../components/common/Button";
import { ErrorMessage, Loading } from "../../components/common/Feedback";
import { inputClass } from "../../components/common/Field";
import { CourseCard } from "../../components/student/CourseCard";
import { CATEGORIES, DIFFICULTIES } from "../../constants";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { coursesApi } from "../../services/lms";

export default function CatalogPage() {
  // The filters live in the URL (?q=sql&category=Databases&page=2), so the page can be
  // bookmarked, shared, and the browser's back button just works.
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const difficulty = params.get("difficulty") ?? "";
  const minRating = params.get("min_rating") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  function update(changes: Record<string, string>, keepPage = false) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!keepPage) next.delete("page"); // a new filter means start from page 1
    setParams(next);
  }

  // Typing updates `search` instantly; the URL (and so the request) only follows 300ms after you stop.
  const [search, setSearch] = useState(q);
  const debouncedSearch = useDebouncedValue(search, 300);
  useEffect(() => {
    if (debouncedSearch !== q) update({ q: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const { data, error, isPending, isFetching } = useQuery({
    queryKey: ["courses", { q, category, difficulty, minRating, page }],
    queryFn: () => coursesApi.list({ q, category, difficulty, min_rating: minRating, page }),
    placeholderData: keepPreviousData, // keep showing the old results while the new ones load
  });

  const hasFilters = !!(q || category || difficulty || minRating);

  return (
    <div>
      <h1 className="text-3xl font-semibold">Courses</h1>

      <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_11rem_11rem_11rem]">
        <input
          type="search"
          aria-label="Search courses"
          placeholder="Search by title or topic"
          className={inputClass}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Category" className={inputClass} value={category} onChange={(e) => update({ category: e.target.value })}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select aria-label="Difficulty" className={`${inputClass} capitalize`} value={difficulty} onChange={(e) => update({ difficulty: e.target.value })}>
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d[0]!.toUpperCase() + d.slice(1)}
            </option>
          ))}
        </select>
        <select aria-label="Rating" className={inputClass} value={minRating} onChange={(e) => update({ min_rating: e.target.value })}>
          <option value="">Any rating</option>
          <option value="4">4 stars and up</option>
          <option value="3">3 stars and up</option>
        </select>
      </div>

      <div className="mt-8" aria-busy={isFetching}>
        {isPending && <Loading label="Loading courses" />}
        <ErrorMessage error={error} />

        {data && data.data.length === 0 && (
          <div className="py-12">
            <p className="text-lg font-medium">No courses match your search</p>
            <p className="mt-1 text-muted">Try a different word, or remove a filter.</p>
            {hasFilters && (
              <Button
                variant="secondary"
                className="mt-4"
                onClick={() => {
                  setSearch("");
                  setParams({});
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        )}

        {data && data.data.length > 0 && (
          <>
            <p className="mb-4 text-sm text-muted">
              {data.pagination.total} {data.pagination.total === 1 ? "course" : "courses"}
            </p>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {data.data.map((course) => (
                <CourseCard key={course.id} course={course} />
              ))}
            </div>

            {data.pagination.totalPages > 1 && (
              <nav className="mt-8 flex items-center justify-between" aria-label="Pagination">
                <Button variant="secondary" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, true)}>
                  Previous
                </Button>
                <span className="text-sm text-muted">
                  Page {data.pagination.page} of {data.pagination.totalPages}
                </span>
                <Button variant="secondary" disabled={page >= data.pagination.totalPages} onClick={() => update({ page: String(page + 1) }, true)}>
                  Next
                </Button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
