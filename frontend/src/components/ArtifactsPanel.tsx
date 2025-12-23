import { artifactUrl } from "../api/client";

type Props = {
  chartId: number;
  resultJson: unknown;
};

function getArtifacts(resultJson: unknown): Record<string, string> {
  if (!resultJson || typeof resultJson !== "object") return {};
  const artifacts = (resultJson as any).artifacts;
  if (!artifacts || typeof artifacts !== "object") return {};
  return artifacts as Record<string, string>;
}

const ORDER = ["lineformer_prediction", "chartdete_predictions", "converted_plot"] as const;

const LABELS: Record<string, string> = {
  lineformer_prediction: "LineFormer: prediction",
  chartdete_predictions: "ChartDete: predictions",
  converted_plot: "Converted datapoints: plot",
};

export default function ArtifactsPanel({ chartId, resultJson }: Props) {
  const artifacts = getArtifacts(resultJson);
  const keys = ORDER.filter((k) => k in artifacts);

  if (keys.length === 0) return null;

  return (
    <div style={{ marginTop: 12, padding: 12, border: "1px solid #999" }}>
      <b>Артефакты пайплайна</b>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
        {keys.map((k) => (
          <div key={k}>
            <div style={{ marginBottom: 6 }}>
              <b>{LABELS[k] ?? k}</b>
            </div>

            <img
              src={artifactUrl(chartId, k)}
              alt={k}
              style={{ maxWidth: "100%", display: "block", border: "1px solid #ccc" }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />

            <div style={{ marginTop: 6, color: "#666", fontSize: 12 }}>
              Если картинка не отображается — проверьте, что бэкенд отдаёт файл по этому URL.
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
