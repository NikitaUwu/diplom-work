const rawBaseUrl = import.meta.env.VITE_API_BASE_URL;

if (typeof rawBaseUrl !== 'string' || rawBaseUrl.trim() === '') {
  throw new Error('VITE_API_BASE_URL is not set');
}

const BASE_URL = rawBaseUrl.replace(/\/+$/, '');

function apiUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

function withQuery(path: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    query.set(key, String(value));
  });

  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export type ChartStatus = 'uploaded' | 'processing' | 'done' | 'error';

export interface ChartCreateResponse {
  id: number;
  status: ChartStatus;
  originalFilename: string;
  mimeType: string;
  createdAt: string;
  processedAt?: string | null;
  nPanels?: number | null;
  nSeries?: number | null;
  resultJson?: unknown | null;
  errorMessage?: string | null;
}

export interface Token {
  accessToken: string;
  tokenType: string;
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
  isActive: boolean;
  role: string;
  createdAt: string;
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as unknown;

    if (typeof data === 'string') {
      return `${res.status} ${res.statusText} - ${data}`;
    }

    if (data && typeof data === 'object') {
      const maybeDetail = (data as { detail?: unknown }).detail;

      if (typeof maybeDetail === 'string') {
        return `${res.status} ${res.statusText} - ${maybeDetail}`;
      }

      if (Array.isArray(maybeDetail)) {
        const msg = maybeDetail
          .map((item) => {
            if (typeof item === 'string') {
              return item;
            }

            if (item && typeof item === 'object' && 'msg' in item) {
              const value = (item as { msg?: unknown }).msg;
              return typeof value === 'string' ? value : JSON.stringify(item);
            }

            return JSON.stringify(item);
          })
          .join('; ');

        return `${res.status} ${res.statusText}${msg ? ` - ${msg}` : ''}`;
      }

      return `${res.status} ${res.statusText} - ${JSON.stringify(data)}`;
    }
  } catch {
    // fallback below
  }

  const text = await res.text().catch(() => '');
  return `${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`;
}

async function apiFetch(path: string, init: RequestInit, action: string): Promise<Response> {
  const res = await fetch(apiUrl(path), {
    credentials: 'include',
    ...init,
  });

  if (!res.ok) {
    throw new Error(`${action} failed: ${await readError(res)}`);
  }

  return res;
}

async function apiFetchJson<T>(path: string, init: RequestInit, action: string): Promise<T> {
  const res = await apiFetch(path, init, action);
  return (await res.json()) as T;
}

export async function register(data: RegisterRequest): Promise<UserRead> {
  return apiFetchJson<UserRead>(
    '/auth/register',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
    'Register',
  );
}

export async function login(data: LoginRequest): Promise<Token> {
  return apiFetchJson<Token>(
    '/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
    'Login',
  );
}

export async function me(): Promise<UserRead> {
  return apiFetchJson<UserRead>('/auth/me', { method: 'GET' }, 'Me');
}

export async function logout(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' }, 'Logout');
}

export async function clearToken(): Promise<void> {
  await logout();
}

export async function uploadChart(file: File): Promise<ChartCreateResponse> {
  const formData = new FormData();
  formData.append('file', file);

  return apiFetchJson<ChartCreateResponse>(
    '/charts/upload',
    {
      method: 'POST',
      body: formData,
    },
    'Upload',
  );
}

export async function getChart(id: number): Promise<ChartCreateResponse> {
  return apiFetchJson<ChartCreateResponse>(`/charts/${id}`, { method: 'GET' }, 'Fetch chart');
}

export async function listCharts(): Promise<ChartCreateResponse[]> {
  return apiFetchJson<ChartCreateResponse[]>('/charts', { method: 'GET' }, 'List charts');
}

export async function deleteChart(id: number): Promise<void> {
  await apiFetch(`/charts/${id}`, { method: 'DELETE' }, 'Delete chart');
}

export function chartFileUrl(chartId: number, fileKey: string): string {
  return apiUrl(`/charts/${chartId}/files/${encodeURIComponent(fileKey)}`);
}

async function patchChartResult(
  chartId: number,
  resultJson: unknown,
  persist: boolean,
): Promise<ChartCreateResponse> {
  const path = withQuery(`/charts/${chartId}`, { persist });
  return apiFetchJson<ChartCreateResponse>(
    path,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resultJson }),
    },
    persist ? 'Save chart' : 'Preview chart',
  );
}

export async function previewChartResult(
  chartId: number,
  resultJson: unknown,
): Promise<ChartCreateResponse> {
  return patchChartResult(chartId, resultJson, false);
}

export async function saveChartResult(
  chartId: number,
  resultJson: unknown,
): Promise<ChartCreateResponse> {
  return patchChartResult(chartId, resultJson, true);
}

export async function previewChartRandomSplinePoints(
  chartId: number,
  totalPoints: number,
  resultJson?: unknown,
): Promise<ChartCreateResponse> {
  return apiFetchJson<ChartCreateResponse>(
    `/charts/${chartId}/cubic-preview-random`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalPoints, resultJson }),
    },
    'Предпросмотр случайного кубического сплайна по точкам',
  );
}
