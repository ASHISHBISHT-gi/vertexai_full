import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useT } from "../../i18n";
import { communityApi } from "../../services/lms";
import { formatDateTime } from "../../utils/format";
import { Button } from "../common/Button";
import { ErrorMessage, Loading } from "../common/Feedback";
import { TextArea, TextField } from "../common/Field";
import { Pager } from "../common/Pager";

export function Announcements({ courseId }: { courseId: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const { data, error, isPending } = useQuery({ queryKey: ["announcements", courseId, page], queryFn: () => communityApi.announcements(courseId, page) });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["announcements", courseId] });
  const post = useMutation({
    mutationFn: () => communityApi.postAnnouncement(courseId, { title, content }),
    onSuccess: () => {
      setTitle("");
      setContent("");
      setPage(1);
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: communityApi.deleteAnnouncement, onSuccess: refresh });

  if (isPending) return <Loading label={t("community.loading")} />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <div className="space-y-8">
      {data.can_post && (
        <section className="space-y-4 rounded-md border border-line bg-white p-5" aria-labelledby="new-announcement">
          <div>
            <h3 id="new-announcement" className="text-lg font-semibold">{t("community.newAnnouncement")}</h3>
            <p className="text-sm text-muted">{t("community.announceHint")}</p>
          </div>
          <TextField label={t("community.titleLabel")} value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
          <TextArea label={t("community.detailsLabel")} rows={4} maxLength={5000} value={content} onChange={(e) => setContent(e.target.value)} />
          <ErrorMessage error={post.error} />
          <Button disabled={post.isPending || title.trim().length < 3 || !content.trim()} onClick={() => post.mutate()}>
            {post.isPending ? t("community.posting") : t("community.post")}
          </Button>
        </section>
      )}

      {data.data.length === 0 ? (
        <p className="py-6 text-muted">{t("community.noAnnouncements")}</p>
      ) : (
        <ul className="space-y-4">
          {data.data.map((a) => (
            <li key={a.id} className="rounded-md border border-line bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="text-lg font-semibold">{a.title}</h3>
                {data.can_post && (
                  <button className="text-sm text-danger hover:underline" onClick={() => window.confirm(t("community.confirmDelete")) && remove.mutate(a.id)}>
                    {t("community.delete")}
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                {t("community.postedBy", { name: a.posted_by_name })} · <time dateTime={a.created_at}>{formatDateTime(a.created_at)}</time>
              </p>
              <p className="mt-3 whitespace-pre-wrap break-words">{a.content}</p>
            </li>
          ))}
        </ul>
      )}
      <ErrorMessage error={remove.error} />
      <Pager pagination={data.pagination} onPage={setPage} />
    </div>
  );
}
