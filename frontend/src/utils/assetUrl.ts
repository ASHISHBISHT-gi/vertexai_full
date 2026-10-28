/**
 * Uploaded images come back as a path like "/api/v1/courses/<id>/thumbnail". That works as-is in development
 * (the Vite proxy forwards it). If the API lives on another domain in production, add that domain in front.
 */
export function assetUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith("/")) return url; // an external image link: use it directly
  const base = import.meta.env.VITE_API_URL as string | undefined;
  return base && /^https?:\/\//.test(base) ? new URL(base).origin + url : url;
}
