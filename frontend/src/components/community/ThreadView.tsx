import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useT } from "../../i18n";
import { communityApi } from "../../services/lms";
import type { ForumPost } from "../../services/types";
import { formatDateTime } from "../../utils/format";
import { Button } from "../common/Button";
import { ErrorMessage, Loading } from "../common/Feedback";
import { inputClass } from "../common/Field";

const MAX_INDENT = 4; // deeper replies stay at this level so long chains don't squeeze into a thin column

export function ThreadView({ courseId, threadId, onBack }: { courseId: string; threadId: string; onBack: () => void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const { data, error, isPending } = useQuery({ queryKey: ["thread", threadId], queryFn: () => communityApi.thread(threadId) });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["thread", threadId] });
    queryClient.invalidateQueries({ queryKey: ["threads", courseId] });
  };
  const pin = useMutation({ mutationFn: (pinned: boolean) => communityApi.pin(threadId, pinned), onSuccess: refresh });
  const removeThread = useMutation({
    mutationFn: () => communityApi.deleteThread(threadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads", courseId] });
      onBack();
    },
  });
  const removePost = useMutation({
    mutationFn: (id: string) => communityApi.deletePost(id),
    onSuccess: (res) => {
      if (res.thread_deleted) {
        queryClient.invalidateQueries({ queryKey: ["threads", courseId] });
        onBack();
      } else refresh();
    },
  });
  const report = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => communityApi.report(id, reason),
    onSuccess: () => {
      setNotice(t("community.reportThanks"));
      refresh();
    },
  });
  const dismiss = useMutation({ mutationFn: (id: string) => communityApi.dismissReports(id), onSuccess: refresh });

  // Group replies under the post they answer. Posts whose parent was deleted are shown at the top level.
  const { roots, children } = useMemo(() => {
    const kids = new Map<string, ForumPost[]>();
    const top: ForumPost[] = [];
    const ids = new Set(data?.posts.map((p) => p.id));
    for (const p of data?.posts ?? []) {
      if (p.parent_id && ids.has(p.parent_id)) kids.set(p.parent_id, [...(kids.get(p.parent_id) ?? []), p]);
      else top.push(p);
    }
    return { roots: top, children: kids };
  }, [data]);

  if (isPending) return <Loading label={t("community.loading")} />;
  if (error) return (
    <div>
      <button className="text-sm text-pen hover:underline" onClick={onBack}>{t("community.back")}</button>
      <ErrorMessage error={error} />
    </div>
  );

  const { thread, can_moderate } = data;
  const opening = roots[0];

  return (
    <div>
      <button className="text-sm text-pen hover:underline" onClick={onBack}>← {t("community.back")}</button>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <h2 className="text-2xl font-semibold">{thread.title}</h2>
        <div className="flex gap-3">
          {can_moderate && <Button variant="secondary" onClick={() => pin.mutate(!thread.is_pinned)} disabled={pin.isPending}>{thread.is_pinned ? t("community.unpin") : t("community.pin")}</Button>}
        </div>
      </div>
      {notice && <p role="status" className="mt-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">{notice}</p>}
      <ErrorMessage error={removePost.error ?? removeThread.error ?? report.error ?? dismiss.error ?? pin.error} />

      <ul className="mt-5 space-y-3">
        {roots.map((p) => (
          <PostNode
            key={p.id}
            post={p}
            depth={0}
            ctx={{
              threadId, openingId: opening?.id, canModerate: can_moderate, childrenOf: (id) => children.get(id) ?? [], refresh,
              onDelete: (id) => removePost.mutate(id), onReport: (id, reason) => report.mutate({ id, reason }), onDismiss: (id) => dismiss.mutate(id),
            }}
          />
        ))}
      </ul>

      <div className="mt-6">
        <ReplyForm threadId={threadId} onDone={refresh} />
      </div>
    </div>
  );
}

interface NodeContext {
  threadId: string;
  openingId: string | undefined;
  canModerate: boolean;
  childrenOf: (id: string) => ForumPost[];
  refresh: () => void;
  onDelete: (id: string) => void;
  onReport: (id: string, reason?: string) => void;
  onDismiss: (id: string) => void;
}

/** One post and (recursively) the replies under it. A top-level component, so its "reply box is open" state survives re-renders. */
function PostNode({ post, depth, ctx }: { post: ForumPost; depth: number; ctx: NodeContext }) {
  const { t } = useT();
  const [replying, setReplying] = useState(false);
  const kids = ctx.childrenOf(post.id);
  const isOpening = post.id === ctx.openingId;
  return (
    <li>
      <article className={`rounded-md border bg-white p-4 ${post.is_flagged ? "border-danger/50" : "border-line"}`} aria-label={`${post.author_name}, ${formatDateTime(post.created_at)}`}>
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <strong>{post.author_name}</strong>
          {post.by_instructor && <span className="rounded bg-pen/10 px-2 py-0.5 text-xs font-medium text-pen">{t("community.instructor")}</span>}
          <time dateTime={post.created_at} className="text-muted">{formatDateTime(post.created_at)}</time>
          {post.is_flagged && <span className="rounded bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">{t("community.flagged")} ({post.report_count})</span>}
        </header>
        {/* whitespace-pre-wrap keeps the author's line breaks. React escapes the text, so posts can't inject HTML. */}
        <p className="mt-2 whitespace-pre-wrap break-words">{post.content}</p>
        <footer className="mt-3 flex flex-wrap gap-4 text-sm">
          <button className="text-pen hover:underline" onClick={() => setReplying((v) => !v)} aria-expanded={replying}>{t("community.reply")}</button>
          {!post.mine && (post.reported_by_me ? (
            <span className="text-muted">{t("community.reported")}</span>
          ) : (
            <button
              className="text-muted hover:text-ink hover:underline"
              onClick={() => {
                const reason = window.prompt(t("community.reportReason"));
                if (reason !== null) ctx.onReport(post.id, reason.trim() || undefined);
              }}
            >
              {t("community.report")}
            </button>
          ))}
          {(post.mine || ctx.canModerate) && (
            <button className="text-danger hover:underline" onClick={() => window.confirm(isOpening ? t("community.confirmDeleteThread") : t("community.confirmDelete")) && ctx.onDelete(post.id)}>{t("community.delete")}</button>
          )}
          {ctx.canModerate && post.is_flagged && <button className="text-ok hover:underline" onClick={() => ctx.onDismiss(post.id)}>{t("community.keep")}</button>}
        </footer>
        {replying && <ReplyForm threadId={ctx.threadId} parentId={post.id} onDone={() => { setReplying(false); ctx.refresh(); }} />}
      </article>
      {kids.length > 0 && (
        <ul className={`mt-3 space-y-3 ${depth < MAX_INDENT ? "ml-4 border-l-2 border-line pl-4" : ""}`}>
          {kids.map((k) => <PostNode key={k.id} post={k} depth={depth + 1} ctx={ctx} />)}
        </ul>
      )}
    </li>
  );
}

function ReplyForm({ threadId, parentId, onDone }: { threadId: string; parentId?: string; onDone: () => void }) {
  const { t } = useT();
  const [content, setContent] = useState("");
  const send = useMutation({
    mutationFn: () => communityApi.reply(threadId, { content, parent_id: parentId }),
    onSuccess: () => {
      setContent("");
      onDone();
    },
  });
  return (
    <div className="mt-3 space-y-2">
      <label className="sr-only" htmlFor={`reply-${parentId ?? "thread"}`}>{t("community.replyPlaceholder")}</label>
      <textarea id={`reply-${parentId ?? "thread"}`} className={inputClass} rows={3} maxLength={5000} placeholder={t("community.replyPlaceholder")} value={content} onChange={(e) => setContent(e.target.value)} />
      <ErrorMessage error={send.error} />
      <Button disabled={send.isPending || !content.trim()} onClick={() => send.mutate()}>{send.isPending ? t("community.posting") : t("community.post")}</Button>
    </div>
  );
}
