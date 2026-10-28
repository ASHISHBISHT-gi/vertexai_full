import { ApiError } from "../../services/api";

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : "Could not reach the server. Check that the backend is running.";
  return (
    <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

export function PageMessage({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="py-16">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children && <div className="mt-2 max-w-prose text-muted">{children}</div>}
    </div>
  );
}

export const Loading = ({ label = "Loading" }: { label?: string }) => (
  <p role="status" className="py-10 text-muted">
    {label}…
  </p>
);
