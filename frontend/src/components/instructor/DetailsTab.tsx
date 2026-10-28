import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { CATEGORIES, DIFFICULTIES } from "../../constants";
import { coursesApi } from "../../services/lms";
import type { CourseDetail, Difficulty } from "../../services/types";
import { assetUrl } from "../../utils/assetUrl";
import { Button } from "../common/Button";
import { ErrorMessage } from "../common/Feedback";
import { SelectField, TextArea, TextField } from "../common/Field";

export function DetailsTab({ course }: { course: CourseDetail }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description ?? "");
  const [category, setCategory] = useState(course.category ?? "");
  const [difficulty, setDifficulty] = useState<string>(course.difficulty ?? "");
  const [price, setPrice] = useState(String(course.price));
  const [saved, setSaved] = useState("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["course", course.id] });
    queryClient.invalidateQueries({ queryKey: ["instructor-courses"] });
  };

  const save = useMutation({
    mutationFn: () =>
      coursesApi.update(course.id, {
        title,
        description,
        ...(category ? { category } : {}),
        ...(difficulty ? { difficulty: difficulty as Difficulty } : {}),
        price: Number(price) || 0,
      }),
    onMutate: () => setSaved(""),
    onSuccess: () => { setSaved("Changes saved."); refresh(); },
  });
  const upload = useMutation({
    mutationFn: (file: File) => coursesApi.uploadThumbnail(course.id, file),
    onSuccess: refresh,
  });

  const categories = category && !CATEGORIES.includes(category) ? [category, ...CATEGORIES] : CATEGORIES;
  const src = assetUrl(course.thumbnail_url);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <form onSubmit={submit} className="space-y-4 rounded-md border border-line bg-white p-5">
        <h3 className="text-lg font-semibold">Course details</h3>
        <TextField label="Title" required minLength={3} value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextArea label="Description" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} hint="What will students be able to do after this course?" />
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Not set</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </SelectField>
          <SelectField label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="">Not set</option>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{d[0]!.toUpperCase() + d.slice(1)}</option>)}
          </SelectField>
          <TextField label="Price (₹)" type="number" min={0} step={1} value={price} onChange={(e) => setPrice(e.target.value)} hint="0 makes it free." />
        </div>
        <ErrorMessage error={save.error} />
        {saved && <p role="status" className="text-sm font-medium text-ok">{saved}</p>}
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</Button>
        {course.status === "approved" && <p className="text-xs text-muted">This course is published, so changes are visible to students straight away.</p>}
      </form>

      <section className="h-fit space-y-3 rounded-md border border-line bg-white p-5" aria-label="Thumbnail">
        <h3 className="text-lg font-semibold">Thumbnail</h3>
        {src ? (
          <img src={src} alt={`Thumbnail of ${course.title}`} className="aspect-video w-full rounded-md border border-line object-cover" />
        ) : (
          <div className="grid aspect-video w-full place-items-center rounded-md border border-dashed border-line text-sm text-muted">No thumbnail yet</div>
        )}
        <div>
          <input
            id="thumbnail-file"
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            className="peer sr-only"
            disabled={upload.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) upload.mutate(file);
            }}
          />
          <label htmlFor="thumbnail-file" className="inline-flex cursor-pointer items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:border-pen peer-focus-visible:outline-2 peer-focus-visible:outline-pen">
            {upload.isPending ? "Uploading…" : src ? "Replace image" : "Choose an image"}
          </label>
        </div>
        <p className="text-xs text-muted">PNG, JPEG or WebP, up to 2 MB. A 16:9 picture looks best.</p>
        <ErrorMessage error={upload.error} />
      </section>
    </div>
  );
}
