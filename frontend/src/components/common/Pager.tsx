import type { Pagination } from "../../services/types";
import { Button } from "./Button";

export function Pager({ pagination, onPage }: { pagination: Pagination; onPage: (page: number) => void }) {
  if (pagination.totalPages <= 1) return null;
  return (
    <nav className="mt-6 flex items-center justify-between" aria-label="Pagination">
      <Button variant="secondary" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>Previous</Button>
      <span className="text-sm text-muted">Page {pagination.page} of {pagination.totalPages}</span>
      <Button variant="secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)}>Next</Button>
    </nav>
  );
}
