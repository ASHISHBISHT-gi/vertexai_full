/** A highlighter stroke across a ruled line. */
export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const value = Math.min(100, Math.max(0, percent));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className="h-2.5 w-full rounded-sm bg-line"
    >
      <div className="h-full rounded-sm bg-highlight transition-[width] duration-500" style={{ width: `${value}%` }} />
    </div>
  );
}
