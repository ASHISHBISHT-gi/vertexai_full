import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { Button, buttonClass } from "../../components/common/Button";
import { ErrorMessage, Loading } from "../../components/common/Feedback";
import { inputClass } from "../../components/common/Field";
import { quizzesApi } from "../../services/lms";
import type { AttemptResult, Quiz, QuizQuestion } from "../../services/types";

type Answers = Record<string, { selected: string[]; text: string }>;

function QuestionInput({ q, value, onChange }: { q: QuizQuestion; value: Answers[string]; onChange: (v: Answers[string]) => void }) {
  if (q.question_type === "short_answer") {
    return (
      <>
        <label htmlFor={`q-${q.id}`} className="sr-only">Your answer</label>
        <input id={`q-${q.id}`} className={inputClass} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} placeholder="Type your answer" />
      </>
    );
  }
  const multi = q.question_type === "multi_select";
  return (
    <div className="space-y-2">
      {q.options.map((o) => {
        const checked = value.selected.includes(o.id);
        return (
          <label key={o.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-line px-3 py-2.5 text-sm hover:border-pen has-[:checked]:border-pen has-[:checked]:bg-pen/5">
            <input
              type={multi ? "checkbox" : "radio"}
              name={q.id}
              checked={checked}
              onChange={() =>
                onChange({ ...value, selected: multi ? (checked ? value.selected.filter((id) => id !== o.id) : [...value.selected, o.id]) : [o.id] })
              }
            />
            {o.option_text}
          </label>
        );
      })}
    </div>
  );
}

function Results({ quiz, result, onRetry }: { quiz: Quiz; result: AttemptResult; onRetry: () => void }) {
  return (
    <div>
      <div className="rounded-md border border-line bg-white p-6">
        {result.score !== null ? (
          <>
            <p className="text-sm text-muted">Your score</p>
            <p className="text-5xl font-semibold">{Math.round(result.score)}%</p>
            <p className="mt-1 text-sm text-muted">{result.earned} of {result.possible} points</p>
          </>
        ) : (
          <p className="text-lg font-medium">Submitted. Your instructor will review your answers.</p>
        )}
        {result.ungraded_count > 0 && result.score !== null && (
          <p className="mt-2 text-sm text-muted">{result.ungraded_count} {result.ungraded_count === 1 ? "answer isn't" : "answers aren't"} auto-graded and isn't counted in the score.</p>
        )}
        {result.new_badges.length > 0 && <p role="status" className="mt-3 rounded-md bg-ok/10 px-3 py-2 text-sm font-medium text-ok">Badge earned: {result.new_badges.join(", ")}</p>}
      </div>

      <ol className="mt-6 space-y-4">
        {quiz.questions.map((q, i) => {
          const r = result.results.find((x) => x.question_id === q.id)!;
          return (
            <li key={q.id} className="rounded-md border border-line bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <p className="font-medium">{i + 1}. {q.question_text}</p>
                <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${r.correct === true ? "bg-ok/10 text-ok" : r.correct === false ? "bg-danger/10 text-danger" : "bg-line text-muted"}`}>
                  {r.correct === true ? "Correct" : r.correct === false ? "Incorrect" : "Needs review"}
                </span>
              </div>
              {q.question_type === "short_answer" ? (
                <div className="mt-3 space-y-1 text-sm">
                  <p>Your answer: <span className="font-medium">{r.text_answer || "(blank)"}</span></p>
                  {r.accepted_answers.length > 0 && r.correct === false && <p className="text-muted">Accepted answer: {r.accepted_answers.join(", ")}</p>}
                </div>
              ) : (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {q.options.map((o) => {
                    const chosen = r.selected_option_ids.includes(o.id);
                    const isCorrect = r.correct_option_ids.includes(o.id);
                    return (
                      <li key={o.id} className={`flex justify-between gap-3 rounded px-3 py-1.5 ${isCorrect ? "bg-ok/10" : chosen ? "bg-danger/10" : ""}`}>
                        <span>{o.option_text}</span>
                        <span className="text-xs text-muted">{[chosen && "Your answer", isCorrect && "Correct answer"].filter(Boolean).join(" · ")}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-6 flex gap-3">
        <Button onClick={onRetry}>Try again</Button>
        <Link to={`/learn/${quiz.course_id}?tab=quizzes`} className={buttonClass("secondary")}>Back to course</Link>
      </div>
    </div>
  );
}

export default function QuizPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [result, setResult] = useState<AttemptResult | null>(null);

  const quiz = useQuery({ queryKey: ["quiz", id], queryFn: () => quizzesApi.get(id) });

  const start = useMutation({
    mutationFn: () => quizzesApi.start(id),
    onSuccess: (r) => {
      setAttemptId(r.attempt_id);
      setAnswers({});
      setResult(null);
    },
  });
  const submit = useMutation({
    mutationFn: () =>
      quizzesApi.submit(
        attemptId!,
        (quiz.data?.questions ?? []).map((q) => {
          const a = answers[q.id] ?? { selected: [], text: "" };
          return q.question_type === "short_answer" ? { question_id: q.id, text_answer: a.text } : { question_id: q.id, selected_option_ids: a.selected };
        }),
      ),
    onSuccess: (r) => {
      setResult(r);
      setAttemptId(null);
      for (const key of ["quizzes", "streak", "badges"]) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  if (quiz.isPending) return <Loading label="Loading quiz" />;
  if (quiz.error) return <ErrorMessage error={quiz.error} />;

  const q = quiz.data;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };

  return (
    <div className="mx-auto max-w-2xl">
      {!result && <Link to={`/learn/${q.course_id}?tab=quizzes`} className="text-sm text-pen hover:underline">Back to course</Link>}
      <h1 className="mt-1 text-3xl font-semibold">{q.title}</h1>

      {result ? (
        <div className="mt-6"><Results quiz={q} result={result} onRetry={() => start.mutate()} /></div>
      ) : !attemptId ? (
        <div className="mt-6">
          <p className="text-muted">{q.questions.length} {q.questions.length === 1 ? "question" : "questions"}. You can retake it as many times as you like, and your best score is kept.</p>
          <ErrorMessage error={start.error} />
          <Button className="mt-4" onClick={() => start.mutate()} disabled={start.isPending}>{start.isPending ? "Starting…" : "Start quiz"}</Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-6">
          {q.questions.map((question, i) => (
            <fieldset key={question.id} className="rounded-md border border-line bg-white p-5">
              <legend className="px-1 font-medium">{i + 1}. {question.question_text}</legend>
              <p className="mb-3 text-xs text-muted">
                {question.question_type === "multi_select" ? "Select all that apply" : question.question_type === "mcq" ? "Choose one" : "Short answer"} · {question.points} {question.points === 1 ? "point" : "points"}
              </p>
              <QuestionInput q={question} value={answers[question.id] ?? { selected: [], text: "" }} onChange={(v) => setAnswers((prev) => ({ ...prev, [question.id]: v }))} />
            </fieldset>
          ))}
          <ErrorMessage error={submit.error} />
          <Button type="submit" disabled={submit.isPending}>{submit.isPending ? "Submitting…" : "Submit answers"}</Button>
        </form>
      )}
    </div>
  );
}
