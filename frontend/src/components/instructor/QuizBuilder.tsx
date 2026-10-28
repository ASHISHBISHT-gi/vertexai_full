import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { aiApi, quizzesApi } from "../../services/lms";
import type { CourseDetail, QuestionType, QuizDraft } from "../../services/types";
import { DemoNotice } from "../ai/DemoNotice";
import { Button } from "../common/Button";
import { ErrorMessage, Loading } from "../common/Feedback";
import { SelectField, TextField, inputClass } from "../common/Field";

interface DraftQuestion {
  text: string;
  type: QuestionType;
  points: string;
  options: { text: string; correct: boolean }[];
  accepted: string; // comma-separated answers that count as correct (short answer)
}

const blankQuestion = (): DraftQuestion => ({
  text: "", type: "mcq", points: "1", accepted: "",
  options: [{ text: "", correct: true }, { text: "", correct: false }],
});

function toDraftQuestion(q: QuizDraft["questions"][number]): DraftQuestion {
  return {
    text: q.question_text, type: q.question_type, points: String(q.points ?? 1),
    accepted: (q.accepted_answers ?? []).join(", "),
    options: q.options?.length ? q.options.map((o) => ({ text: o.option_text, correct: o.is_correct })) : [{ text: "", correct: true }, { text: "", correct: false }],
  };
}

/** Asks the AI to draft questions from a lecture's transcript. Nothing is saved: the draft fills the form below for review. */
function AiDraft({ course, onDraft }: { course: CourseDetail; onDraft: (d: QuizDraft) => void }) {
  const lectures = course.modules.flatMap((m) => m.lectures.filter((l) => l.has_transcript).map((l) => ({ id: l.id, label: `${m.title} · ${l.title}` })));
  const [lectureId, setLectureId] = useState("");
  const [count, setCount] = useState("5");
  const [difficulty, setDifficulty] = useState("medium");
  const generate = useMutation({ mutationFn: () => aiApi.generateQuiz(lectureId || lectures[0]!.id, Number(count), difficulty), onSuccess: onDraft });

  return (
    <section className="space-y-4 rounded-md border border-line bg-white p-5" aria-label="Draft questions with AI">
      <h3 className="text-lg font-semibold">Draft questions with AI</h3>
      <DemoNotice />
      {lectures.length === 0 ? (
        <p className="text-sm text-muted">Add a transcript to a lecture first (Content tab). The AI writes questions from it.</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField label="From lecture" value={lectureId || lectures[0]!.id} onChange={(e) => setLectureId(e.target.value)}>
              {lectures.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </SelectField>
            <SelectField label="Number of questions" value={count} onChange={(e) => setCount(e.target.value)}>
              {[3, 4, 5, 6, 8, 10].map((n) => <option key={n}>{n}</option>)}
            </SelectField>
            <SelectField label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
            </SelectField>
          </div>
          <ErrorMessage error={generate.error} />
          <Button variant="secondary" onClick={() => generate.mutate()} disabled={generate.isPending}>{generate.isPending ? "Drafting…" : "Draft a quiz"}</Button>
        </>
      )}
    </section>
  );
}

export function QuizBuilder({ course }: { course: CourseDetail }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["quizzes", course.id] });
  const [title, setTitle] = useState("");
  const [moduleId, setModuleId] = useState(course.modules[0]?.id ?? "");
  const [questions, setQuestions] = useState<DraftQuestion[]>([blankQuestion()]);
  const [aiSource, setAiSource] = useState<string | null>(null); // lecture id the current form was drafted from

  const list = useQuery({ queryKey: ["quizzes", course.id], queryFn: () => quizzesApi.forCourse(course.id) });

  const create = useMutation({
    mutationFn: () =>
      quizzesApi.create({
        module_id: moduleId,
        title,
        questions: questions.map((q) => ({
          question_text: q.text,
          question_type: q.type,
          points: Number(q.points) || 1,
          ...(q.type === "short_answer"
            ? { accepted_answers: q.accepted.split(",").map((a) => a.trim()).filter(Boolean) }
            : { options: q.options.filter((o) => o.text.trim()).map((o) => ({ option_text: o.text, is_correct: o.correct })) }),
        })),
        // Keep the "made by AI" flag, even after edits, so the quiz list stays honest about where it came from.
        ...(aiSource ? { is_ai_generated: true, generated_from_lecture_id: aiSource } : {}),
      }),
    onSuccess: () => {
      setTitle("");
      setQuestions([blankQuestion()]);
      setAiSource(null);
      refresh();
    },
  });
  const publish = useMutation({ mutationFn: (v: { id: string; on: boolean }) => quizzesApi.setPublished(v.id, v.on), onSuccess: refresh });
  const remove = useMutation({ mutationFn: quizzesApi.remove, onSuccess: refresh });

  const update = (i: number, patch: Partial<DraftQuestion>) => setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const setOption = (i: number, j: number, patch: Partial<DraftQuestion["options"][number]>) =>
    update(i, { options: questions[i]!.options.map((o, k) => (k === j ? { ...o, ...patch } : o)) });
  const markCorrect = (i: number, j: number) => {
    const q = questions[i]!;
    update(i, { options: q.options.map((o, k) => (q.type === "mcq" ? { ...o, correct: k === j } : k === j ? { ...o, correct: !o.correct } : o)) });
  };
  const changeType = (i: number, type: QuestionType) => {
    const q = questions[i]!;
    // Multiple choice allows exactly one correct option, so keep just the first marked one.
    const firstCorrect = q.options.findIndex((o) => o.correct);
    update(i, { type, options: type === "mcq" ? q.options.map((o, k) => ({ ...o, correct: k === Math.max(firstCorrect, 0) })) : q.options });
  };

  if (course.modules.length === 0) return <p className="text-muted">Add a module on the Content tab first. Every quiz belongs to a module.</p>;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="space-y-8">
      <AiDraft
        course={course}
        onDraft={(d) => {
          setTitle(d.title);
          setModuleId(d.module_id);
          setQuestions(d.questions.map(toDraftQuestion));
          setAiSource(d.generated_from_lecture_id);
        }}
      />
      <form onSubmit={onSubmit} className="space-y-5 rounded-md border border-line bg-white p-5">
        <h3 className="text-lg font-semibold">New quiz</h3>
        {aiSource && (
          <div role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-highlight bg-highlight/30 px-4 py-3 text-sm">
            <p><span className="font-medium">AI draft.</span> Read every question and check the marked correct answer before you publish: AI makes mistakes. Nothing is saved until you press Save quiz.</p>
            <button type="button" className="underline" onClick={() => { setAiSource(null); setTitle(""); setQuestions([blankQuestion()]); }}>Discard draft</button>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Quiz title" required minLength={3} value={title} onChange={(e) => setTitle(e.target.value)} />
          <SelectField label="Module" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
            {course.modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </SelectField>
        </div>

        {questions.map((q, i) => (
          <fieldset key={i} className="space-y-3 rounded-md border border-line p-4">
            <legend className="px-1 text-sm font-medium">Question {i + 1}</legend>
            <TextField label="Question" required value={q.text} onChange={(e) => update(i, { text: e.target.value })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField label="Type" value={q.type} onChange={(e) => changeType(i, e.target.value as QuestionType)}>
                <option value="mcq">Multiple choice (one answer)</option>
                <option value="multi_select">Multi-select (several answers)</option>
                <option value="short_answer">Short answer</option>
              </SelectField>
              <TextField label="Points" type="number" min={1} max={100} value={q.points} onChange={(e) => update(i, { points: e.target.value })} />
            </div>

            {q.type === "short_answer" ? (
              <TextField label="Accepted answers" value={q.accepted} onChange={(e) => update(i, { accepted: e.target.value })} hint="Separate with commas. Matching ignores case and extra spaces. Leave empty to review answers yourself." />
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium">Options <span className="font-normal text-muted">({q.type === "mcq" ? "pick the correct one" : "tick every correct one"})</span></p>
                {q.options.map((o, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <input type={q.type === "mcq" ? "radio" : "checkbox"} name={`correct-${i}`} checked={o.correct} onChange={() => markCorrect(i, j)} aria-label={`Option ${j + 1} is correct`} />
                    <input className={inputClass} aria-label={`Option ${j + 1} text`} placeholder={`Option ${j + 1}`} value={o.text} onChange={(e) => setOption(i, j, { text: e.target.value })} />
                    {q.options.length > 2 && (
                      <button type="button" className="text-sm text-muted hover:text-danger" onClick={() => update(i, { options: q.options.filter((_, k) => k !== j) })}>Remove</button>
                    )}
                  </div>
                ))}
                {q.options.length < 8 && (
                  <Button type="button" variant="quiet" onClick={() => update(i, { options: [...q.options, { text: "", correct: false }] })}>Add option</Button>
                )}
              </div>
            )}
            {questions.length > 1 && (
              <button type="button" className="text-sm text-muted hover:text-danger" onClick={() => setQuestions((qs) => qs.filter((_, k) => k !== i))}>Remove question</button>
            )}
          </fieldset>
        ))}

        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={() => setQuestions((qs) => [...qs, blankQuestion()])}>Add question</Button>
          <Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving…" : "Save quiz"}</Button>
        </div>
        <ErrorMessage error={create.error} />
        <p className="text-sm text-muted">New quizzes start as drafts. Students can't see them until you publish.</p>
      </form>

      <section>
        <h3 className="text-lg font-semibold">Your quizzes</h3>
        {list.isPending && <Loading label="Loading quizzes" />}
        <ErrorMessage error={list.error} />
        {list.data?.length === 0 && <p className="mt-2 text-muted">No quizzes yet.</p>}
        {list.data && list.data.length > 0 && (
          <ul className="mt-3 divide-y divide-line rounded-md border border-line bg-white">
            {list.data.map((qz) => (
              <li key={qz.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{qz.title}{qz.is_ai_generated && <span className="ml-2 rounded bg-pen/10 px-1.5 py-0.5 text-xs font-medium text-pen">AI-generated</span>}</p>
                  <p className="text-sm text-muted">{qz.module_title} · {qz.question_count} questions · {qz.attempts} attempts</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${qz.is_published ? "bg-ok/10 text-ok" : "bg-highlight/40"}`}>{qz.is_published ? "Published" : "Draft"}</span>
                  <Button variant="secondary" disabled={publish.isPending} onClick={() => publish.mutate({ id: qz.id, on: !qz.is_published })}>{qz.is_published ? "Unpublish" : "Publish"}</Button>
                  <button className="text-sm text-muted hover:text-danger" onClick={() => window.confirm(`Delete "${qz.title}" and all its attempts?`) && remove.mutate(qz.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2"><ErrorMessage error={publish.error ?? remove.error} /></div>
      </section>
    </div>
  );
}
