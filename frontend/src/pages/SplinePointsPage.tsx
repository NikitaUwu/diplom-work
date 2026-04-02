import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import GraphEditor from '../components/GraphEditor';
import Alert from '../components/ui/Alert';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import {
  getChart,
  previewChartSplinePoints,
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

export default function SplinePointsPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const chartId = Number(id);

  const [chart, setChart] = useState<ChartCreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [pointCount, setPointCount] = useState(3);
  const [previewResultJson, setPreviewResultJson] = useState<any | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);

  const pollTimerRef = useRef<number | null>(null);

  function stopPolling() {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  async function loadOnce() {
    try {
      const fresh = await getChart(chartId);
      setChart(fresh);

      if (fresh.status === 'processing' || fresh.status === 'uploaded') return;
      stopPolling();
    } catch (e: any) {
      stopPolling();
      setError(e?.message ?? 'Ошибка загрузки графика');
    }
  }

  async function onBuild() {
    if (!chart || chart.status !== 'done') return;

    setBuilding(true);
    setBuildError(null);

    try {
      const preview = await previewChartSplinePoints(chart.id, pointCount);
      setPreviewResultJson(preview.result_json ?? null);
      setEditorVersion((value) => value + 1);
    } catch (e: any) {
      setBuildError(e?.message ?? 'Ошибка построения предпросмотра сплайна');
    } finally {
      setBuilding(false);
    }
  }

  useEffect(() => {
    setChart(null);
    setError(null);
    setBuildError(null);
    setPointCount(3);
    setPreviewResultJson(null);
    setEditorVersion(0);
  }, [chartId]);

  useEffect(() => {
    if (!Number.isFinite(chartId) || chartId <= 0) {
      setError('Некорректный id графика');
      return;
    }

    stopPolling();
    setError(null);

    void loadOnce();
    pollTimerRef.current = window.setInterval(() => {
      void loadOnce();
    }, 1500);

    return () => stopPolling();
  }, [chartId]);

  const editorKey = useMemo(() => `${chartId}:${editorVersion}`, [chartId, editorVersion]);
  const canBuild = chart?.status === 'done' && pointCount >= 2;

  return (
    <div className="min-h-full">
      <div className="mx-auto w-full max-w-screen-xl px-4 py-8 sm:px-6 sm:py-10 lg:px-10">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-7">
            <div className="text-xs text-slate-500 dark:text-slate-400">Предпросмотр сплайна</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Сплайн по N точкам #{Number.isFinite(chartId) ? chartId : '—'}
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Граничные точки фиксированы, а внутренние точки автоматически выбираются по исходной кривой.
            </p>
          </div>

          <div className="lg:col-span-5">
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {chart && <Badge variant={statusVariant(chart.status) as any}>{statusLabel(chart.status)}</Badge>}

              <Button variant="secondary" onClick={() => navigate(`/charts/${chartId}`)}>
                К графику
              </Button>

              <Button variant="secondary" onClick={() => navigate('/results')}>
                К результатам
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-6">
            <Alert title="Ошибка" variant="danger">
              {error}
            </Alert>
          </div>
        )}

        {buildError && (
          <div className="mt-6">
            <Alert title="Ошибка построения" variant="danger">
              {buildError}
            </Alert>
          </div>
        )}

        {chart?.status === 'error' && chart.error_message && (
          <div className="mt-6">
            <Alert title="Ошибка пайплайна" variant="danger">
              {chart.error_message}
            </Alert>
          </div>
        )}

        <div className="mt-6 space-y-6">
          <Card
            title="Построить сплайн"
            description="Выберите, сколько точек нужно оставить в каждой серии перед построением кубического сплайна."
            right={chart && (chart.status === 'processing' || chart.status === 'uploaded') ? <Spinner /> : null}
          >
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[180px] flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Точек на серию
                </span>
                <input
                  type="number"
                  min={2}
                  step={1}
                  value={pointCount}
                  onChange={(e) => {
                    const nextValue = Number(e.target.value);
                    if (!Number.isFinite(nextValue)) return;
                    setPointCount(Math.max(2, Math.round(nextValue)));
                  }}
                  className="h-11 rounded-xl bg-white px-3 text-sm ring-1 ring-slate-200 outline-none transition focus:ring-2 focus:ring-slate-400 dark:bg-slate-950 dark:ring-slate-800"
                />
              </label>

              <Button variant="primary" onClick={onBuild} disabled={!canBuild} loading={building}>
                Построить сплайн
              </Button>
            </div>
          </Card>

          <Card
            title="Компактный редактор"
            description="Перемещайте точки, меняйте цвет активной кривой, название серии и размер точек."
          >
            {previewResultJson ? (
              <GraphEditor
                key={editorKey}
                chartId={chartId}
                resultJson={previewResultJson}
                uiMode="compact"
                onResultJsonChange={(next) => setPreviewResultJson(next)}
              />
            ) : (
              <div className="rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900/40 dark:text-slate-300 dark:ring-slate-800">
                Постройте сплайн, чтобы открыть компактный редактор.
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}