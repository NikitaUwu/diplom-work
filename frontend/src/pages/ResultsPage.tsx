import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Alert from "../components/ui/Alert";
import Badge from "../components/ui/Badge";
import DropdownButton from "../components/ui/DropdownButton";
import Carousel, { type CarouselItem } from "../components/Carousel";
import {
  artifactUrl,
  deleteChart,
  exportCsvUrl,
  exportJsonUrl,
  exportTxtUrl,
  listCharts,
  originalUrl,
  type ChartCreateResponse,
  type ChartStatus,
} from "../api/client";

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

function buildCarouselItems(chart: ChartCreateResponse): CarouselItem[] {
  const rj: any = chart.result_json ?? {};
  const artifacts: Record<string, string> =
    (rj && typeof rj === "object" ? rj.artifacts : {}) || {};

  const items: CarouselItem[] = [
    { label: "Оригинал", src: originalUrl(chart.id) },

    artifacts["lineformer_prediction"]
      ? { label: "LineFormer", src: artifactUrl(chart.id, "lineformer_prediction") }
      : null,

    artifacts["chartdete_predictions"]
      ? { label: "ChartDete", src: artifactUrl(chart.id, "chartdete_predictions") }
      : null,

    artifacts["converted_plot"]
      ? { label: "Plot", src: artifactUrl(chart.id, "converted_plot") }
      : null,
  ].filter(Boolean) as CarouselItem[];

  return items;
}

export default function ResultsPage() {
  const [items, setItems] = useState<ChartCreateResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);


  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await listCharts();
      setItems(data);
    } catch (e: any) {
      setError(e?.message ?? "Ошибка загрузки списка результатов");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const onDelete = useCallback(async (id: number) => {
    const ok = window.confirm(`Удалить задачу #${id}?`);
    if (!ok) return;

    setDeletingId(id);
    setError(null);

    try {
      await deleteChart(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch (e: any) {
      setError(e?.message ?? "Ошибка удаления");
    } finally {
      setDeletingId(null);
    }
  }, []);

  const content = useMemo(() => {
    if (loading) {
      return <div className="text-sm text-slate-600 dark:text-slate-400">Загрузка...</div>;
    }

    if (error) {
      return (
        <Alert variant="danger" title="Ошибка">
          {error}
        </Alert>
      );
    }

    if (!items.length) {
      return <div className="text-sm text-slate-600 dark:text-slate-400">Результатов пока нет</div>;
    }

    return (
      <div className="mt-6 space-y-6">
        {items.map((c) => {
          const canExport = c.status === "done";

          return (
            <Card
              key={c.id}
              title={`Задача #${c.id}`}
              description={`${c.original_filename} • ${new Date(c.created_at).toLocaleString()}`}
              right={
                <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
                  <Badge variant={statusVariant(c.status) as any}>{statusLabel(c.status)}</Badge>

                  <Link to={`/charts/${c.id}`}>
                    <Button variant="secondary">Открыть</Button>
                  </Link>

                  <DropdownButton
                    label="Скачать"
                    variant="primary"
                    disabled={!canExport}
                    items={[
                      { label: "CSV", href: exportCsvUrl(c.id) },
                      { label: "TXT", href: exportTxtUrl(c.id) },
                      { label: "JSON", href: exportJsonUrl(c.id) },
                    ]}
                  />

                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    disabled={deletingId === c.id}
                    title={`Удалить задачу #${c.id}`}
                    aria-label={`Удалить задачу #${c.id}`}
                    className="inline-flex h-9 w-10 items-center justify-center rounded-xl px-3
                               bg-rose-600 text-white shadow-sm ring-1 ring-rose-600/30
                               transition hover:bg-rose-700 active:scale-[0.98]
                               disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    X
                  </button>
                </div>
              }
            >
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
                <div>
                  <Carousel items={buildCarouselItems(c)} />
                </div>

                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 dark:bg-slate-900/40 dark:ring-slate-800">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Информация</div>
                  <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Статус:</span> {statusLabel(c.status)}
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Серий:</span> {c.n_series ?? "—"}
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Панелей:</span> {c.n_panels ?? "—"}
                    </div>
                    {c.status === "error" && c.error_message && (
                      <div className="mt-3 rounded-xl bg-white p-3 text-xs text-rose-700 ring-1 ring-rose-200 dark:bg-slate-950 dark:text-rose-300 dark:ring-rose-900/40">
                        {c.error_message}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    );
  }, [items, loading, error, deletingId, onDelete]);

  return (
    <div className="min-h-full">
      <div className="mx-auto w-full max-w-screen-xl px-4 py-8 sm:px-6 sm:py-10 lg:px-10">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-7">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Мои результаты
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Список всех обработанных изображений и диагностических артефактов.
            </p>
          </div>

          <div className="lg:col-span-5">
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <Button variant="secondary" onClick={load} disabled={loading}>
                Обновить
              </Button>
              <Link to="/upload">
                <Button variant="secondary">Загрузить новое</Button>
              </Link>
            </div>
          </div>
        </div>

        {content}
      </div>
    </div>
  );
}