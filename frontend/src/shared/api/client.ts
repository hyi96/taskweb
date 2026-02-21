const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").trim();

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  profileId?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

function getCookie(name: string) {
  if (typeof document === "undefined") {
    return "";
  }
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(";").shift() ?? "";
  }
  return "";
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>, profileId?: string) {
  const base = API_BASE_URL || (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:5173");
  const url = new URL(path, base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  if (profileId) {
    url.searchParams.set("profile_id", profileId);
  }
  return url.toString();
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const csrfToken = getCookie("csrftoken");
  const response = await fetch(buildUrl(path, options.query, options.profileId), {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET" && csrfToken ? { "X-CSRFToken": csrfToken } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new ApiError(`Request failed with ${response.status}`, response.status, payload);
  }
  return payload as T;
}
