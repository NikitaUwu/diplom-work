import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import Badge from '../components/ui/Badge';
import DropdownButton from '../components/ui/DropdownButton';
import Carousel, { type CarouselItem } from '../components/Carousel';
import {
  chartExportUrl,
  chartFileUrl,
  deleteChart,
  listCharts,
  type ChartCreateResponse,
  type ChartStatus,
} from '../api/client';

function statusLabel(status: ChartStatus) {
  switch (status) {
    case 'uploaded':
      return 'Файл принят';
    case 'processing':
      return 'Обработка';
    case 'done':
      return 'Готово';
    case 'error':
      return 'Ошибка';
    default:
      return status;
  }
}

function statusVariant(status: ChartStatus) {
  switch (status) {
    case 'done':
      return 'success';
    case 'processing':
      return 'info';
    case 'error':
      return 'danger';
    default:
      return 'default';
  }
}

function buildCarouselItems(chart: ChartCreateResponse): CarouselItem[] {
  const resultJson: any = chart.result_json ?? {};
  const artifacts: Record<string, string> =
    (resultJson && typeof resultJson === 'object' ? resultJson.artifacts : {}) || {};

  return [
    { label: 'Оригинал', src: chartFileUrl(chart.id, 'original') },
    artifacts.lineformer_prediction
      ? { label: 'LineFormer', src: chartFileUrl(chart.id, 'lineformer_prediction') }
      : null,
    artifacts.chartdete_predictions
      ? { label: 'ChartDete', src: chartFileUrl(chart.id, 'chartdete_predictions') }
      : null,
    artifacts.converted_plot
      ? { label: 'Plot', src: chartFileUrl(chart.id, 'converted_plot') }
      : null,
  ].filter(Boolean) as CarouselItem[];
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
      setItems(await listCharts());
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка загрузки списка результатов');
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
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка удаления');
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
        {items.map((chart) => {
          const canExport = chart.status === 'done';

          return (
            <Card
              key={chart.id}
              title={`Задача #${chart.id}`}
              description={`${chart.original_filename} • ${new Date(chart.created_at).toLocaleString()}`}
              right={
                <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
                  <Badge variant={statusVariant(chart.status) as any}>{statusLabel(chart.status)}</Badge>

                  <Link to={`/charts/${chart.id}`}>
                    <Button variant="secondary">Открыть</Button>
                  </Link>

                  {canExport && (
                    <Link to={`/charts/${chart.id}/spline-points`}>
                      <Button variant="secondary">Сплайн по N</Button>
                    </Link>
                  )}

                  <DropdownButton
                    label="Скачать"
                    variant="primary"
                    disabled={!canExport}
                    items={[
                      { label: 'CSV', href: chartExportUrl(chart.id, 'csv') },
                      { label: 'TXT', href: chartExportUrl(chart.id, 'txt') },
                      { label: 'JSON', href: chartExportUrl(chart.id, 'json') },
                      { label: 'TABLE', href: chartExportUrl(chart.id, 'table_csv') },
                    ]}
                  />

                  <button
                    type="button"
                    onClick={() => onDelete(chart.id)}
                    disabled={deletingId === chart.id}
                    title={`Удалить задачу #${chart.id}`}
                    aria-label={`Удалить задачу #${chart.id}`}
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
                  <Carousel items={buildCarouselItems(chart)} />
                </div>

                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 dark:bg-slate-900/40 dark:ring-slate-800">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Информация</div>
                  <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Статус:</span> {statusLabel(chart.status)}
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Серий:</span> {chart.n_series ?? '—'}
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Панелей:</span> {chart.n_panels ?? '—'}
                    </div>
                    {chart.status === 'error' && chart.error_message && (
                      <div className="mt-3 rounded-xl bg-white p-3 text-xs text-rose-700 ring-1 ring-rose-200 dark:bg-slate-950 dark:text-rose-300 dark:ring-rose-900/40">
                        {chart.error_message}
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
  }, [deletingId, error, items, loading, onDelete]);

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