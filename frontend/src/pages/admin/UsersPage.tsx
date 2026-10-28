import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "../../components/common/Button";
import { ErrorMessage, Loading } from "../../components/common/Feedback";
import { inputClass } from "../../components/common/Field";
import { Pager } from "../../components/common/Pager";
import { adminApi } from "../../services/lms";
import type { AdminUser, Role } from "../../services/types";
import { useAuth } from "../../store/auth";
import { formatDate } from "../../utils/format";

const ROLES: Role[] = ["student", "instructor", "admin"];
const ROLE_HELP: Record<Role, string> = {
  student: "Can enroll in courses and learn.",
  instructor: "Can create and teach courses.",
  admin: "Can manage everything on the platform.",
};

function UserPanel({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const isMe = me?.id === user.id;
  const [roles, setRoles] = useState<Role[]>(user.roles);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saved, setSaved] = useState("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
  };
  const saveRoles = useMutation({ mutationFn: () => adminApi.setRoles(user.id, roles), onSuccess: () => { setSaved("Roles saved."); refresh(); }, onMutate: () => setSaved("") });
  const suspend = useMutation({
    mutationFn: (suspended: boolean) => adminApi.setSuspended(user.id, suspended, reason.trim() || undefined),
    onSuccess: (r) => { setSaved(r.is_active ? "Account reactivated." : "Account suspended."); setReason(""); refresh(); },
    onMutate: () => setSaved(""),
  });
  const remove = useMutation({ mutationFn: () => adminApi.deleteUser(user.id, confirm), onSuccess: () => { refresh(); onClose(); } });

  const toggle = (r: Role) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const changed = roles.slice().sort().join() !== user.roles.slice().sort().join();
  const onSaveRoles = (e: FormEvent) => {
    e.preventDefault();
    saveRoles.mutate();
  };

  return (
    <div className="grid gap-6 border-t border-line bg-paper p-5 lg:grid-cols-3">
      <form onSubmit={onSaveRoles} className="space-y-3">
        <fieldset>
          <legend className="font-medium">Roles</legend>
          <div className="mt-2 space-y-2">
            {ROLES.map((r) => (
              <label key={r} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={roles.includes(r)} onChange={() => toggle(r)} />
                <span><span className="font-medium capitalize">{r}</span><span className="block text-muted">{ROLE_HELP[r]}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" disabled={!changed || roles.length === 0 || saveRoles.isPending}>{saveRoles.isPending ? "Saving…" : "Save roles"}</Button>
        <p className="text-xs text-muted">Changes reach the person fully the next time they sign in (within about 15 minutes if they're already signed in).</p>
        <ErrorMessage error={saveRoles.error} />
      </form>

      <div className="space-y-3">
        <p className="font-medium">{user.is_active ? "Suspend account" : "Reactivate account"}</p>
        {user.is_active ? (
          <>
            <p className="text-sm text-muted">A suspended person can't sign in and their session ends. Nothing is deleted, and you can reactivate them any time.</p>
            <label htmlFor={`reason-${user.id}`} className="sr-only">Reason (optional)</label>
            <input id={`reason-${user.id}`} className={inputClass} placeholder="Reason (optional, kept in the activity log)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button variant="secondary" disabled={isMe || suspend.isPending} onClick={() => suspend.mutate(true)}>Suspend</Button>
            {isMe && <p className="text-xs text-muted">You can't suspend yourself.</p>}
          </>
        ) : (
          <>
            <p className="text-sm text-muted">This account is suspended.</p>
            <Button disabled={suspend.isPending} onClick={() => suspend.mutate(false)}>Reactivate</Button>
          </>
        )}
        <ErrorMessage error={suspend.error} />
      </div>

      <div className="space-y-3">
        <p className="font-medium text-danger">Delete account</p>
        <p className="text-sm text-muted">
          Permanently removes this person and their enrollments, progress, submissions and certificates. This can't be undone. If they teach courses, suspend them instead.
        </p>
        <label htmlFor={`confirm-${user.id}`} className="block text-sm">Type <span className="font-mono">{user.email}</span> to confirm</label>
        <input id={`confirm-${user.id}`} className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        <Button disabled={isMe || confirm.trim().toLowerCase() !== user.email.toLowerCase() || remove.isPending} onClick={() => remove.mutate()} className="!bg-danger hover:!bg-danger/90">
          {remove.isPending ? "Deleting…" : "Delete permanently"}
        </Button>
        {isMe && <p className="text-xs text-muted">You can't delete yourself.</p>}
        <ErrorMessage error={remove.error} />
      </div>
      {saved && <p role="status" className="text-sm font-medium text-ok lg:col-span-3">{saved}</p>}
    </div>
  );
}

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, isPending } = useQuery({ queryKey: ["admin-users", q, role, status, page], queryFn: () => adminApi.users({ q, role, status, page }) });

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); setQ(search.trim()); setPage(1); }} className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <label htmlFor="user-search" className="sr-only">Search users</label>
          <input id="user-search" type="search" className={inputClass} placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="text-sm">
          <span className="sr-only">Role</span>
          <select className={inputClass} value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{r[0]!.toUpperCase() + r.slice(1)}s</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="sr-only">Status</span>
          <select className={inputClass} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
        <Button type="submit" variant="secondary">Search</Button>
      </form>

      <ErrorMessage error={error} />
      {isPending && <Loading label="Loading users" />}
      {data && data.data.length === 0 && <p className="py-12 text-muted">No users match.</p>}
      {data && data.data.length > 0 && (
        <>
          <p className="mt-4 text-sm text-muted">{data.pagination.total} {data.pagination.total === 1 ? "user" : "users"}</p>
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
            {data.data.map((u) => (
              <li key={u.id}>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
                  <div className="min-w-56 flex-1">
                    <p className="font-medium">{u.full_name}</p>
                    <p className="text-sm text-muted">{u.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {u.roles.map((r) => <span key={r} className="rounded bg-pen/10 px-2 py-0.5 text-xs font-medium capitalize text-pen">{r}</span>)}
                    {!u.is_active && <span className="rounded bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">Suspended</span>}
                  </div>
                  <p className="w-44 text-xs text-muted">Joined {formatDate(u.created_at)}<br />{u.enrollment_count} enrolled · {u.course_count} taught</p>
                  <Button variant="secondary" aria-expanded={open === u.id} onClick={() => setOpen(open === u.id ? null : u.id)}>
                    {open === u.id ? "Close" : "Manage"}<span className="sr-only"> {u.full_name}</span>
                  </Button>
                </div>
                {open === u.id && <UserPanel user={u} onClose={() => setOpen(null)} />}
              </li>
            ))}
          </ul>
        </>
      )}
      {data && <Pager pagination={data.pagination} onPage={setPage} />}
    </div>
  );
}
