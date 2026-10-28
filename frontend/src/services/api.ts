/**
 * The one place that talks to the backend.
 *  - adds the Authorization header
 *  - refreshes the access token before it expires (and retries once if the server still says 401)
 *  - turns error responses into a typed ApiError the UI can show
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

const ACCESS_KEY = "lms.access_token";
const REFRESH_KEY = "lms.refresh_token";

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export class ApiError extends Error {
  status: number;
  code: string;
  field?: string;
  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

// The auth provider registers a callback here so it can log the user out when a refresh fails.
let onSessionExpired: (() => void) | null = null;
export const setOnSessionExpired = (fn: (() => void) | null) => {
  onSessionExpired = fn;
};

/** Reads the `exp` claim from a JWT (no verification: only the server can verify). */
function isExpiringSoon(jwt: string): boolean {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp !== "number" || payload.exp * 1000 < Date.now() + 10_000;
  } catch {
    return true;
  }
}

// If three requests notice an expired token at once, they should share ONE refresh call.
// Refresh tokens are single-use, so a second parallel refresh would fail and log the user out.
let refreshInFlight: Promise<boolean> | null = null;

function refreshTokens(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const refresh = tokens.refresh;
    if (!refresh) return false;
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) {
        tokens.clear();
        onSessionExpired?.();
        return false;
      }
      const data = await res.json();
      tokens.set(data.access_token, data.refresh_token);
      return true;
    } catch {
      return false; // network hiccup: keep the tokens, try again on the next request
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// Never try to refresh while doing these, or a wrong password would trigger a refresh loop.
const NO_REFRESH = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"];

export const API_BASE = BASE;

// The AI tutor is a separate service. In development Vite's proxy sends /api/v1/ai/* to it, so this stays equal to BASE.
// Set VITE_AI_URL if the AI service lives at a different address.
const AI_BASE = (import.meta.env.VITE_AI_URL as string | undefined) ?? BASE;
const urlFor = (path: string) => `${path.startsWith("/ai/") ? AI_BASE : BASE}${path}`;

async function request(path: string, options: { method?: string; body?: unknown } = {}): Promise<Response> {
  const { method = "GET", body } = options;
  const canRefresh = !NO_REFRESH.includes(path);
  const isForm = body instanceof FormData; // file uploads: the browser sets the multipart Content-Type itself

  if (canRefresh && tokens.access && tokens.refresh && isExpiringSoon(tokens.access)) {
    await refreshTokens();
  }

  const send = () =>
    fetch(urlFor(path), {
      method,
      headers: {
        ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
        ...(tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });

  let res = await send();
  if (res.status === 401 && canRefresh && tokens.refresh && (await refreshTokens())) {
    res = await send();
  }
  return res;
}

async function toApiError(res: Response, path = ""): Promise<ApiError> {
  const data = await res.json().catch(() => null);
  if (!data && res.status >= 502) {
    // A proxy answered instead of the service: the service itself isn't running.
    return new ApiError(res.status, "SERVICE_UNAVAILABLE", path.startsWith("/ai/") ? "The AI service isn't reachable. Is it running?" : "The server isn't reachable. Is it running?");
  }
  return new ApiError(res.status, data?.error?.code ?? "ERROR", data?.error?.message ?? "Something went wrong", data?.error?.field);
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await request(path, options);
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await toApiError(res, path);
  return (await res.json()) as T;
}

/**
 * Downloads a protected file. A plain <a href> can't send our Authorization header,
 * so we fetch it ourselves and hand the browser the bytes.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await request(path);
  if (!res.ok) throw await toApiError(res, path);
  const blob = await res.blob();
  const header = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "")?.[1];
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = header ? decodeURIComponent(header) : fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Builds "?a=1&b=2", skipping empty values. */
export function toQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}
