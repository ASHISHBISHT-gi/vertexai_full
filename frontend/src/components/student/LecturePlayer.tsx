import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../../services/api";
import { learningApi } from "../../services/lms";
import type { LearnLecture, ProgressResult } from "../../services/types";
import { Button } from "../common/Button";
import { ErrorMessage } from "../common/Feedback";
import { SummaryPanel } from "../ai/SummaryPanel";
import { MaterialsList } from "../course/Materials";
import { NotesPanel } from "./NotesPanel";
import { formatTimestamp } from "../../utils/format";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SAVE_EVERY_MS = 15_000;

interface Props {
  lecture: LearnLecture;
  canTrack: boolean; // false when an instructor is previewing their own course
  onSaved: (result: ProgressResult) => void;
  onNext?: () => void;
  startAt?: number | null; // jump here when opened from a tutor citation
  canSummarize?: boolean; // the lecture has a transcript the AI can read
}

/** Remember to render this with key={lecture.id}, so every lecture starts with fresh state. */
export function LecturePlayer({ lecture, canTrack, onSaved, onNext, startAt = null, canSummarize = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timeRef = useRef(startAt ?? lecture.position_seconds); // last known position (the <video> is gone by the time we unmount)
  const lastSavedAt = useRef(Date.now());
  const retried = useRef(false);
  const [speed, setSpeed] = useState(1);

  // The video file is protected, so we ask the server for a short-lived signed link first.
  const playback = useQuery({
    queryKey: ["playback", lecture.id],
    queryFn: () => learningApi.playback(lecture.id),
    enabled: lecture.has_video,
    staleTime: 20 * 60_000,
  });
  const src = playback.data ? (playback.data.external ? playback.data.url : `${API_BASE}${playback.data.url}`) : undefined;

  async function save(completed = false) {
    if (!canTrack) return;
    lastSavedAt.current = Date.now();
    try {
      onSaved(await learningApi.saveProgress(lecture.id, { position_seconds: Math.floor(timeRef.current), completed }));
    } catch {
      // Saving progress is best-effort: a failed save must never interrupt watching.
    }
  }

  // Save when leaving this lecture (switching lectures or leaving the page).
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => void (timeRef.current > 0 && saveRef.current()), []);

  const seek = (seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = seconds;
    timeRef.current = seconds;
    void Promise.resolve(v.play()).catch(() => {});
  };

  return (
    <div>
      {lecture.has_video ? (
        src ? (
          <video
            ref={videoRef}
            src={src}
            controls
            preload="metadata"
            className="aspect-video w-full rounded-md bg-ink"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              // A tutor citation wins; otherwise resume where the student left off (unless they were almost at the end).
              if (startAt !== null) v.currentTime = Math.min(startAt, Math.max(v.duration - 1, 0));
              else if (lecture.position_seconds > 0 && lecture.position_seconds < v.duration - 5) v.currentTime = lecture.position_seconds;
              v.playbackRate = speed;
            }}
            onTimeUpdate={(e) => {
              timeRef.current = e.currentTarget.currentTime;
              if (Date.now() - lastSavedAt.current > SAVE_EVERY_MS) void save();
            }}
            onPause={() => void save()}
            onEnded={() => void save(true)}
            onError={() => {
              // Most likely the signed link expired mid-session: get a new one, once.
              if (!retried.current) {
                retried.current = true;
                void playback.refetch();
              }
            }}
          />
        ) : playback.error ? (
          <ErrorMessage error={playback.error} />
        ) : (
          <div className="grid aspect-video place-items-center rounded-md border border-line bg-white text-muted">Loading video…</div>
        )
      ) : (
        <div className="grid aspect-video place-items-center rounded-md border border-dashed border-line bg-white px-6 text-center text-muted">
          This lecture doesn't have a video yet.
        </div>
      )}

      {startAt !== null && !lecture.has_video && (
        <p className="mt-3 rounded-md bg-pen/10 px-3 py-2 text-sm">The tutor pointed here: the relevant part starts at {formatTimestamp(startAt)}.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{lecture.title}</h2>
        <div className="flex flex-wrap items-center gap-3">
          {lecture.has_video && (
            <label className="flex items-center gap-2 text-sm text-muted">
              Speed
              <select
                className="rounded-md border border-line bg-white px-2 py-1.5 text-ink"
                value={speed}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setSpeed(next);
                  if (videoRef.current) videoRef.current.playbackRate = next;
                }}
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </label>
          )}
          {canTrack &&
            (lecture.completed ? (
              <span className="text-sm font-medium text-ok">Completed</span>
            ) : (
              <Button variant="secondary" onClick={() => void save(true)}>
                Mark as complete
              </Button>
            ))}
          {onNext && (
            <Button onClick={onNext}>Next lecture</Button>
          )}
        </div>
      </div>

      {canTrack && <MaterialsList lectureId={lecture.id} />}

      {canTrack && canSummarize && <SummaryPanel lectureId={lecture.id} />}

      {canTrack && (
        <NotesPanel lectureId={lecture.id} getTime={() => videoRef.current?.currentTime ?? timeRef.current} seek={seek} />
      )}
    </div>
  );
}
