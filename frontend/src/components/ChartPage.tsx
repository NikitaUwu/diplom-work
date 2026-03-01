import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getChart, type ChartCreateResponse, type ChartStatus } from "../api/client";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Alert from "../components/ui/Alert";
import Spinner from "../components/ui/Spinner";
import ArtifactsPanel from "../components/ArtifactsPanel";
import ResultPlot from "../components/ResultPlot"; // Убедись, что путь совпадает!

export type Point = { x: number; y: number };
export type ChartData = Record<string, Point[]>;

// Умная функция: если пришел старый формат (panels -> series),
// она переделает его в новый, чтобы ничего не сломалось.
function normalizeData(json: any): ChartData {
  if (!json || typeof json !== "object") return {};

  // Если это старый формат с panels
  if (Array.isArray(json.panels)) {
    const out: ChartData = {};
    json.panels.forEach((p: any) => {
      if (Array.isArray(p?.series)) {
        p.series.forEach((s: any) => {
          const name = s?.id || "series";
          const pts = Array.isArray(s?.points) ? s.points : [];
          // В старом формате точки были массивами [x, y]
          out[name] = pts.map((pt: any) => ({ x: pt[0], y: pt[1] }));
        });
      }
    });
    return out;
  }

  // Если это уже новый формат, возвращаем как есть
  return json as ChartData;
}

function statusLabel(s: ChartStatus) {
  switch (s) {
    case "uploaded": return "Файл принят";
    case "processing": return "Обработка";
    case "done": return "Готово";
    case "error": return "Ошибка";
    default: return s;
  }
}

function statusVariant(s: ChartStatus) {
  switch (s) {
    case "done": return "success";
    case "processing": return "info";
    case "error": return "danger";
    default: return "default";
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

function exportCsvFromData(data: ChartData | null): string {
  if (!data || Object.keys(data).length === 0) return "";
  let out = "series_id,x,y\n";
  for (const seriesKey of Object.keys(data)) {
    const points = data[seriesKey];
    if (!Array.isArray(points)) continue;
    for (const pt of points) {
      out += `${seriesKey},${pt.x},${pt.y}\n`;
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
  const [editedData, setEditedData] = useState<ChartData | null>(null);
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

      if (fresh.status === "done" && fresh.result_json && !editedData) {
        // Пропускаем JSON через нормализатор перед сохранением!
        const safeData = normalizeData(fresh.result_json);
        setEditedData(safeData);
      }

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
  }, [chartId]);

  const canExport = chart?.status === "done" && editedData !== null;

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
            <Button variant="secondary" onClick={() => navigate("/")}>Назад</Button>
            <Button
              onClick={() => {
                const csv = exportCsvFromData(editedData);
                if (!csv) return;
                downloadText(`chart_${chartId}_edited.csv`, csv, "text/csv;charset=utf-8");
              }}
              disabled={!canExport}
            >
              Экспорт CSV
            </Button>
          </div>
        </div>

        {error && <div className="mt-6"><Alert title="Ошибка" variant="danger">{error}</Alert></div>}

        <div className="mt-6 grid grid-cols-1 gap-6">
          {chart && (
            <Card
              title="Артефакты"
              description="Диагностические изображения."
              right={(chart.status === "processing" || chart.status === "uploaded") ? <Spinner /> : null}
            >
              <ArtifactsPanel chartId={chart.id} resultJson={chart.result_json} />
            </Card>
          )}

          {chart?.status === "done" && editedData && (
            <Card title="Редактор графика" description="Вы можете менять точки, интерполяцию и сетку. Экспорт сохранит изменения.">
              <ResultPlot data={editedData} onChange={setEditedData} />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}