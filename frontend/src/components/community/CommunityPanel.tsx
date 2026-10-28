import { useState } from "react";
import { useSearchParams } from "react-router";
import { useT } from "../../i18n";
import { Announcements } from "./Announcements";
import { Discussions } from "./Discussions";
import { LeaderboardCard } from "./LeaderboardCard";

type View = "discussions" | "announcements" | "leaderboard";

/**
 * The course's community: discussions, announcements from the instructor, and the leaderboard.
 * Used in the student's course player AND in the instructor's course manager (where the instructor can post and moderate).
 * A link like ...?tab=community&thread=<id> (from a notification) opens that discussion directly.
 */
export function CommunityPanel({ courseId }: { courseId: string }) {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>("discussions");
  const threadId = params.get("thread");

  const openThread = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("thread", id);
    else next.delete("thread");
    setParams(next);
  };

  const views: { id: View; label: string }[] = [
    { id: "discussions", label: t("community.discussions") },
    { id: "announcements", label: t("community.announcements") },
    { id: "leaderboard", label: t("community.leaderboard") },
  ];

  return (
    <div>
      <div role="tablist" aria-label={t("community.sections")} className="flex gap-2">
        {views.map((v) => (
          <button
            key={v.id}
            role="tab"
            id={`community-tab-${v.id}`}
            aria-selected={view === v.id}
            aria-controls="community-panel"
            onClick={() => setView(v.id)}
            className={`rounded-full border px-4 py-1.5 text-sm ${view === v.id ? "border-pen bg-pen text-white" : "border-line bg-white text-ink hover:border-pen"}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="community-panel" aria-labelledby={`community-tab-${view}`} className="mt-6">
        {view === "discussions" && <Discussions courseId={courseId} threadId={threadId} onOpen={openThread} />}
        {view === "announcements" && <Announcements courseId={courseId} />}
        {view === "leaderboard" && <LeaderboardCard courseId={courseId} />}
      </div>
    </div>
  );
}
