import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "../common/Button";
import { ErrorMessage } from "../common/Feedback";
import { SelectField, TextArea, TextField } from "../common/Field";
import { CATEGORIES, DIFFICULTIES } from "../../constants";
import { coursesApi } from "../../services/lms";
import type { Difficulty } from "../../services/types";

export function NewCourseForm({ onCreated }: { onCreated: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [price, setPrice] = useState("0");

  const create = useMutation({
    mutationFn: () =>
      coursesApi.create({
        title,
        // Empty optional fields are left out so the API doesn't see empty strings.
        description: description || undefined,
        category: category || undefined,
        difficulty: (difficulty || undefined) as Difficulty | undefined,
        price: Number(price) || 0,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructor-courses"] });
      onCreated();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-md border border-line bg-white p-5">
      <h2 className="text-lg font-semibold">New course</h2>
      <TextField label="Title" required minLength={3} value={title} onChange={(e) => setTitle(e.target.value)} />
      <TextArea label="Description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} hint="What will students be able to do after this course?" />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Choose one</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </SelectField>
        <SelectField label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          <option value="">Choose one</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d[0]!.toUpperCase() + d.slice(1)}
            </option>
          ))}
        </SelectField>
        <TextField label="Price (₹)" type="number" min={0} step={1} value={price} onChange={(e) => setPrice(e.target.value)} hint="0 makes it free." />
      </div>
      <ErrorMessage error={create.error} />
      <div className="flex gap-3">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Saving…" : "Submit for approval"}
        </Button>
      </div>
    </form>
  );
}
