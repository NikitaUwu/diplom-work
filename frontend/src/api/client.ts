const BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

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

export async function uploadChart(file: File): Promise<ChartCreateResponse> {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch(`${BASE_URL}/charts/upload`, {
    method: "POST",
    body: fd,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }

  return res.json();
}

export async function getChart(id: number): Promise<ChartCreateResponse> {
  const res = await fetch(`${BASE_URL}/charts/${id}`, { method: "GET" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }

  return res.json();
}

export function artifactUrl(chartId: number, key: string): string {
  return `${BASE_URL}/charts/${chartId}/artifact/${encodeURIComponent(key)}`;
}
