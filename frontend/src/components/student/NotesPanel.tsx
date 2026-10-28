import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { learningApi } from "../../services/lms";
import { formatTimestamp } from "../../utils/format";
import { Button } from "../common/Button";
import { ErrorMessage } from "../common/Feedback";
import { inputClass } from "../common/Field";

interface Props {
  lectureId: string;
  getTime: () => number; // current position in the video
  seek: (seconds: number) => void; // jump the video to a time
}

export function NotesPanel({ lectureId, getTime, seek }: Props) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"notes" | "bookmarks">("notes");
  const [content, setContent] = useState("");

  const notes = useQuery({ queryKey: ["notes", lectureId], queryFn: () => learningApi.notes(lectureId) });
  const bookmarks = useQuery({ queryKey: ["bookmarks", lectureId], queryFn: () => learningApi.bookmarks(lectureId) });

  const addNote = useMutation({
    mutationFn: () => learningApi.addNote(lectureId, { timestamp_seconds: Math.floor(getTime()), content }),
    onSuccess: () => {
      setContent("");
      queryClient.invalidateQueries({ queryKey: ["notes", lectureId] });
    },
  });
  const removeNote = useMutation({
    mutationFn: learningApi.deleteNote,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes", lectureId] }),
  });
  const addBookmark = useMutation({
    mutationFn: () => learningApi.addBookmark(lectureId, Math.floor(getTime())),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookmarks", lectureId] }),
  });
  const removeBookmark = useMutation({
    mutationFn: learningApi.deleteBookmark,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookmarks", lectureId] }),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (content.trim()) addNote.mutate();
  };

  const tabClass = (active: boolean) => `px-1 pb-2 text-sm ${active ? "border-b-2 border-pen font-medium" : "text-muted hover:text-ink"}`;

  return (
    <section className="mt-6 rounded-md border border-line bg-white p-5" aria-label="Notes and bookmarks">
      <div className="flex gap-6 border-b border-line" role="tablist">
        <button role="tab" aria-selected={tab === "notes"} className={tabClass(tab === "notes")} onClick={() => setTab("notes")}>
          Notes{notes.data ? ` (${notes.data.length})` : ""}
        </button>
        <button role="tab" aria-selected={tab === "bookmarks"} className={tabClass(tab === "bookmarks")} onClick={() => setTab("bookmarks")}>
          Bookmarks{bookmarks.data ? ` (${bookmarks.data.length})` : ""}
        </button>
      </div>

      {tab === "notes" ? (
        <div className="mt-4">
          <form onSubmit={onSubmit} className="space-y-2">
            <label htmlFor="note-text" className="sr-only">
              Write a note
            </label>
            <textarea
              id="note-text"
              rows={2}
              className={inputClass}
              placeholder="Write a note. It's saved at the current moment of the video."
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={addNote.isPending || !content.trim()}>
              Add note
            </Button>
          </form>
          <ErrorMessage error={addNote.error} />
          {notes.data?.length === 0 && <p className="mt-4 text-sm text-muted">No notes on this lecture yet.</p>}
          <ul className="mt-4 space-y-3">
            {notes.data?.map((n) => (
              <li key={n.id} className="flex items-start gap-3 text-sm">
                <button className="shrink-0 rounded bg-pen/10 px-2 py-0.5 font-medium text-pen hover:bg-pen/20" onClick={() => seek(n.timestamp_seconds)} aria-label={`Jump to ${formatTimestamp(n.timestamp_seconds)}`}>
                  {formatTimestamp(n.timestamp_seconds)}
                </button>
                <p className="flex-1 whitespace-pre-wrap">{n.content}</p>
                <button className="text-muted hover:text-danger" onClick={() => removeNote.mutate(n.id)} aria-label="Delete note">
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-4">
          <Button variant="secondary" disabled={addBookmark.isPending} onClick={() => addBookmark.mutate()}>
            Bookmark this moment
          </Button>
          <ErrorMessage error={addBookmark.error} />
          {bookmarks.data?.length === 0 && <p className="mt-4 text-sm text-muted">No bookmarks on this lecture yet.</p>}
          <ul className="mt-4 space-y-2">
            {bookmarks.data?.map((b) => (
              <li key={b.id} className="flex items-center gap-3 text-sm">
                <button className="rounded bg-pen/10 px-2 py-0.5 font-medium text-pen hover:bg-pen/20" onClick={() => seek(b.timestamp_seconds)}>
                  {formatTimestamp(b.timestamp_seconds)}
                </button>
                <span className="flex-1 text-muted">Bookmark</span>
                <button className="text-muted hover:text-danger" onClick={() => removeBookmark.mutate(b.id)} aria-label={`Delete bookmark at ${formatTimestamp(b.timestamp_seconds)}`}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
