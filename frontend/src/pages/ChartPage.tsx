import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getChart, type ChartCreateResponse, type ChartStatus } from "../api/client";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Alert from "../components/ui/Alert";
import Spinner from "../components/ui/Spinner";
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

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportCsvFromResult(resultJson: any): string {
  const panels = resultJson?.panels;
  if (!Array.isArray(panels)) return "";

  let out = "panel_id,series_id,x,y\n";

  for (const p of panels) {
    const panelId = p?.id ?? "panel";
    const series = Array.isArray(p?.series) ? p.series : [];

    for (const s of series) {
      const sid = s?.id ?? "series";
      const points = Array.isArray(s?.points) ? s.points : [];

      for (const pt of points) {
        if (!Array.isArray(pt) || pt.length < 2) continue;
        out += `${panelId},${sid},${pt[0]},${pt[1]}\n`;
      }
    }
  }
  return out;
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

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500">Результаты обработки</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              График #{Number.isFinite(chartId) ? chartId : "—"}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {chart && <Badge variant={statusVariant(chart.status) as any}>{statusLabel(chart.status)}</Badge>}

            <Button variant="secondary" onClick={() => navigate("/")}>
              Назад
            </Button>

            <Button
              onClick={() => {
                const csv = exportCsvFromResult(chart?.result_json as any);
                if (!csv) return;
                downloadText(`chart_${chartId}.csv`, csv, "text/csv;charset=utf-8");
              }}
              disabled={!canExport}
              title={!canExport ? "Экспорт доступен только если точки успешно извлечены" : ""}
            >
              Экспорт CSV
            </Button>
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

        <div className="mt-6 grid grid-cols-1 gap-6">
          {chart && (
            <Card
              title="Артефакты"
              description="Диагностические изображения (LineFormer/ChartDete и, если есть, plot)."
              right={(chart.status === "processing" || chart.status === "uploaded") ? <Spinner /> : null}
            >
              <ArtifactsPanel chartId={chart.id} resultJson={chart.result_json} />
            </Card>
          )}

          {chart?.status === "done" && (
            <Card title="Интерактивный график" description="Построен по извлечённым точкам">
              <ResultPlot resultJson={chart.result_json} />
            </Card>
          )}
        </div>

        <div className="mt-8 text-xs text-slate-500">
          Экспорт формируется из извлечённых точек (если `data.json` был успешно создан).
        </div>
      </div>
    </div>
  );
}
