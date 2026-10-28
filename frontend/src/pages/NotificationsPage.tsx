import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../components/common/Button";
import { ErrorMessage, Loading } from "../components/common/Feedback";
import { Pager } from "../components/common/Pager";
import { useT } from "../i18n";
import { notificationsApi } from "../services/lms";
import type { AppNotification } from "../services/types";
import { formatDateTime } from "../utils/format";

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [onlyUnread, setOnlyUnread] = useState(false);

  const { data, error, isPending } = useQuery({
    queryKey: ["notifications", page, onlyUnread],
    queryFn: () => notificationsApi.list({ page, unread: onlyUnread ? "true" : undefined }),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
  };
  const markRead = useMutation({ mutationFn: notificationsApi.markRead, onSuccess: refresh });
  const markAll = useMutation({ mutationFn: notificationsApi.markAllRead, onSuccess: refresh });

  const { t } = useT();
  const prefs = useQuery({ queryKey: ["notification-prefs"], queryFn: notificationsApi.preferences });
  const savePrefs = useMutation({ mutationFn: notificationsApi.setPreferences, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-prefs"] }) });

  const open = (n: AppNotification) => {
    if (!n.is_read) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">Notifications</h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyUnread}
              onChange={(e) => {
                setOnlyUnread(e.target.checked);
                setPage(1);
              }}
            />
            Unread only
          </label>
          <Button variant="secondary" disabled={markAll.isPending || !data?.unread} onClick={() => markAll.mutate()}>
            Mark all as read
          </Button>
        </div>
      </div>

      {prefs.data && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={prefs.data.email_notifications} disabled={savePrefs.isPending} onChange={(e) => savePrefs.mutate(e.target.checked)} />
            {t("notifications.emailToggle")}
          </label>
          {savePrefs.isSuccess && !savePrefs.isPending && <span role="status" className="text-xs text-muted">{t("notifications.emailSaved")}</span>}
        </div>
      )}
      <ErrorMessage error={error ?? markAll.error ?? savePrefs.error} />
      {isPending && <Loading label="Loading notifications" />}
      {data && data.data.length === 0 && (
        <p className="py-12 text-muted">{onlyUnread ? "Nothing unread." : "No notifications yet. Updates about your courses and account will appear here."}</p>
      )}
      {data && data.data.length > 0 && (
        <ul className="mt-6 divide-y divide-line rounded-md border border-line bg-white">
          {data.data.map((n) => (
            <li key={n.id} className={n.is_read ? "" : "bg-highlight/15"}>
              <button className="flex w-full items-start gap-3 p-4 text-left hover:bg-paper" onClick={() => open(n)}>
                <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? "bg-transparent" : "bg-pen"}`} />
                <span className="flex-1">
                  <span className="block font-medium">
                    {n.title}
                    {!n.is_read && <span className="sr-only"> (unread)</span>}
                  </span>
                  {n.body && <span className="mt-0.5 block text-sm text-muted">{n.body}</span>}
                  <span className="mt-1 block text-xs text-muted">{formatDateTime(n.created_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && <Pager pagination={data.pagination} onPage={setPage} />}
    </div>
  );
}
