import type { CourseStatus } from "../../services/types";

const styles: Record<CourseStatus, { text: string; cls: string }> = {
  pending: { text: "Waiting for approval", cls: "bg-highlight/40 text-ink" },
  approved: { text: "Published", cls: "bg-ok/10 text-ok" },
  rejected: { text: "Rejected", cls: "bg-danger/10 text-danger" },
  archived: { text: "Archived", cls: "bg-line text-muted" },
};

export function StatusChip({ status }: { status: CourseStatus }) {
  const { text, cls } = styles[status];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{text}</span>;
}
