import { artifactUrl } from "../api/client";

type Props = {
  chartId: number;
  resultJson: any;
};

type ArtifactKey = "lineformer_prediction" | "chartdete_predictions" | "converted_plot";

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
          />
        </div>
      </div>
    </div>
  );
}

export default function ArtifactsPanel({ chartId, resultJson }: Props) {
  const artifacts = (resultJson as any)?.artifacts as Partial<Record<string, string>> | undefined;

  const keys: ArtifactKey[] = ["lineformer_prediction", "chartdete_predictions", "converted_plot"];
  const available = keys.filter((k) => artifacts && artifacts[k]);

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
