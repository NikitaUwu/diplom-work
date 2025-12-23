import { useEffect, useMemo, useRef, useState } from "react";
import { getChart, uploadChart, type ChartCreateResponse, type ChartStatus } from "./api/client";
import ResultPlot from "./components/ResultPlot";
import ArtifactsPanel from "./components/ArtifactsPanel";

function statusLabel(s: ChartStatus) {
  switch (s) {
    case "uploaded":
      return "Файл принят";
    case "processing":
      return "Обработка...";
    case "done":
      return "Готово";
    case "error":
      return "Ошибка обработки";
    default:
      return s;
  }
}

export default function App() {
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

  async function startPolling(chartId: number) {
    stopPolling();
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const fresh = await getChart(chartId);
        setChart(fresh);

        if (fresh.status === "done") {
          stopPolling();
        }
        if (fresh.status === "error") {
          stopPolling();
          setError(fresh.error_message || "Ошибка пайплайна (неизвестная причина)");
        }
      } catch (e: any) {
        stopPolling();
        setError(e?.message ?? "Ошибка при получении статуса обработки");
      }
    }, 2000);
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

      // сразу начинаем опрашивать статус по id
      await startPolling(r.id);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setIsUploading(false);
    }
  }

  const statusBox = chart ? (
    <div style={{ marginTop: 12, padding: 12, border: "1px solid #999" }}>
      <b>Статус:</b> {statusLabel(chart.status)} (id={chart.id})
      {chart.status === "processing" && (
        <div style={{ marginTop: 6, color: "#555" }}>
          Идёт обработка. Страница обновляется автоматически.
        </div>
      )}
    </div>
  ) : null;

  const artifactsBox = chart ? (
    <ArtifactsPanel chartId={chart.id} resultJson={chart.result_json} />
  ) : null;

  const resultBox =
    chart?.status === "done" ? (
      <div style={{ marginTop: 12, padding: 12, border: "1px solid #999" }}>
        <b>График</b>
        <div style={{ marginTop: 8 }}>
          <ResultPlot resultJson={chart.result_json} />
        </div>
      </div>
    ) : null;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui, Arial" }}>
      <h1 style={{ marginTop: 0 }}>Chart Extraction</h1>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: "block", marginBottom: 8 }}>Загрузите изображение графика</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />

          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button onClick={onUpload} disabled={!file || isUploading}>
              {isUploading ? "Загрузка..." : "Отправить"}
            </button>

            <button
              onClick={() => {
                stopPolling();
                setChart(null);
                setError(null);
                setFile(null);
                setPreviewUrl(null);
              }}
              disabled={isUploading}
            >
              Сброс
            </button>
          </div>

          {error && (
            <div style={{ marginTop: 12, padding: 12, border: "1px solid #d33" }}>
              <b>Ошибка</b>
              <div style={{ whiteSpace: "pre-wrap" }}>{error}</div>
            </div>
          )}

          {statusBox}
          {artifactsBox}
          {resultBox}
        </div>

        <div style={{ width: 360 }}>
          <div style={{ marginBottom: 8 }}>
            <b>Превью</b>
          </div>
          <div style={{ border: "1px solid #ccc", padding: 8, minHeight: 240 }}>
            {previewUrl ? (
              <img src={previewUrl} style={{ maxWidth: "100%", display: "block" }} />
            ) : (
              <div style={{ color: "#666" }}>Файл не выбран</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
