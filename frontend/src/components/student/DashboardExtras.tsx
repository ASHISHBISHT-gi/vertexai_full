import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { certificatesApi, gamificationApi } from "../../services/lms";
import { formatDate } from "../../utils/format";
import { Button } from "../common/Button";
import { ErrorMessage } from "../common/Feedback";

export function StreakAndBadges() {
  const streak = useQuery({ queryKey: ["streak"], queryFn: gamificationApi.streak });
  const badges = useQuery({ queryKey: ["badges"], queryFn: gamificationApi.badges });

  return (
    <div className="mt-8 grid gap-5 lg:grid-cols-[16rem_1fr]">
      <div className="rounded-md border border-line bg-white p-5">
        <p className="text-sm text-muted">Learning streak</p>
        <p className="mt-1 text-4xl font-semibold">
          {streak.data?.current_streak ?? 0}
          <span className="ml-1 text-base font-normal text-muted">{streak.data?.current_streak === 1 ? "day" : "days"}</span>
        </p>
        <p className="mt-2 text-sm text-muted">
          {streak.data?.active_today ? "You've learned today." : "Watch a lecture or take a quiz today to keep it going."}
          {streak.data && streak.data.longest_streak > 0 && ` Longest: ${streak.data.longest_streak}.`}
        </p>
      </div>
      <div className="rounded-md border border-line bg-white p-5">
        <p className="text-sm text-muted">Badges</p>
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {badges.data?.map((b) => (
            <li key={b.code} className={`rounded-md border px-3 py-3 ${b.earned_at ? "border-highlight bg-highlight/25" : "border-line"}`}>
              <p className={`text-sm font-medium ${b.earned_at ? "" : "text-muted"}`}>{b.name}</p>
              <p className="mt-0.5 text-xs text-muted">{b.earned_at ? `Earned ${formatDate(b.earned_at)}` : b.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function CertificatesList() {
  const { data } = useQuery({ queryKey: ["certificates"], queryFn: certificatesApi.mine });
  const [error, setError] = useState<unknown>(null);
  if (!data || data.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold">Your certificates</h2>
      <ul className="mt-4 divide-y divide-line rounded-md border border-line bg-white">
        {data.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">{c.course_title}</p>
              <p className="text-sm text-muted">Issued {formatDate(c.issued_at)} · ID {c.code}</p>
            </div>
            <Button variant="secondary" onClick={() => certificatesApi.download(c.id).catch(setError)}>Download PDF</Button>
          </li>
        ))}
      </ul>
      <div className="mt-2"><ErrorMessage error={error} /></div>
    </section>
  );
}
