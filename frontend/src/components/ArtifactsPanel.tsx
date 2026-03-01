import { artifactUrl } from "../api/client";

type ArtifactKey =
  | "lineformer_prediction"
  | "chartdete_predictions"
  | "converted_plot";

type ArtifactsMap = Partial<Record<ArtifactKey, string>>;

type ResultJson = {
  artifacts?: ArtifactsMap;
} | null;

type Props = {
  chartId: number;
  resultJson: ResultJson | unknown;
};

const ARTIFACT_KEYS: ArtifactKey[] = [
  "lineformer_prediction",
  "chartdete_predictions",
  "converted_plot",
];

const META: Record<ArtifactKey, { title: string; subtitle: string }> = {
  lineformer_prediction: {
    title: "LineFormer",
    subtitle: "Prediction (извлечённая линия)",
  },
  chartdete_predictions: {
    title: "ChartDete",
    subtitle: "Predictions (элементы графика)",
  },
  converted_plot: {
    title: "Converted datapoints",
    subtitle: "Plot (если data.json сформирован)",
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractArtifacts(value: unknown): ArtifactsMap | null {
  if (!isObject(value)) return null;

  const rawArtifacts = value["artifacts"];
  if (!isObject(rawArtifacts)) return null;

  const result: ArtifactsMap = {};

  for (const key of ARTIFACT_KEYS) {
    const v = rawArtifacts[key];
    if (typeof v === "string" && v.trim() !== "") {
      result[key] = v;
    }
  }

  return result;
}

function ArtifactCard({
  title,
  subtitle,
  src,
}: {
  title: string;
  subtitle: string;
  src: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
      <div className="bg-white p-4">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
      </div>

      <div className="bg-slate-50 p-3">
        <div className="aspect-video overflow-hidden rounded-xl border border-slate-200 bg-white">
          <img
            src={src}
            className="h-full w-full object-contain"
            alt={title}
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default function ArtifactsPanel({ chartId, resultJson }: Props) {
  const artifacts = extractArtifacts(resultJson);

  const available = ARTIFACT_KEYS.filter((k) => typeof artifacts?.[k] === "string");

  if (!artifacts || available.length === 0) {
    return <div className="text-sm text-slate-600">Артефакты пока не доступны.</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {available.map((k) => (
        <ArtifactCard
          key={k}
          title={META[k].title}
          subtitle={META[k].subtitle}
          src={artifactUrl(chartId, k)}
        />
      ))}
    </div>
  );
}