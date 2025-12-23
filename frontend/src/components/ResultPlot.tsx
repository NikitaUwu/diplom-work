import PlotlyImport from "plotly.js-dist-min";
import factoryImport from "react-plotly.js/factory";

function unwrapDefault(mod: any): any {
  // разворачивает default/default/default... пока не станет "не объектом с default"
  let m = mod;
  while (m && typeof m === "object" && "default" in m) {
    m = (m as any).default;
  }
  return m;
}

const Plotly: any = unwrapDefault(PlotlyImport);
const createPlotlyComponent: any = unwrapDefault(factoryImport);

const Plot = createPlotlyComponent(Plotly);


type Props = {
  resultJson: any;
};

export default function ResultPlot({ resultJson }: Props) {
  const panels = resultJson?.panels;
  if (!Array.isArray(panels) || panels.length === 0) {
    return <div style={{ color: "#666" }}>Нет данных для построения графика.</div>;
  }

  const panel = panels[0];
  const series = Array.isArray(panel?.series) ? panel.series : [];

  const data = series.map((s: any) => {
    const pts = Array.isArray(s?.points) ? s.points : [];
    return {
      type: "scatter",
      mode: "lines",
      name: s?.name ?? s?.id ?? "series",
      x: pts.map((p: any) => (Array.isArray(p) ? p[0] : undefined)),
      y: pts.map((p: any) => (Array.isArray(p) ? p[1] : undefined)),
    };
  });

  return (
    <Plot
      data={data}
      layout={{
        margin: { l: 55, r: 20, t: 25, b: 45 },
        xaxis: { title: panel?.x_unit ?? "X" },
        yaxis: { title: panel?.y_unit ?? "Y" },
      }}
      config={{ responsive: true }}
      style={{ width: "100%", height: "420px" }}
      useResizeHandler
    />
  );
}
