import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { aiApi } from "../../services/lms";
import type { ChatMessage, TutorMode, TutorSource } from "../../services/types";
import { formatTimestamp } from "../../utils/format";
import { Button } from "../common/Button";
import { ErrorMessage, Loading } from "../common/Feedback";
import { DemoNotice } from "./DemoNotice";

const MODES: { value: TutorMode; label: string }[] = [
  { value: "auto", label: "Auto (adapts to you)" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

/** Turns "[1]" markers in an answer into buttons that open the lecture the claim came from. */
function CitedText({ text, sources, onOpen }: { text: string; sources: TutorSource[]; onOpen: (s: TutorSource) => void }) {
  return (
    <>
      {text.split(/(\[\d+(?:\s*,\s*\d+)*\])/g).map((part, i) => {
        const match = /^\[(\d+(?:\s*,\s*\d+)*)\]$/.exec(part);
        if (!match) return <span key={i}>{part}</span>;
        return (
          <span key={i}>
            {match[1]!.split(",").map((n) => {
              const ref = Number(n.trim());
              const source = sources.find((s) => s.ref === ref);
              return source ? (
                <button key={ref} className="mx-0.5 rounded bg-pen/10 px-1 text-xs font-medium text-pen hover:bg-pen/20" aria-label={`Source ${ref}: ${source.lecture_title}`} onClick={() => onOpen(source)}>
                  {ref}
                </button>
              ) : (
                <span key={ref}>[{ref}]</span>
              );
            })}
          </span>
        );
      })}
    </>
  );
}

function Message({ m, onOpen }: { m: ChatMessage; onOpen: (s: TutorSource) => void }) {
  const mine = m.sender === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-md px-4 py-3 text-sm leading-relaxed ${mine ? "bg-pen text-white" : "border border-line bg-white"}`}>
        <p className="whitespace-pre-wrap">{mine ? m.content : <CitedText text={m.content} sources={m.sources ?? []} onOpen={onOpen} />}</p>
        {!mine && m.sources && m.sources.length > 0 && (
          <div className="mt-3 border-t border-line pt-2">
            <p className="text-xs text-muted">Where this comes from</p>
            <ul className="mt-1.5 flex flex-wrap gap-2">
              {m.sources.map((s) => (
                <li key={s.ref}>
                  <button className="rounded border border-line px-2 py-1 text-xs hover:border-pen hover:text-pen" onClick={() => onOpen(s)}>
                    {s.lecture_title}
                    {s.timestamp_seconds !== null && ` · ${formatTimestamp(s.timestamp_seconds)}`}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function TutorPanel({ courseId, onOpenSource }: { courseId: string; onOpenSource: (lectureId: string, seconds: number | null) => void }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["ai-course-status", courseId], queryFn: () => aiApi.courseStatus(courseId) });
  const sessions = useQuery({ queryKey: ["tutor-sessions", courseId], queryFn: () => aiApi.sessions(courseId) });

  // undefined = "use the most recent chat", null = "a brand-new chat (created when you send the first message)"
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const sessionId = chosen === undefined ? (sessions.data?.[0]?.id ?? null) : chosen;
  const [draftMode, setDraftMode] = useState<TutorMode>("auto");
  const mode = sessions.data?.find((s) => s.id === sessionId)?.mode ?? draftMode;

  const messages = useQuery({ queryKey: ["tutor-messages", sessionId], queryFn: () => aiApi.messages(sessionId!), enabled: !!sessionId });
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: async (text: string) => {
      let id = sessionId;
      if (!id) {
        id = (await aiApi.createSession(courseId, draftMode)).id;
        setChosen(id);
      }
      await aiApi.send(id, text);
      return id;
    },
    onMutate: (text) => setPending(text),
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["tutor-messages", id] });
      queryClient.invalidateQueries({ queryKey: ["tutor-sessions", courseId] });
    },
    onError: (_err, text) => setInput(text), // nothing was saved, so give the student their question back
    onSettled: () => setPending(null),
  });

  const changeMode = useMutation({
    mutationFn: (m: TutorMode) => (sessionId ? aiApi.setMode(sessionId, m) : Promise.resolve({ mode: m })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tutor-sessions", courseId] }),
  });

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [messages.data?.length, pending]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || send.isPending) return;
    setInput("");
    send.mutate(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) submit(e);
  };

  if (status.isPending || sessions.isPending) return <Loading label="Loading the tutor" />;
  if (status.error) return <ErrorMessage error={status.error} />;
  if (!status.data.ready) {
    return (
      <div className="rounded-md border border-line bg-white p-6">
        <h2 className="text-lg font-semibold">The tutor isn't ready for this course yet</h2>
        <p className="mt-1 text-muted">It learns from lecture transcripts, and none have been added and indexed. Ask your instructor to add them.</p>
      </div>
    );
  }

  const open = (s: TutorSource) => onOpenSource(s.lecture_id, s.timestamp_seconds);

  return (
    <section aria-label="AI tutor">
      <DemoNotice />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Ask the tutor</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            Explain at
            <select
              className="rounded-md border border-line bg-white px-2 py-1.5 text-ink"
              value={mode}
              onChange={(e) => {
                setDraftMode(e.target.value as TutorMode);
                changeMode.mutate(e.target.value as TutorMode);
              }}
            >
              {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <Button variant="secondary" onClick={() => setChosen(null)} disabled={!sessionId}>New chat</Button>
        </div>
      </div>

      <div role="log" aria-live="polite" aria-label="Conversation" className="mt-4 h-[26rem] space-y-4 overflow-y-auto rounded-md border border-line bg-paper p-4">
        {messages.data?.length === 0 && !pending && (
          <p className="text-sm text-muted">Ask anything about this course. Answers come only from its lectures, and link back to where they're explained.</p>
        )}
        {!sessionId && !pending && <p className="text-sm text-muted">Ask anything about this course. Answers come only from its lectures, and link back to where they're explained.</p>}
        {messages.data?.map((m) => <Message key={m.id} m={m} onOpen={open} />)}
        {pending && (
          <>
            <Message m={{ id: "pending", sender: "user", content: pending, sources: null, created_at: "" }} onOpen={open} />
            <p role="status" className="text-sm text-muted">Thinking…</p>
          </>
        )}
        <div ref={bottom} />
      </div>

      <form onSubmit={submit} className="mt-3 space-y-2">
        <label htmlFor="tutor-input" className="sr-only">Your question</label>
        <textarea
          id="tutor-input"
          rows={2}
          maxLength={2000}
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm placeholder:text-muted/70 focus:border-pen"
          placeholder="Type your question. Enter to send, Shift+Enter for a new line."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
        />
        <ErrorMessage error={send.error ?? changeMode.error} />
        <Button type="submit" disabled={send.isPending || !input.trim()}>{send.isPending ? "Thinking…" : "Send"}</Button>
      </form>
    </section>
  );
}
