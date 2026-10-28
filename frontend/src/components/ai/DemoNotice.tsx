import { useQuery } from "@tanstack/react-query";
import { aiApi } from "../../services/lms";

/** Shown whenever the AI service runs without real API keys, so nobody mistakes demo output for a real AI. */
export function DemoNotice() {
  const { data } = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.status, staleTime: Infinity, retry: false });
  if (!data?.demo) return null;
  return (
    <p role="note" className="mb-4 rounded-md border border-highlight bg-highlight/30 px-3 py-2 text-sm">
      <span className="font-medium">Demo mode.</span> The AI service is running without API keys, so answers are assembled from the lecture text by simple rules, not written by an AI model.
    </p>
  );
}
