// Thin client for the HOS REST API. The session token is kept in localStorage purely as a
// per-browser convenience; the server is the authority on every session.

const TOKEN_KEY = "hos.token";

export class ApiError extends Error {
  status: number;
  errors: string[];
  /** Server-side exception name, e.g. "LedgerIntegrityError". */
  kind: string | null;
  /** The server's request ID: quote it to an administrator to find the request in the log. */
  requestId: string | null;
  constructor(
    status: number,
    message: string,
    errors: string[] = [],
    kind: string | null = null,
    requestId: string | null = null,
  ) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.kind = kind;
    this.requestId = requestId;
  }
}

/** Fired when the server no longer accepts the session token; the app returns to sign-in. */
export const UNAUTHORIZED_EVENT = "hos:unauthorized";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the session lasts for this page only */
  }
}

async function request<T>(method: string, path: string, body?: unknown, raw?: BodyInit): Promise<T> {
  return (await send<T>(method, path, body, raw)).data;
}

/** Every item of a paged list (docs/15 P2.5): pages of at most 1000, totalled by X-Total-Count. */
async function getAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (;;) {
    const { data, headers } = await send<T[]>("GET", `${path}${sep}limit=1000&offset=${out.length}`);
    out.push(...data);
    const total = Number(headers.get("X-Total-Count") ?? out.length);
    if (data.length === 0 || out.length >= total) return out;
  }
}

async function send<T>(
  method: string,
  path: string,
  body?: unknown,
  raw?: BodyInit,
): Promise<{ data: T; headers: Headers }> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined = raw;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  const type = res.headers.get("content-type") ?? "";
  const data: unknown = type.includes("application/json") ? await res.json() : await res.text();
  if (method !== "GET") window.dispatchEvent(new Event("hos:changed"));
  if (!res.ok) {
    const d = (typeof data === "object" && data !== null ? data : {}) as {
      detail?: unknown;
      errors?: string[];
      error?: string;
      request_id?: string;
    };
    const msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail ?? data);
    if (res.status === 401 && path !== "/auth/login") {
      setToken(null);
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(
      res.status,
      msg,
      d.errors ?? [],
      d.error ?? null,
      d.request_id ?? res.headers.get("X-Request-ID"),
    );
  }
  return { data: data as T, headers: res.headers };
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  getAll: <T>(path: string) => getAll<T>(path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  upload: <T>(path: string, file: Blob) => request<T>("POST", path, undefined, file),
  async download(path: string, filename: string): Promise<void> {
    const token = getToken();
    const res = await fetch(`/api${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const text = await res.text();
      let detail = text;
      try {
        detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
      } catch {
        /* not JSON */
      }
      throw new ApiError(res.status, detail, [], null, res.headers.get("X-Request-ID"));
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
