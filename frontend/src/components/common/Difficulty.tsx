const LEVELS: Record<string, number> = { beginner: 1, intermediate: 2, advanced: 3 };

/** Three dots: how many are filled is the difficulty. The word is shown too, so colour is never the only signal. */
export function Difficulty({ level }: { level: string | null }) {
  if (!level) return null;
  const filled = LEVELS[level] ?? 0;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span aria-hidden className="flex gap-0.5">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`h-2 w-2 rounded-full ${i <= filled ? "bg-pen" : "bg-line"}`} />
        ))}
      </span>
      <span className="capitalize">{level}</span>
    </span>
  );
}
