import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { contentApi } from "../../services/lms";
import type { CourseDetail } from "../../services/types";
import { formatDuration } from "../../utils/format";
import { readVideoDuration } from "../../utils/video";
import { Button, buttonClass } from "../common/Button";
import { ErrorMessage } from "../common/Feedback";
import { inputClass } from "../common/Field";
import { MaterialsEditor } from "../course/Materials";
import { TranscriptEditor } from "./TranscriptEditor";

function AddLecture({ moduleId, onDone }: { moduleId: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const add = useMutation({
    mutationFn: () => contentApi.addLecture(moduleId, title),
    onSuccess: () => {
      setTitle("");
      onDone();
    },
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) add.mutate();
  };
  return (
    <form onSubmit={onSubmit} className="flex gap-2 p-3">
      <label htmlFor={`lec-${moduleId}`} className="sr-only">New lecture title</label>
      <input id={`lec-${moduleId}`} className={inputClass} placeholder="New lecture title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Button type="submit" variant="secondary" disabled={add.isPending || !title.trim()}>Add lecture</Button>
      <ErrorMessage error={add.error} />
    </form>
  );
}

export function ContentTab({ course }: { course: CourseDetail }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["course", course.id] });
  const [moduleTitle, setModuleTitle] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  // which lecture has which side panel open: {lecture id, "transcript" | "materials"}
  const [panel, setPanel] = useState<{ id: string; kind: "transcript" | "materials" } | null>(null);
  const toggle = (id: string, kind: "transcript" | "materials") => setPanel(panel?.id === id && panel.kind === kind ? null : { id, kind });
  const [error, setError] = useState<unknown>(null);

  const addModule = useMutation({
    mutationFn: () => contentApi.addModule(course.id, moduleTitle),
    onSuccess: () => {
      setModuleTitle("");
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (v: { kind: "lecture" | "module"; id: string }) => (v.kind === "lecture" ? contentApi.deleteLecture(v.id) : contentApi.deleteModule(v.id)),
    onSuccess: refresh,
    onError: setError,
  });

  async function upload(lectureId: string, file: File) {
    setError(null);
    setUploading(lectureId);
    try {
      const duration = await readVideoDuration(file);
      await contentApi.uploadVideo(lectureId, file, duration);
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setUploading(null);
    }
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (moduleTitle.trim()) addModule.mutate();
        }}
        className="flex flex-wrap gap-2"
      >
        <label htmlFor="new-module" className="sr-only">New module title</label>
        <input id="new-module" className={`${inputClass} max-w-sm`} placeholder="New module title, e.g. Sorting algorithms" value={moduleTitle} onChange={(e) => setModuleTitle(e.target.value)} />
        <Button type="submit" disabled={addModule.isPending || !moduleTitle.trim()}>Add module</Button>
      </form>
      <div className="mt-2 space-y-2"><ErrorMessage error={addModule.error} /><ErrorMessage error={error} /></div>

      {course.modules.length === 0 && <p className="mt-8 text-muted">Start by adding a module, then add lectures to it.</p>}

      <div className="mt-6 space-y-6">
        {course.modules.map((m) => (
          <section key={m.id} className="rounded-md border border-line bg-white">
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h3 className="font-semibold">{m.title}</h3>
              <button
                className="text-sm text-muted hover:text-danger"
                onClick={() => window.confirm(`Delete the module "${m.title}" and everything in it?`) && remove.mutate({ kind: "module", id: m.id })}
              >
                Delete module
              </button>
            </header>
            <ul className="divide-y divide-line">
              {m.lectures.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <span className="min-w-40 flex-1 font-medium">{l.title}</span>
                  <span className={l.has_video ? "text-ok" : "text-muted"}>
                    {l.has_video ? `Video uploaded${l.duration_seconds ? ` (${formatDuration(l.duration_seconds)})` : ""}` : "No video yet"}
                  </span>
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${l.ai_indexed ? "bg-ok/10 text-ok" : l.has_transcript ? "bg-highlight/40" : "bg-line text-muted"}`}>
                    {l.ai_indexed ? "AI-ready" : l.has_transcript ? "Transcript not indexed" : "No transcript"}
                  </span>
                  <Button variant="secondary" aria-expanded={panel?.id === l.id && panel.kind === "transcript"} onClick={() => toggle(l.id, "transcript")}>
                    {panel?.id === l.id && panel.kind === "transcript" ? "Close transcript" : "Transcript"}
                  </Button>
                  <Button variant="secondary" aria-expanded={panel?.id === l.id && panel.kind === "materials"} onClick={() => toggle(l.id, "materials")}>
                    {panel?.id === l.id && panel.kind === "materials" ? "Close materials" : "Materials"}
                  </Button>
                  <span>
                    <input
                      id={`video-${l.id}`}
                      type="file"
                      accept="video/mp4,video/webm,.mp4,.webm"
                      className="peer sr-only"
                      disabled={uploading === l.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void upload(l.id, file);
                      }}
                    />
                    <label htmlFor={`video-${l.id}`} className={`${buttonClass("secondary")} cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-pen`}>
                      {uploading === l.id ? "Uploading…" : l.has_video ? "Replace video" : "Upload video"}
                    </label>
                  </span>
                  <button className="text-muted hover:text-danger" onClick={() => window.confirm(`Delete "${l.title}"?`) && remove.mutate({ kind: "lecture", id: l.id })}>
                    Delete
                  </button>
                  {panel?.id === l.id && panel.kind === "transcript" && <div className="-mx-4 -mb-3 basis-full"><TranscriptEditor lectureId={l.id} courseId={course.id} /></div>}
                  {panel?.id === l.id && panel.kind === "materials" && <div className="-mx-4 -mb-3 basis-full"><MaterialsEditor lectureId={l.id} /></div>}
                </li>
              ))}
            </ul>
            <div className="border-t border-line"><AddLecture moduleId={m.id} onDone={refresh} /></div>
          </section>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted">Videos must be MP4 or WebM. Large files can take a while to upload.</p>
    </div>
  );
}
