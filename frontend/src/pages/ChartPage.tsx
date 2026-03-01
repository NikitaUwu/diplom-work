import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  exportCsvUrl,
  exportJsonUrl,
  exportTxtUrl,
  getChart,
  type ChartCreateResponse,
  type ChartStatus,
} from "../api/client";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Alert from "../components/ui/Alert";
import Spinner from "../components/ui/Spinner";
import DropdownButton from "../components/ui/DropdownButton";
import ArtifactsPanel from "../components/ArtifactsPanel";
import ResultPlot from "../components/ResultPlot";

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

export default function ChartPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const chartId = Number(id);

  const [chart, setChart] = useState<ChartCreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const showArtifacts = Boolean(chart);
  const showPlot = chart?.status === "done";

  return (
    <div className="min-h-full">
      <div className="mx-auto w-full max-w-screen-xl px-4 py-8 sm:px-6 sm:py-10 lg:px-10">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Результаты обработки</div>
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
                  { label: "CSV", href: exportCsvUrl(chartId), disabled: !canExport },
                  { label: "TXT", href: exportTxtUrl(chartId), disabled: !canExport },
                  { label: "JSON", href: exportJsonUrl(chartId), disabled: !canExport },
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

        {chart?.status === "error" && chart.error_message && (
          <div className="mt-6">
            <Alert title="Ошибка пайплайна" variant="danger">
              {chart.error_message}
            </Alert>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {showArtifacts && (
            <Card
              className={showPlot ? "lg:col-span-5" : "lg:col-span-12"}
              title="Артефакты"
              description="Диагностические изображения (LineFormer/ChartDete и, если есть, plot)."
              right={
                chart && (chart.status === "processing" || chart.status === "uploaded") ? (
                  <Spinner />
                ) : null
              }
            >
              <ArtifactsPanel chartId={chart!.id} resultJson={chart!.result_json} />
            </Card>
          )}

          {showPlot && (
            <Card
              className="lg:col-span-7"
              title="Интерактивный график"
              description="Построен по извлечённым точкам"
            >
              <ResultPlot resultJson={chart?.result_json} />
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