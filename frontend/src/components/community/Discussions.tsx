import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useT } from "../../i18n";
import { communityApi } from "../../services/lms";
import { formatDateTime } from "../../utils/format";
import { Button } from "../common/Button";
import { ErrorMessage, Loading } from "../common/Feedback";
import { TextArea, TextField, inputClass } from "../common/Field";
import { Pager } from "../common/Pager";
import { ThreadView } from "./ThreadView";

export function Discussions({ courseId, threadId, onOpen }: { courseId: string; threadId: string | null; onOpen: (id: string | null) => void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const { data, error, isPending } = useQuery({ queryKey: ["threads", courseId, q, page], queryFn: () => communityApi.threads(courseId, { q: q || undefined, page }), enabled: !threadId });

  const create = useMutation({
    mutationFn: () => communityApi.createThread(courseId, { title, content }),
    onSuccess: (res) => {
      setTitle("");
      setContent("");
      setComposing(false);
      queryClient.invalidateQueries({ queryKey: ["threads", courseId] });
      onOpen(res.id);
    },
  });

  if (threadId) return <ThreadView courseId={courseId} threadId={threadId} onBack={() => onOpen(null)} />;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-60 flex-1">
          <label htmlFor="thread-search" className="sr-only">
            {t("community.search")}
          </label>
          <input id="thread-search" type="search" className={inputClass} placeholder={t("community.search")} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        {!composing && <Button onClick={() => setComposing(true)}>{t("community.newDiscussion")}</Button>}
      </div>

      {composing && (
        <div className="mt-5 space-y-4 rounded-md border border-line bg-white p-5">
          <h3 className="text-lg font-semibold">{t("community.newDiscussion")}</h3>
          <TextField label={t("community.titleLabel")} hint={t("community.titleHint")} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          <TextArea label={t("community.detailsLabel")} rows={5} maxLength={5000} value={content} onChange={(e) => setContent(e.target.value)} />
          <ErrorMessage error={create.error} />
          <div className="flex gap-3">
            <Button disabled={create.isPending || title.trim().length < 3 || !content.trim()} onClick={() => create.mutate()}>
              {create.isPending ? t("community.posting") : t("community.post")}
            </Button>
            <Button variant="secondary" onClick={() => setComposing(false)}>
              {t("community.cancel")}
            </Button>
          </div>
        </div>
      )}

      <ErrorMessage error={error} />
      {isPending && <Loading label={t("community.loading")} />}
      {data && data.data.length === 0 && <p className="py-10 text-muted">{t("community.noThreads")}</p>}
      {data && data.data.length > 0 && (
        <ul className="mt-5 divide-y divide-line rounded-md border border-line bg-white">
          {data.data.map((th) => (
            <li key={th.id}>
              <button onClick={() => onOpen(th.id)} className="flex w-full flex-wrap items-start justify-between gap-3 p-4 text-left hover:bg-paper">
                <span className="min-w-60 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{th.title}</span>
                    {th.is_pinned && <span className="rounded bg-highlight/40 px-2 py-0.5 text-xs font-medium">{t("community.pinned")}</span>}
                    {th.has_flagged && <span className="rounded bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">{t("community.flagged")}</span>}
                  </span>
                  <span className="mt-1 block text-sm text-muted">
                    {th.author_name}
                    {th.by_instructor && ` · ${t("community.instructor")}`} · {formatDateTime(th.last_activity_at)}
                  </span>
                </span>
                <span className="text-sm text-muted">{t("community.replies", { n: th.reply_count })}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && <Pager pagination={data.pagination} onPage={setPage} />}
    </div>
  );
}
