import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { aiApi } from "../../services/lms";
import { Button } from "../common/Button";
import { ErrorMessage } from "../common/Feedback";

const LEVELS = ["beginner", "intermediate", "advanced"] as const;

export function SummaryPanel({ lectureId }: { lectureId: string }) {
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("intermediate");
  const summarize = useMutation({ mutationFn: () => aiApi.summarize(lectureId, level) });

  return (
    <section className="mt-6 rounded-md border border-line bg-white p-5" aria-label="Lecture summary">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">Short on time?</h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            Level
            <select className="rounded-md border border-line bg-white px-2 py-1.5 text-ink capitalize" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <Button variant="secondary" onClick={() => summarize.mutate()} disabled={summarize.isPending}>
            {summarize.isPending ? "Summarising…" : summarize.data ? "Summarise again" : "Summarise this lecture"}
          </Button>
        </div>
      </div>
      <div className="mt-3"><ErrorMessage error={summarize.error} /></div>
      {summarize.data && (
        <div className="mt-4">
          <p className="leading-relaxed">{summarize.data.summary}</p>
          <p className="mt-4 text-sm font-medium">Key points</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
            {summarize.data.key_points.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
