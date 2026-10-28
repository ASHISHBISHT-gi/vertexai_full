import { Navigate, Outlet, useLocation } from "react-router";
import { Loading, PageMessage } from "../components/common/Feedback";
import type { Role } from "../services/types";
import { useAuth } from "../store/auth";

/**
 * Wraps a group of routes. Not logged in -> /login (remembering where you wanted to go).
 * Wrong role -> a "no access" message.
 * NOTE: this only improves the experience. The real security is the backend's requireRole().
 */
export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { user, status, hasRole } = useAuth();
  const location = useLocation();

  if (status === "loading") return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (roles && !hasRole(...roles)) {
    return <PageMessage title="You don't have access to this page">Your account type can't open this section.</PageMessage>;
  }
  return <Outlet />;
}
