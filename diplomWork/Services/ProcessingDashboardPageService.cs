namespace DiplomWork.Services;

public sealed class ProcessingDashboardPageService
{
    public string Render()
    {
        return """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Processing Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: #ffffff;
      --text: #172033;
      --muted: #5e6b85;
      --border: #d9e1ef;
      --good: #0a7f42;
      --bad: #b42318;
      --shadow: 0 16px 40px rgba(23, 32, 51, 0.08);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: "Segoe UI", sans-serif;
      background: linear-gradient(180deg, #eef4ff 0%, var(--bg) 48%, #f9fbff 100%);
      color: var(--text);
    }

    .page {
      max-width: 1400px;
      margin: 0 auto;
      padding: 24px;
    }

    .hero {
      display: flex;
      justify-content: space-between;
      align-items: end;
      gap: 16px;
      margin-bottom: 24px;
    }

    .hero h1 {
      margin: 0;
      font-size: 32px;
      line-height: 1.1;
    }

    .hero p {
      margin: 8px 0 0;
      color: var(--muted);
      max-width: 760px;
    }

    .meta {
      color: var(--muted);
      font-size: 14px;
      text-align: right;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 18px;
    }

    .panel {
      grid-column: span 12;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 18px;
      box-shadow: var(--shadow);
    }

    .panel h2 {
      margin: 0 0 14px;
      font-size: 18px;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
    }

    .stat {
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px;
      background: #fbfcff;
    }

    .stat .label {
      display: block;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 8px;
    }

    .stat .value {
      display: block;
      font-size: 24px;
      font-weight: 700;
    }

    .alerts {
      display: grid;
      gap: 12px;
    }

    .alert {
      border-radius: 14px;
      padding: 14px;
      border: 1px solid var(--border);
      background: #fbfcff;
    }

    .alert.warning { border-color: #f2c36b; background: #fff8eb; }
    .alert.critical { border-color: #f1a4a4; background: #fff0f0; }
    .alert.info { border-color: #bdd2ff; background: #f3f7ff; }

    .alert .title {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .samples {
      margin: 10px 0 0;
      padding-left: 18px;
      color: var(--muted);
      font-size: 14px;
    }

    .columns {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
    }

    .list {
      display: grid;
      gap: 10px;
    }

    .item {
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px;
      background: #fbfcff;
      font-size: 14px;
    }

    .item strong {
      display: inline-block;
      margin-right: 8px;
    }

    .muted {
      color: var(--muted);
    }

    .empty {
      color: var(--good);
      font-weight: 600;
    }

    .error {
      color: var(--bad);
      white-space: pre-wrap;
    }

    @media (max-width: 980px) {
      .hero {
        flex-direction: column;
        align-items: stretch;
      }

      .meta {
        text-align: left;
      }

      .columns {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="hero">
      <div>
        <h1>Processing Dashboard</h1>
        <p>Admin page for the live processing pipeline: metrics, alerts and diagnostics for jobs and MQTT messages.</p>
      </div>
      <div class="meta">
        <div id="refresh-status">Loading...</div>
        <div id="generated-at"></div>
      </div>
    </div>

    <div class="grid">
      <section class="panel">
        <h2>System Snapshot</h2>
        <div class="stats" id="summary-stats"></div>
      </section>

      <section class="panel">
        <h2>Operational Alerts</h2>
        <div class="alerts" id="alerts"></div>
      </section>

      <section class="panel">
        <h2>Diagnostics</h2>
        <div class="columns">
          <div class="list" id="jobs-column"></div>
          <div class="list" id="messages-column"></div>
        </div>
      </section>
    </div>
  </div>

  <script>
    const state = {
      refreshEveryMs: 15000,
      overviewUrl: '/admin/processing/overview'
    };

    function formatDate(value) {
      if (!value) return '-';
      return new Date(value).toLocaleString();
    }

    function statCard(label, value) {
      return `<div class="stat"><span class="label">${label}</span><span class="value">${value}</span></div>`;
    }

    function renderSummary(data) {
      const metrics = data.metrics;
      const diagnostics = data.diagnostics;
      const alerts = data.alerts;
      const container = document.getElementById('summary-stats');
      container.innerHTML = [
        statCard('Healthy', alerts.isHealthy ? 'Yes' : 'No'),
        statCard('Queued Ready', metrics.queuedReadyJobs),
        statCard('Queued Delayed', metrics.queuedDelayedJobs),
        statCard('Retryable Errors', metrics.retryableErrorJobs),
        statCard('Terminal Errors', metrics.terminalErrorJobs),
        statCard('Stale Jobs', diagnostics.staleProcessingJobCount),
        statCard('Pending MQTT', diagnostics.pendingMqttMessageCount),
        statCard('Error MQTT', diagnostics.errorMqttMessageCount)
      ].join('');
    }

    function renderAlerts(data) {
      const container = document.getElementById('alerts');
      if (!data.alerts.alerts.length) {
        container.innerHTML = '<div class="empty">No active operational alerts.</div>';
        return;
      }

      container.innerHTML = data.alerts.alerts.map(item => `
        <div class="alert ${item.severity}">
          <div class="title">
            <span>${item.code}</span>
            <span>${item.count}</span>
          </div>
          <div>${item.message}</div>
          ${item.samples.length ? `<ul class="samples">${item.samples.map(sample => `<li>${sample}</li>`).join('')}</ul>` : ''}
        </div>
      `).join('');
    }

    function renderJobGroup(title, items) {
      if (!items.length) {
        return `<div class="item"><strong>${title}</strong><div class="empty">Empty</div></div>`;
      }

      return items.map(item => `
        <div class="item">
          <strong>${title}</strong>
          <div>job=${item.id}, chart=${item.chartId}, status=${item.status}, attempt=${item.attempt}</div>
          <div class="muted">error=${item.errorCode || '-'}, worker=${item.workerId || '-'}, message=${item.messageId || '-'}</div>
          <div class="muted">created=${formatDate(item.createdAt)}, lease=${formatDate(item.leasedUntil)}, retry=${formatDate(item.nextRetryAt)}</div>
        </div>
      `).join('');
    }

    function renderMqttGroup(title, items) {
      if (!items.length) {
        return `<div class="item"><strong>${title}</strong><div class="empty">Empty</div></div>`;
      }

      return items.map(item => `
        <div class="item">
          <strong>${title}</strong>
          <div>message=${item.id}, job=${item.processingJobId || '-'}, status=${item.status}, attempts=${item.attemptCount}</div>
          <div class="muted">topic=${item.topic}, messageId=${item.messageId || '-'}</div>
          <div class="muted">created=${formatDate(item.createdAt)}, available=${formatDate(item.availableAt)}, processed=${formatDate(item.processedAt)}</div>
        </div>
      `).join('');
    }

    function renderInboundMqttGroup(items) {
      if (!items.length) {
        return `<div class="item"><strong>Recent inbound</strong><div class="empty">Empty</div></div>`;
      }

      return items.map(item => `
        <div class="item">
          <strong>Recent inbound</strong>
          <div>message=${item.id}, topic=${item.topic}</div>
          <div class="muted">messageId=${item.messageId || '-'}, created=${formatDate(item.createdAt)}</div>
        </div>
      `).join('');
    }

    function renderDiagnostics(data) {
      const diagnostics = data.diagnostics;
      document.getElementById('jobs-column').innerHTML = [
        renderJobGroup('Stale processing', diagnostics.staleProcessingJobs),
        renderJobGroup('Queued ready', diagnostics.queuedReadyJobs),
        renderJobGroup('Failed jobs', diagnostics.failedJobs)
      ].join('');

      document.getElementById('messages-column').innerHTML = [
        renderMqttGroup('Pending MQTT', diagnostics.pendingMqttMessages),
        renderMqttGroup('Error MQTT', diagnostics.errorMqttMessages),
        renderInboundMqttGroup(diagnostics.recentInboundMqttMessages)
      ].join('');
    }

    async function refresh() {
      const refreshStatus = document.getElementById('refresh-status');
      try {
        refreshStatus.textContent = 'Refreshing...';
        const response = await fetch(state.overviewUrl, { credentials: 'same-origin' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        document.getElementById('generated-at').textContent = `Snapshot: ${formatDate(data.generatedAt)}`;
        refreshStatus.textContent = 'Auto-refresh every 15s';
        renderSummary(data);
        renderAlerts(data);
        renderDiagnostics(data);
      } catch (error) {
        refreshStatus.innerHTML = `<span class="error">Refresh failed: ${error.message}</span>`;
      }
    }

    refresh();
    setInterval(refresh, state.refreshEveryMs);
  </script>
</body>
</html>
""";
    }
}
