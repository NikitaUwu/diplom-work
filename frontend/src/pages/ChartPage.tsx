import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Carousel, { type CarouselItem } from "../components/Carousel";
import {
  artifactUrl,
  exportCsvUrl,
  exportJsonUrl,
  exportTxtUrl,
  exportTableCsvUrl,
  getChart,
  originalUrl,
  updateChartResultJson,
  type ChartCreateResponse,
  type ChartStatus,
} from "../api/client";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Alert from "../components/ui/Alert";
import Spinner from "../components/ui/Spinner";
import DropdownButton from "../components/ui/DropdownButton";
import GraphEditor from "../components/GraphEditor";

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

function buildArtifactsCarousel(chart: ChartCreateResponse): CarouselItem[] {
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

export default function ChartPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const chartId = Number(id);

  const [chart, setChart] = useState<ChartCreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editedResultJson, setEditedResultJson] = useState<any | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

      if (fresh.status === "processing" || fresh.status === "uploaded") return;
      stopPolling();
    } catch (e: any) {
      stopPolling();
      setError(e?.message ?? "Ошибка при получении результата");
    }
  }

  async function onSave() {
    if (!chart || chart.status !== "done" || !editedResultJson || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      const fresh = await updateChartResultJson(chart.id, editedResultJson);
      setChart(fresh);
      setEditedResultJson(fresh.result_json);
      setDirty(false);
    } catch (e: any) {
      setSaveError(e?.message ?? "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    setEditedResultJson(null);
    setDirty(false);
    setSaveError(null);
  }, [chartId]);

  useEffect(() => {
    if (chart?.status === "done" && editedResultJson === null && chart.result_json) {
      setEditedResultJson(chart.result_json);
    }
  }, [chart?.status, chart?.result_json, editedResultJson]);

  useEffect(() => {
    if (!Number.isFinite(chartId) || chartId <= 0) {
      setError("Некорректный id графика");
      return;
    }

    stopPolling();
    setError(null);

    loadOnce();
    pollTimerRef.current = window.setInterval(loadOnce, 1500);

    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartId]);

  const canExport = chart?.status === "done" && chart.result_json;

  const artifactsItems = useMemo(() => (chart ? buildArtifactsCarousel(chart) : []), [chart]);

  const showArtifacts = Boolean(chart);
  const showEditor = chart?.status === "done";

  return (
    <div className="min-h-full">
      <div className="mx-auto w-full max-w-screen-xl px-4 py-8 sm:px-6 sm:py-10 lg:px-10">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-5">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Результаты обработки
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              График #{Number.isFinite(chartId) ? chartId : "—"}
            </h1>
          </div>

          <div className="lg:col-span-7">
            <div className="flex flex-wrap items-center gap-3 lg:justify-end">
              {chart && (
                <Badge variant={statusVariant(chart.status) as any}>
                  {statusLabel(chart.status)}
                </Badge>
              )}

              <Button variant="secondary" onClick={() => navigate("/")}>
                На главную страницу
              </Button>

              <DropdownButton
                label="Скачать"
                variant="primary"
                disabled={!canExport}
                items={[
                  { label: "CSV", href: exportCsvUrl(chartId) },
                  { label: "TXT", href: exportTxtUrl(chartId) },
                  { label: "JSON", href: exportJsonUrl(chartId) },
                  { label: "TABLE", href: exportTableCsvUrl(chartId) }
                ]}
              />
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

        {saveError && (
          <div className="mt-6">
            <Alert title="Ошибка сохранения" variant="danger">
              {saveError}
            </Alert>
          </div>
        )}

        {chart?.status === "error" && chart.error_message && (
          <div className="mt-6">
            <Alert title="Ошибка пайплайна" variant="danger">
              {chart.error_message}
            </Alert>
          </div>
        )}

        <div className="mt-6 space-y-6">
          {showArtifacts && (
            <Card
              title="Артефакты"
              description="Оригинал + диагностические изображения (LineFormer/ChartDete и, если есть, plot)."
              right={
                chart && (chart.status === "processing" || chart.status === "uploaded") ? (
                  <Spinner />
                ) : null
              }
            >
              {artifactsItems.length ? (
                <Carousel items={artifactsItems} />
              ) : (
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  Артефакты пока не доступны.
                </div>
              )}
            </Card>
          )}

          {showEditor && (
            <Card
              title="Интерактивный редактор"
              description="Редактирование извлечённых точек"
              right={
                <Button
                  variant="primary"
                  onClick={onSave}
                  disabled={!dirty || saving || chart?.status !== "done"}
                  loading={saving}
                >
                  Сохранить
                </Button>
              }
            >
              <GraphEditor
                resultJson={editedResultJson ?? chart?.result_json}
                onResultJsonChange={(next) => {
                  setEditedResultJson(next);
                  setDirty(true);
                }}
              />
            </Card>
          )}
        </div>

        <div className="mt-8 text-xs text-slate-500 dark:text-slate-400">
          Экспорт доступен после успешного извлечения точек.
        </div>
      </div>
    </div>
  );
}