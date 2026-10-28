import { useQuery } from "@tanstack/react-query";
import { useT } from "../../i18n";
import { communityApi } from "../../services/lms";
import type { LeaderboardRow } from "../../services/types";
import { ErrorMessage, Loading } from "../common/Feedback";

export function LeaderboardCard({ courseId }: { courseId: string }) {
  const { t } = useT();
  const { data, error, isPending } = useQuery({ queryKey: ["leaderboard", courseId], queryFn: () => communityApi.leaderboard(courseId), staleTime: 60_000 });
  if (isPending) return <Loading label={t("community.loading")} />;
  if (error) return <ErrorMessage error={error} />;
  if (data.participants === 0 || (data.top.every((r) => r.points === 0) && !data.me)) {
    return <p className="py-6 text-muted">{t("community.leaderboardEmpty")}</p>;
  }

  const row = (r: LeaderboardRow) => (
    <tr key={`${r.rank}-${r.name}`} className={r.mine ? "bg-highlight/25 font-medium" : ""} aria-current={r.mine ? "true" : undefined}>
      <td className="px-4 py-3 tabular-nums">{r.rank}</td>
      <td className="px-4 py-3">
        {r.name}
        {r.mine && <span className="ml-2 rounded bg-pen/10 px-2 py-0.5 text-xs text-pen">{t("community.you")}</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">{Math.round(r.points)}</td>
      <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">{Math.round(r.quiz_points)}</td>
      <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">{r.lectures_completed}</td>
    </tr>
  );

  return (
    <div>
      <p className="text-sm text-muted">{data.how_points_work}</p>
      <div className="mt-4 overflow-x-auto rounded-md border border-line bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t("community.leaderboard")}</caption>
          <thead className="border-b border-line text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">{t("community.rank")}</th>
              <th scope="col" className="px-4 py-3 font-medium">{t("community.name")}</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">{t("community.points")}</th>
              <th scope="col" className="hidden px-4 py-3 text-right font-medium sm:table-cell">{t("community.quizPoints")}</th>
              <th scope="col" className="hidden px-4 py-3 text-right font-medium sm:table-cell">{t("community.lectures")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.top.map(row)}
            {data.me && (
              <>
                <tr aria-hidden><td colSpan={5} className="px-4 py-1 text-center text-muted">…</td></tr>
                {row(data.me)}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
