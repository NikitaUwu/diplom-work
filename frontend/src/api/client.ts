const rawBaseUrl = import.meta.env.VITE_API_BASE_URL;

if (typeof rawBaseUrl !== "string" || rawBaseUrl.trim() === "") {
  throw new Error("VITE_API_BASE_URL is not set");
}

const BASE_URL = rawBaseUrl.replace(/\/+$/, "");

function apiUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

export type ChartStatus = "uploaded" | "processing" | "done" | "error";

export interface ChartCreateResponse {
  id: number;
  status: ChartStatus;
  original_filename: string;
  mime_type: string;
  created_at: string;
  processed_at?: string | null;
  n_panels?: number | null;
  n_series?: number | null;
  result_json?: unknown | null;
  error_message?: string | null;
}

export interface Token {
  access_token: string;
  token_type: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface UserRead {
  id: number;
  email: string;
  is_active: boolean;
  created_at: string;
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as unknown;

    if (typeof data === "string") {
      return `${res.status} ${res.statusText} — ${data}`;
    }

    if (data && typeof data === "object") {
      const maybeDetail = (data as { detail?: unknown }).detail;

      if (typeof maybeDetail === "string") {
        return `${res.status} ${res.statusText} — ${maybeDetail}`;
      }

      if (Array.isArray(maybeDetail)) {
        const msg = maybeDetail
          .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object" && "msg" in item) {
              const v = (item as { msg?: unknown }).msg;
              return typeof v === "string" ? v : JSON.stringify(item);
            }
            return JSON.stringify(item);
          })
          .join("; ");
        return `${res.status} ${res.statusText}${msg ? ` — ${msg}` : ""}`;
      }

      return `${res.status} ${res.statusText} — ${JSON.stringify(data)}`;
    }
  } catch {
    // fallback below
  }

  const text = await res.text().catch(() => "");
  return `${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`;
}

// ---------- AUTH ----------

export async function register(data: RegisterRequest): Promise<UserRead> {
  const res = await fetch(apiUrl("/auth/register"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) throw new Error(`Register failed: ${await readError(res)}`);
  return res.json();
}

export async function login(data: LoginRequest): Promise<Token> {
  const res = await fetch(apiUrl("/auth/login"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) throw new Error(`Login failed: ${await readError(res)}`);
  return res.json();
}

export async function me(): Promise<UserRead> {
  const res = await fetch(apiUrl("/auth/me"), {
    method: "GET",
    credentials: "include",
  });

  if (!res.ok) throw new Error(`Me failed: ${await readError(res)}`);
  return res.json();
}

export async function logout(): Promise<void> {
  const res = await fetch(apiUrl("/auth/logout"), {
    method: "POST",
    credentials: "include",
  });

  if (!res.ok) throw new Error(`Logout failed: ${await readError(res)}`);
}

export async function clearToken(): Promise<void> {
  await logout();
}

// ---------- CHARTS ----------

export async function uploadChart(file: File): Promise<ChartCreateResponse> {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch(apiUrl("/charts/upload"), {
    method: "POST",
    credentials: "include",
    body: fd,
  });

  if (!res.ok) throw new Error(`Upload failed: ${await readError(res)}`);
  return res.json();
}

export async function getChart(id: number): Promise<ChartCreateResponse> {
  const res = await fetch(apiUrl(`/charts/${id}`), {
    method: "GET",
    credentials: "include",
  });

  if (!res.ok) throw new Error(`Fetch failed: ${await readError(res)}`);
  return res.json();
}

export function artifactUrl(chartId: number, key: string): string {
  return apiUrl(`/charts/${chartId}/artifact/${encodeURIComponent(key)}`);
}

export async function listCharts(): Promise<ChartCreateResponse[]> {
  const res = await fetch(apiUrl("/charts"), {
    method: "GET",
    credentials: "include",
  });

  if (!res.ok) throw new Error(`Fetch failed: ${await readError(res)}`);
  return res.json();
}

export function originalUrl(chartId: number): string {
  return apiUrl(`/charts/${chartId}/original`);
}

export function exportCsvUrl(chartId: number): string {
  return apiUrl(`/charts/${chartId}/export.csv`);
}

export function exportTxtUrl(chartId: number): string {
  return apiUrl(`/charts/${chartId}/export.txt`);
}

export function exportJsonUrl(chartId: number): string {
  return apiUrl(`/charts/${chartId}/export.json`);
}

export async function deleteChart(id: number): Promise<void> {
  const res = await fetch(apiUrl(`/charts/${id}`), {
    method: "DELETE",
    credentials: "include",
  });

  if (!res.ok) throw new Error(`Delete failed: ${await readError(res)}`);
}