import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { aiApi, learnExtrasApi } from "../../services/lms";
import { formatDateTime } from "../../utils/format";
import { Button } from "../common/Button";
import { ErrorMessage, Loading } from "../common/Feedback";
import { inputClass } from "../common/Field";
import { DemoNotice } from "./DemoNotice";

function Mastery({ courseId }: { courseId: string }) {
  const { data, error, isPending } = useQuery({ queryKey: ["mastery", courseId], queryFn: () => learnExtrasApi.mastery(courseId) });
  if (isPending) return <Loading label="Loading your mastery" />;
  if (error) return <ErrorMessage error={error} />;
  return (
    <section>
      <h2 className="text-xl font-semibold">How well you know each topic</h2>
      <p className="mt-1 text-sm text-muted">Based on your quiz results. Recent attempts count the most.</p>
      <ul className="mt-4 space-y-4 rounded-md border border-line bg-white p-5">
        {data.map((m) => (
          <li key={m.module_id}>
            <div className="flex justify-between text-sm">
              <span className="font-medium">{m.title}</span>
              <span className="text-muted">{m.score === null ? "No quiz taken yet" : `${Math.round(m.score)}%`}</span>
            </div>
            <div className="mt-1.5 h-2.5 rounded-sm bg-line" role="img" aria-label={m.score === null ? `${m.title}: no quiz taken yet` : `${m.title}: ${Math.round(m.score)} percent`}>
              {m.score !== null && <div className={`h-full rounded-sm ${m.score < 50 ? "bg-danger/70" : m.score < 80 ? "bg-highlight" : "bg-ok"}`} style={{ width: `${m.score}%` }} />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StudyPlan({ courseId }: { courseId: string }) {
  const queryClient = useQueryClient();
  const mastery = useQuery({ queryKey: ["mastery", courseId], queryFn: () => learnExtrasApi.mastery(courseId) });
  const saved = useQuery({ queryKey: ["study-plan", courseId], queryFn: () => aiApi.studyPlan(courseId) });
  const make = useMutation({
    mutationFn: () => aiApi.makeStudyPlan(courseId),
    onSuccess: (r) => queryClient.setQueryData(["study-plan", courseId], { plan: r.plan, generated_at: r.generated_at }),
  });
  const plan = saved.data?.plan;
  const titleOf = (id: string | null) => mastery.data?.find((m) => m.module_id === id)?.title;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Your study plan</h2>
        <Button variant={plan ? "secondary" : "primary"} onClick={() => make.mutate()} disabled={make.isPending}>
          {make.isPending ? "Planning…" : plan ? "Make a new plan" : "Make my study plan"}
        </Button>
      </div>
      <div className="mt-3"><ErrorMessage error={make.error ?? saved.error} /></div>
      {saved.isPending && <Loading label="Loading your plan" />}
      {!plan && !saved.isPending && <p className="mt-2 text-muted">A plan looks at your quiz results, unfinished lectures and deadlines, and suggests what to do next.</p>}
      {plan && (
        <div className="mt-3">
          <p className="leading-relaxed">{plan.summary}</p>
          {saved.data?.generated_at && <p className="mt-1 text-xs text-muted">Made {formatDateTime(saved.data.generated_at)}</p>}
          <ol className="mt-4 space-y-3">
            {plan.steps.map((s, i) => (
              <li key={i} className="rounded-md border border-line bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-semibold">{i + 1}. {s.title}</h3>
                  <span className="text-sm text-muted">about {s.estimated_minutes} min</span>
                </div>
                {titleOf(s.module_id) && <p className="mt-0.5 text-xs text-muted">Topic: {titleOf(s.module_id)}</p>}
                <p className="mt-2 text-sm">{s.why}</p>
                <p className="mt-1 text-sm"><span className="font-medium">Do this: </span>{s.action}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function Flashcards({ courseId }: { courseId: string }) {
  const queryClient = useQueryClient();
  const modules = useQuery({ queryKey: ["mastery", courseId], queryFn: () => learnExtrasApi.mastery(courseId) });
  const [moduleId, setModuleId] = useState("");
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const selected = moduleId || modules.data?.[0]?.module_id || "";

  const cards = useQuery({ queryKey: ["flashcards", selected], queryFn: () => aiApi.flashcards(selected), enabled: !!selected });
  const make = useMutation({
    mutationFn: () => aiApi.makeFlashcards(selected),
    onSuccess: (r) => queryClient.setQueryData(["flashcards", selected], { cards: r.cards }),
  });
  const list = cards.data?.cards ?? [];
  const card = list[Math.min(index, Math.max(list.length - 1, 0))];

  const go = (delta: number) => {
    setIndex((i) => (i + delta + list.length) % list.length);
    setFlipped(false);
  };

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Flashcards</h2>
        <label className="flex items-center gap-2 text-sm text-muted">
          Topic
          <select className={`${inputClass} !w-auto`} value={selected} onChange={(e) => { setModuleId(e.target.value); setIndex(0); setFlipped(false); }}>
            {modules.data?.map((m) => <option key={m.module_id} value={m.module_id}>{m.title}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3"><ErrorMessage error={make.error ?? cards.error} /></div>
      {cards.isPending && selected && <Loading label="Loading flashcards" />}
      {cards.data && list.length === 0 && (
        <div className="mt-2">
          <p className="text-muted">No flashcards for this topic yet. They're made from the lecture transcripts.</p>
          <Button className="mt-3" onClick={() => make.mutate()} disabled={make.isPending}>{make.isPending ? "Making cards…" : "Make flashcards"}</Button>
        </div>
      )}
      {card && (
        <div className="mt-4">
          <button
            onClick={() => setFlipped((f) => !f)}
            aria-label={flipped ? "Answer shown. Click to see the question" : "Question shown. Click to see the answer"}
            className="flex min-h-40 w-full flex-col justify-center rounded-md border border-line bg-white p-8 text-left hover:border-pen"
          >
            <span className="text-xs text-muted">{flipped ? "Answer" : "Question"}</span>
            <span className="mt-2 text-lg leading-snug">{flipped ? card.answer : card.question}</span>
          </button>
          <div className="mt-3 flex items-center justify-between">
            <Button variant="secondary" onClick={() => go(-1)}>Previous</Button>
            <span className="text-sm text-muted">{Math.min(index, list.length - 1) + 1} of {list.length}</span>
            <Button variant="secondary" onClick={() => go(1)}>Next</Button>
          </div>
        </div>
      )}
    </section>
  );
}

export function StudyPanel({ courseId }: { courseId: string }) {
  return (
    <div className="space-y-10">
      <DemoNotice />
      <Mastery courseId={courseId} />
      <StudyPlan courseId={courseId} />
      <Flashcards courseId={courseId} />
    </div>
  );
}
