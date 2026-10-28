/**
 * Reads a video file's length in the browser, so the instructor doesn't have to type it
 * (and the server doesn't need ffmpeg). Resolves undefined if it can't be read in time.
 */
export function readVideoDuration(file: File, timeoutMs = 3000): Promise<number | undefined> {
  return new Promise((resolve) => {
    let url: string | undefined;
    const video = document.createElement("video");
    const finish = (value?: number) => {
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? Math.round(video.duration) : undefined);
    video.onerror = () => finish(undefined);
    try {
      url = URL.createObjectURL(file);
      video.src = url;
    } catch {
      finish(undefined);
    }
  });
}
