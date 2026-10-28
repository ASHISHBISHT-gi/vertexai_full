import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { aiApi, contentApi } from "../../services/lms";
import { Button } from "../common/Button";
import { ErrorMessage, Loading } from "../common/Feedback";
import { inputClass } from "../common/Field";

/**
 * The AI tutor learns from this text. Saving does two things: store the transcript (Node API), then ask the
 * AI service to read it (cut into passages, turn them into vectors, store them for searching).
 */
export function TranscriptEditor({ lectureId, courseId }: { lectureId: string; courseId: string }) {
  const queryClient = useQueryClient();
  const saved = useQuery({ queryKey: ["transcript", lectureId], queryFn: () => contentApi.getTranscript(lectureId) });
  const [edited, setEdited] = useState<string | null>(null);
  const [fileError, setFileError] = useState("");
  const text = edited ?? saved.data?.transcript ?? "";

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["transcript", lectureId] });
    queryClient.invalidateQueries({ queryKey: ["course", courseId] });
    queryClient.invalidateQueries({ queryKey: ["ai-course-status", courseId] });
  };

  const save = useMutation({
    mutationFn: async () => {
      await contentApi.saveTranscript(lectureId, text);
      setEdited(null);
      if (!text.trim()) return { chunks: 0, indexError: null as unknown };
      try {
        return { chunks: (await aiApi.indexLecture(lectureId)).chunks, indexError: null as unknown };
      } catch (indexError) {
        return { chunks: 0, indexError }; // the transcript IS saved; only the AI step failed
      }
    },
    onSuccess: refresh,
  });
  const retryIndex = useMutation({ mutationFn: () => aiApi.indexLecture(lectureId), onSuccess: refresh });

  async function loadFile(file: File) {
    setFileError("");
    if (file.size > 500_000) return setFileError("That file is too large for a transcript (500 KB maximum).");
    setEdited(await file.text());
  }

  if (saved.isPending) return <Loading label="Loading transcript" />;

  const result = save.data;
  return (
    <div className="space-y-3 border-t border-line bg-paper p-4">
      <p className="text-sm text-muted">
        Paste the lecture's text, or load a subtitle file (.vtt or .srt). With timestamps, the tutor can send students to the exact moment that answers their question.
      </p>
      <label htmlFor={`tr-${lectureId}`} className="sr-only">Transcript</label>
      <textarea id={`tr-${lectureId}`} rows={9} className={`${inputClass} font-mono`} value={text} onChange={(e) => setEdited(e.target.value)} placeholder="Transcript text…" />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending || (edited === null && !!saved.data?.ai_indexed)}>
          {save.isPending ? "Saving and indexing…" : "Save and index for the AI"}
        </Button>
        <span>
          <input id={`trf-${lectureId}`} type="file" accept=".vtt,.srt,.txt,text/plain,text/vtt" className="peer sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void loadFile(f); }} />
          <label htmlFor={`trf-${lectureId}`} className="inline-flex cursor-pointer items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:border-pen peer-focus-visible:outline-2 peer-focus-visible:outline-pen">
            Load a file
          </label>
        </span>
        {saved.data?.ai_indexed && edited === null && <span className="text-sm text-ok">The AI has read this ({saved.data.indexed_chunks} passages).</span>}
      </div>
      <ErrorMessage error={save.error ?? retryIndex.error} />
      {fileError && <p role="alert" className="text-sm text-danger">{fileError}</p>}
      {result && !result.indexError && result.chunks > 0 && <p role="status" className="text-sm text-ok">Saved. The AI tutor can now answer from this lecture ({result.chunks} passages).</p>}
      {result && !text.trim() && <p role="status" className="text-sm text-muted">Transcript removed. The AI tutor has forgotten this lecture.</p>}
      {result?.indexError != null && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm">
          <p className="font-medium text-danger">Saved, but the AI couldn't read it yet.</p>
          <div className="mt-1"><ErrorMessage error={result.indexError} /></div>
          <Button variant="secondary" className="mt-2" onClick={() => retryIndex.mutate()} disabled={retryIndex.isPending}>{retryIndex.isPending ? "Trying…" : "Try indexing again"}</Button>
        </div>
      )}
    </div>
  );
}
