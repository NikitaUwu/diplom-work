import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getChart, uploadChart, logout, type ChartCreateResponse, type ChartStatus } from "../api/client";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Alert from "../components/ui/Alert";

function statusLabel(s: ChartStatus) {
  switch (s) {
    case "uploaded":
      return "Файл принят";
    case "processing":
      return "Обработка";
    case "done":
      return "Готово";
    case "error":
      return "Ошибка";
    default:
      return s;
  }
}

function statusVariant(s: ChartStatus) {
  switch (s) {
    case "done":
      return "success";
    case "processing":
      return "info";
    case "error":
      return "danger";
    default:
      return "default";
  }
}

export default function UploadPage() {
  const navigate = useNavigate();

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [chart, setChart] = useState<ChartCreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);

  useMemo(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function stopPolling() {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  async function onLogout() {
    stopPolling();
    try {
      await logout();
    } catch {
    }
    navigate("/login", { replace: true });
  }

  function onResults() {
    stopPolling();
    navigate("/results");
  }

  async function startPolling(chartId: number) {
    stopPolling();
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const fresh = await getChart(chartId);
        setChart(fresh);

        if (fresh.status === "done" || fresh.status === "error") {
          stopPolling();
          navigate(`/charts/${chartId}`);
        }
      } catch (e: any) {
        stopPolling();
        setError(e?.message ?? "Ошибка при получении статуса обработки");
      }
    }, 1500);
  }

  useEffect(() => {
    return () => stopPolling();
  }, []);

  async function onUpload() {
    if (!file) return;

    stopPolling();
    setError(null);
    setChart(null);
    setIsUploading(true);

    try {
      const r = await uploadChart(file);
      setChart(r);
      await startPolling(r.id);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="min-h-screen">
      {/* фон */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-slate-200/60 blur-3xl dark:bg-slate-800/40" />
        <div className="absolute -bottom-40 right-10 h-80 w-80 rounded-full bg-slate-200/50 blur-3xl dark:bg-slate-800/30" />
      </div>

      <div className="relative mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-6">
            <div className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
              CHART EXTRACTION
            </div>

            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Chart Extraction
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Загрузите изображение. После завершения обработки вы перейдёте на страницу результатов.
            </p>
          </div>

          <div className="lg:col-span-6">
            <div className="flex flex-wrap items-center gap-3 lg:justify-end">
              <Button variant="secondary" onClick={onResults}>
                Мои результаты
              </Button>

              <Button variant="danger" onClick={onLogout}>
                Выйти
              </Button>

              {chart && (
                <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                  <div className="text-sm text-slate-600 dark:text-slate-300">
                    ID: <span className="font-medium text-slate-900 dark:text-slate-100">{chart.id}</span>
                  </div>
                  <Badge variant={statusVariant(chart.status) as any}>{statusLabel(chart.status)}</Badge>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <Card title="Загрузка изображения" description="Поддерживаются изображения типа image/* (PNG, JPG и т.д.)">
              <input
                className="block w-full cursor-pointer rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700
                  file:mr-4 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white
                  hover:file:bg-slate-800
                  dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200
                  dark:file:bg-slate-100 dark:file:text-slate-900 dark:hover:file:bg-white"
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />

              <div className="mt-5 flex flex-wrap gap-3">
                <Button onClick={onUpload} disabled={!file || isUploading} loading={isUploading}>
                  {isUploading ? "Загрузка..." : "Отправить"}
                </Button>

                <Button
                  variant="secondary"
                  disabled={isUploading}
                  onClick={() => {
                    stopPolling();
                    setChart(null);
                    setError(null);
                    setFile(null);
                    setPreviewUrl(null);
                  }}
                >
                  Сброс
                </Button>
              </div>

              {error && (
                <div className="mt-5">
                  <Alert variant="danger" title="Ошибка">
                    {error}
                  </Alert>
                </div>
              )}

              {chart?.status === "processing" && (
                <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-900/40 dark:bg-blue-950/40">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-blue-900 dark:text-blue-100">Обработка</div>
                      <div className="mt-1 text-sm text-blue-800 dark:text-blue-200">
                        Идёт извлечение данных. Статус обновляется автоматически.
                      </div>
                    </div>
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700 dark:border-blue-900/50 dark:border-t-blue-300" />
                  </div>
                </div>
              )}
            </Card>
          </div>

          <div className="lg:col-span-5">
            <Card
              title="Превью"
              description={file ? `${file.name} • ${(file.size / 1024).toFixed(0)} KB` : "Файл не выбран"}
            >
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                {previewUrl ? (
                  <img src={previewUrl} className="block w-full object-contain" />
                ) : (
                  <div className="flex h-64 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                    Файл не выбран
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>

        <div className="mt-8 text-xs text-slate-500 dark:text-slate-400">
          Если пайплайн завершится ошибкой, на странице результатов всё равно будут показаны диагностические изображения.
        </div>
      </div>
    </div>
  );
}