import Plot from "react-plotly.js";

type Props = {
  resultJson: unknown;
};

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null;
}

export default function ResultPlot({ resultJson }: Props) {
  if (!isObject(resultJson)) {
    return <div>Результат пустой или имеет неожиданный формат.</div>;
  }

  const panels = (resultJson as any).panels;
  if (!Array.isArray(panels) || panels.length === 0) {
    return <div>В результате нет panels.</div>;
  }

  // Пока берём первую панель (panel_0). Multi-panel добавим позже.
  const panel = panels[0];
  const seriesArr = panel?.series;

  if (!Array.isArray(seriesArr) || seriesArr.length === 0) {
    return <div>В результате нет series.</div>;
  }

  const traces = seriesArr
    .map((s: any) => {
      const points = s?.points;
      if (!Array.isArray(points) || points.length === 0) return null;

      const x: number[] = [];
      const y: number[] = [];

      for (const p of points) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const xx = Number(p[0]);
        const yy = Number(p[1]);
        if (!Number.isFinite(xx) || !Number.isFinite(yy)) continue;
        x.push(xx);
        y.push(yy);
      }

      if (x.length === 0) return null;

      return {
        type: "scatter",
        mode: "lines",
        name: String(s?.name ?? s?.id ?? "series"),
        x,
        y,
        hovertemplate: "x=%{x}<br>y=%{y}<extra></extra>",
      };
    })
    .filter(Boolean);

  if (traces.length === 0) {
    return <div>Не удалось извлечь точки для построения графика.</div>;
  }

  const xUnit = panel?.x_unit ? ` (${panel.x_unit})` : "";
  const yUnit = panel?.y_unit ? ` (${panel.y_unit})` : "";

  return (
    <Plot
      data={traces as any}
      layout={{
        autosize: true,
        margin: { l: 60, r: 20, t: 20, b: 50 },
        xaxis: { title: `X${xUnit}` },
        yaxis: { title: `Y${yUnit}` },
        legend: { orientation: "h" },
      }}
      style={{ width: "100%", height: "520px" }}
      useResizeHandler
      config={{ responsive: true, displaylogo: false }}
    />
  );
}
