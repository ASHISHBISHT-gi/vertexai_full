import { useId } from "react";

function Star({ fill }: { fill: number }) {
  const id = useId();
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
      <defs>
        <linearGradient id={id}>
          <stop offset={`${fill * 100}%`} stopColor="var(--color-highlight)" />
          <stop offset={`${fill * 100}%`} stopColor="var(--color-line)" />
        </linearGradient>
      </defs>
      <path d="M10 1.5l2.5 5.3 5.8.7-4.3 4 1.1 5.7L10 14.4 4.9 17.2 6 11.5 1.7 7.5l5.8-.7z" fill={`url(#${id})`} stroke="var(--color-ink)" strokeOpacity="0.35" strokeWidth="0.8" strokeLinejoin="round" />
    </svg>
  );
}

/** A read-only rating: stars plus the number, with one clear sentence for screen readers. */
export function Stars({ value, count, single = false }: { value: number; count: number; single?: boolean }) {
  if (single)
    return (
      <span className="flex" role="img" aria-label={`${value} out of 5 stars`}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} fill={Math.max(0, Math.min(1, value - i))} />
        ))}
      </span>
    );
  if (count === 0) return <span className="text-xs text-muted">No reviews yet</span>;
  return (
    <span className="inline-flex items-center gap-1.5" role="img" aria-label={`Rated ${value.toFixed(1)} out of 5, from ${count} ${count === 1 ? "review" : "reviews"}`}>
      <span className="flex">{[0, 1, 2, 3, 4].map((i) => <Star key={i} fill={Math.max(0, Math.min(1, value - i))} />)}</span>
      <span className="text-xs text-muted">{value.toFixed(1)} ({count})</span>
    </span>
  );
}

/** Pick 1-5 stars. Built from real radio buttons, so the keyboard (arrow keys) and screen readers just work. */
export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">Your rating</legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer">
            <input type="radio" name="rating" className="peer sr-only" checked={value === n} onChange={() => onChange(n)} />
            <span className="sr-only">{n} {n === 1 ? "star" : "stars"}</span>
            <span aria-hidden className="block rounded p-0.5 peer-focus-visible:outline-2 peer-focus-visible:outline-pen">
              <svg viewBox="0 0 20 20" className="h-7 w-7">
                <path d="M10 1.5l2.5 5.3 5.8.7-4.3 4 1.1 5.7L10 14.4 4.9 17.2 6 11.5 1.7 7.5l5.8-.7z" fill={n <= value ? "var(--color-highlight)" : "var(--color-line)"} stroke="var(--color-ink)" strokeOpacity="0.4" strokeWidth="0.8" strokeLinejoin="round" />
              </svg>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
