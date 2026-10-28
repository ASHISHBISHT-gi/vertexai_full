import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { resourcesApi } from "../../services/lms";
import { formatBytes } from "../../utils/format";
import { ErrorMessage } from "../common/Feedback";

const ACCEPT = ".pdf,.pptx,.ppt,.docx,.doc,.xlsx,.zip,.txt,.md,.png,.jpg,.jpeg";

/** Downloads need the login token, so a plain link won't do: we fetch the file ourselves. */
function DownloadButton({ id, name }: { id: string; name: string }) {
  const [error, setError] = useState<unknown>(null);
  return (
    <>
      <button className="text-pen hover:underline" onClick={() => resourcesApi.download(id, name).catch(setError)}>
        {name}
      </button>
      {error != null && <ErrorMessage error={error} />}
    </>
  );
}

/** What students see under a lecture: nothing at all if the instructor attached no files. */
export function MaterialsList({ lectureId }: { lectureId: string }) {
  const { data } = useQuery({ queryKey: ["resources", lectureId], queryFn: () => resourcesApi.list(lectureId), retry: false });
  if (!data || data.length === 0) return null;
  return (
    <section className="mt-6 rounded-md border border-line bg-white p-5" aria-label="Lecture materials">
      <h3 className="font-semibold">Lecture materials</h3>
      <ul className="mt-2 space-y-1.5 text-sm">
        {data.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-3">
            <DownloadButton id={r.id} name={r.original_name} />
            <span className="text-xs text-muted">{formatBytes(r.file_size)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the instructor sees: the same list, plus upload and delete. */
export function MaterialsEditor({ lectureId }: { lectureId: string }) {
  const queryClient = useQueryClient();
  const { data, error } = useQuery({ queryKey: ["resources", lectureId], queryFn: () => resourcesApi.list(lectureId) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["resources", lectureId] });
  const upload = useMutation({ mutationFn: (file: File) => resourcesApi.upload(lectureId, file), onSuccess: refresh });
  const remove = useMutation({ mutationFn: resourcesApi.remove, onSuccess: refresh });

  return (
    <div className="space-y-3 border-t border-line bg-paper p-4">
      <p className="text-sm text-muted">Slides, PDFs, code samples: anything students should be able to download for this lecture (up to 25 MB each).</p>
      {data?.length === 0 && <p className="text-sm">No files attached yet.</p>}
      <ul className="space-y-1.5 text-sm">
        {data?.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-3">
            <span><DownloadButton id={r.id} name={r.original_name} /> <span className="text-xs text-muted">({formatBytes(r.file_size)})</span></span>
            <button className="text-muted hover:text-danger" onClick={() => remove.mutate(r.id)} aria-label={`Remove ${r.original_name}`}>Remove</button>
          </li>
        ))}
      </ul>
      <div>
        <input
          id={`res-${lectureId}`}
          type="file"
          accept={ACCEPT}
          className="peer sr-only"
          disabled={upload.isPending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload.mutate(file);
          }}
        />
        <label htmlFor={`res-${lectureId}`} className="inline-flex cursor-pointer items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:border-pen peer-focus-visible:outline-2 peer-focus-visible:outline-pen">
          {upload.isPending ? "Uploading…" : "Add a file"}
        </label>
      </div>
      <ErrorMessage error={error ?? upload.error ?? remove.error} />
    </div>
  );
}

