import { useId } from "react";
import type { DayCount } from "../../services/types";

const short = (day: string) => new Date(day + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/**
 * A bar chart made of plain divs: no chart library needed for this. The bars are decoration for sighted users;
 * everyone gets the same numbers from the hidden table below it.
 */
export function BarChart({ title, data }: { title: string; data: DayCount[] }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  const total = data.reduce((sum, d) => sum + d.n, 0);
  const titleId = useId();
  return (
    <figure className="rounded-md border border-line bg-white p-5">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span id={titleId} className="font-semibold">{title}</span>
        <span className="text-sm text-muted">{total} in {data.length} days</span>
      </figcaption>
      <div className="mt-4 flex h-32 items-end gap-1" aria-hidden>
        {data.map((d) => (
          <div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${short(d.day)}: ${d.n}`}>
            <div className={`rounded-t-sm ${d.n ? "bg-pen" : "bg-line"}`} style={{ height: d.n ? `${Math.max(6, (d.n / max) * 100)}%` : "3px" }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted" aria-hidden>
        <span>{short(data[0]?.day ?? "1970-01-01")}</span>
        <span>{short(data[data.length - 1]?.day ?? "1970-01-01")}</span>
      </div>
      <table className="sr-only" aria-labelledby={titleId}>
        <thead><tr><th>Day</th><th>Count</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.day}><td>{short(d.day)}</td><td>{d.n}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
