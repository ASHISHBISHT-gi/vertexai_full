import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { Button } from "../../components/common/Button";
import { ErrorMessage, Loading, PageMessage } from "../../components/common/Feedback";
import { ProgressBar } from "../../components/common/ProgressBar";
import { CommunityPanel } from "../../components/community/CommunityPanel";
import { StudyPanel } from "../../components/ai/StudyPanel";
import { TutorPanel } from "../../components/ai/TutorPanel";
import { AssignmentsPanel } from "../../components/student/AssignmentsPanel";
import { LecturePlayer } from "../../components/student/LecturePlayer";
import { QuizzesPanel } from "../../components/student/QuizzesPanel";
import { useT } from "../../i18n";
import { ApiError } from "../../services/api";
import { aiApi, certificatesApi, learningApi } from "../../services/lms";
import type { LearnLecture, ProgressResult } from "../../services/types";
import { useAuth } from "../../store/auth";
import { formatDuration } from "../../utils/format";

type Tab = "lectures" | "assignments" | "quizzes" | "tutor" | "study" | "community";
const TABS: { id: Tab; label: string }[] = [
  { id: "lectures", label: "Lectures" },
  { id: "assignments", label: "Assignments" },
  { id: "quizzes", label: "Quizzes" },
  { id: "tutor", label: "Ask the tutor" },
  { id: "study", label: "Study" },
  { id: "community", label: "Community" },
];

function CheckMark({ done }: { done: boolean }) {
  return (
    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${done ? "border-pen bg-pen text-white" : "border-line bg-white"}`}>
      {done && (
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <span className="sr-only">{done ? "Completed" : "Not completed"}</span>
    </span>
  );
}

export default function CoursePlayerPage() {
  const { courseId = "" } = useParams();
  // key={courseId}: opening a different course starts with fresh state (selected lecture, notices).
  return <CoursePlayer key={courseId} courseId={courseId} />;
}

function CoursePlayer({ courseId }: { courseId: string }) {
  const { user } = useAuth();
  const { t } = useT();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "lectures";
  // Deep link: /learn/<course>?lecture=<id>&t=75 opens that lecture at 1:15 (the tutor's citations use this).
  const [selectedId, setSelectedId] = useState<string | null>(params.get("lecture"));
  const [focus, setFocus] = useState<{ seconds: number | null; token: number }>({ seconds: params.get("t") ? Number(params.get("t")) : null, token: 0 });
  const [notice, setNotice] = useState("");

  const { data, error, isPending } = useQuery({
    queryKey: ["learn", courseId, user?.id],
    queryFn: () => learningApi.outline(courseId),
  });

  // Which lectures have a transcript the AI can read. Optional: if the AI service is down the page still works.
  const aiStatus = useQuery({ queryKey: ["ai-course-status", courseId], queryFn: () => aiApi.courseStatus(courseId), retry: false });

  // Where to start is decided ONCE, from the first response. Every time you finish a lecture the server's
  // "resume point" moves on, and the player must not jump to another lecture while you're still on this one.
  const startLectureId = useRef<string | null | undefined>(undefined);
  if (data && startLectureId.current === undefined) startLectureId.current = data.resume_lecture_id;

  if (isPending) return <Loading label="Loading course" />;
  if (error instanceof ApiError && error.status === 403) {
    return (
      <PageMessage title="You're not enrolled in this course">
        <Link to={`/courses/${courseId}`} className="text-pen hover:underline">
          Open the course page to enroll
        </Link>
      </PageMessage>
    );
  }
  if (error) return <ErrorMessage error={error} />;

  // Instructors preview the player without tabs. Links to the community (from notifications) go to their course manager instead.
  if (data.is_preview && tab === "community") return <Navigate to={`/teach/courses/${courseId}?${params.toString()}`} replace />;

  const lectures: LearnLecture[] = data.modules.flatMap((m) => m.lectures);
  const current = lectures.find((l) => l.id === (selectedId ?? startLectureId.current)) ?? lectures[0];
  const currentIndex = current ? lectures.indexOf(current) : -1;
  const next = currentIndex >= 0 ? lectures[currentIndex + 1] : undefined;
  const canTrack = !data.is_preview;
  const progress = data.enrollment?.progress_percent ?? 0;

  function onSaved(result: ProgressResult) {
    const messages: string[] = [];
    if (result.certificate) messages.push("You finished the course. Your certificate is ready.");
    if (result.new_badges.length) messages.push(`Badge earned: ${result.new_badges.join(", ")}.`);
    if (messages.length) setNotice(messages.join(" "));
    for (const key of ["learn", "enrollments", "streak", "badges", "certificates"]) queryClient.invalidateQueries({ queryKey: [key] });
  }

  const setTab = (t: Tab) => setParams(t === "lectures" ? {} : { tab: t });
  function openSource(lectureId: string, seconds: number | null) {
    setSelectedId(lectureId);
    setFocus((f) => ({ seconds, token: f.token + 1 }));
    setParams({}); // back to the Lectures tab
  }
  const canSummarize = (id: string) => aiStatus.data?.lectures.find((l) => l.id === id)?.has_transcript ?? false;
  const tabClass = (t: Tab) => `pb-2 text-sm ${tab === t ? "border-b-2 border-pen font-medium" : "text-muted hover:text-ink"}`;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to={`/courses/${courseId}`} className="text-sm text-pen hover:underline">
            Course page
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{data.course.title}</h1>
        </div>
        {canTrack && (
          <div className="w-full max-w-xs">
            <div className="mb-1.5 flex justify-between text-sm">
              <span className="text-muted">Your progress</span>
              <span className="font-medium">{Math.round(progress)}%</span>
            </div>
            <ProgressBar percent={progress} label="Course progress" />
          </div>
        )}
      </div>

      {data.is_preview && <p className="mt-4 rounded-md bg-highlight/40 px-3 py-2 text-sm">You're previewing this course as its instructor. Progress isn't recorded.</p>}

      {notice && (
        <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-ok/30 bg-ok/5 px-4 py-3 text-sm text-ok">
          <span>{notice}</span>
          <button className="underline" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      )}

      {data.certificate && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-white px-4 py-3">
          <p className="text-sm font-medium">You've completed this course.</p>
          <Button variant="secondary" onClick={() => void certificatesApi.download(data.certificate!.id)}>
            Download certificate
          </Button>
        </div>
      )}

      {canTrack && (
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-b border-line" role="tablist" aria-label="Course sections">
          {TABS.map((tb) => (
            <button key={tb.id} role="tab" aria-selected={tab === tb.id} className={tabClass(tb.id)} onClick={() => setTab(tb.id)}>
              {tb.id === "community" ? t("tab.community") : tb.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6">
        {tab === "assignments" && canTrack && <AssignmentsPanel courseId={courseId} />}
        {tab === "quizzes" && canTrack && <QuizzesPanel courseId={courseId} />}
        {tab === "tutor" && canTrack && <TutorPanel courseId={courseId} onOpenSource={openSource} />}
        {tab === "study" && canTrack && <StudyPanel courseId={courseId} />}
        {tab === "community" && canTrack && <CommunityPanel courseId={courseId} />}
        {(tab === "lectures" || !canTrack) &&
          (!current ? (
            <p className="text-muted">This course doesn't have any lectures yet.</p>
          ) : (
            <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
              <LecturePlayer key={`${current.id}:${focus.token}`} lecture={current} canTrack={canTrack} onSaved={onSaved} startAt={current.id === selectedId ? focus.seconds : null} canSummarize={canSummarize(current.id)} onNext={next ? () => { setFocus((f) => ({ seconds: null, token: f.token + 1 })); setSelectedId(next.id); } : undefined} />
              <nav aria-label="Course outline" className="h-fit space-y-5 rounded-md border border-line bg-white p-4">
                {data.modules.map((m) => (
                  <div key={m.id}>
                    <h3 className="text-sm font-semibold">{m.title}</h3>
                    <ul className="mt-2 space-y-1">
                      {m.lectures.map((l) => (
                        <li key={l.id}>
                          <button
                            onClick={() => setSelectedId(l.id)}
                            aria-current={l.id === current.id ? "true" : undefined}
                            className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-paper ${l.id === current.id ? "bg-paper font-medium" : ""}`}
                          >
                            <CheckMark done={l.completed} />
                            <span className="flex-1">{l.title}</span>
                            <span className="text-xs text-muted">{formatDuration(l.duration_seconds)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>
            </div>
          ))}
      </div>
    </div>
  );
}
