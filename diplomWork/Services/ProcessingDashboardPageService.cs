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
      --warn: #b36b00;
      --bad: #b42318;
      --accent: #1d4ed8;
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

    .history {
      display: grid;
      gap: 10px;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 14px;
      align-items: center;
    }

    button {
      border: 0;
      border-radius: 10px;
      background: var(--accent);
      color: white;
      padding: 10px 14px;
      font: inherit;
      cursor: pointer;
    }

    button.secondary {
      background: #dfe9ff;
      color: var(--text);
    }

    button:disabled {
      opacity: 0.6;
      cursor: default;
    }

    pre.preview {
      margin: 0;
      padding: 14px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: #0f172a;
      color: #e2e8f0;
      overflow: auto;
      font-size: 13px;
      line-height: 1.45;
      min-height: 120px;
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
        <p>Admin-панель для MQTT orchestration: alerts, metrics и быстрый разбор проблемных processing jobs, outbox и inbox.</p>
      </div>
      <div class="meta">
        <div id="refresh-status">Loading…</div>
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

      <section class="panel">
        <h2>Recent Alert Events</h2>
        <div class="history" id="history-column"></div>
      </section>

      <section class="panel">
        <h2>Notifier</h2>
        <div class="toolbar">
          <button id="dispatch-button" type="button">Dispatch Pending Now</button>
          <span class="muted" id="dispatch-result"></span>
        </div>
        <div class="stats" id="notifier-stats"></div>
      </section>

      <section class="panel">
        <h2>Payload Preview</h2>
        <pre class="preview" id="preview-box">Select an alert event to preview its outgoing webhook body.</pre>
      </section>
    </div>
  </div>

  <script>
    const state = {
      refreshEveryMs: 15000,
      overviewUrl: '/admin/processing/overview',
      notifierStatusUrl: '/admin/processing/notifier/status',
      notifierDispatchUrl: '/admin/processing/notifier/dispatch'
    };

    function formatDate(value) {
      if (!value) return '—';
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
        statCard('Pending Outbox', diagnostics.pendingOutboxCount),
        statCard('Error Outbox', diagnostics.errorOutboxCount)
      ].join('');
    }

    function renderAlerts(data) {
      const container = document.getElementById('alerts');
      if (!data.alerts.alerts.length) {
        container.innerHTML = '<div class="empty">Активных operational-alerts сейчас нет.</div>';
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

    function renderNotifierStatus(data) {
      const container = document.getElementById('notifier-stats');
      container.innerHTML = [
        statCard('Enabled', data.enabled ? 'Yes' : 'No'),
        statCard('Log Sink', data.logEnabled ? 'On' : 'Off'),
        statCard('Webhook', data.webhookConfigured ? 'Configured' : 'Off'),
        statCard('Format', data.webhookFormat),
        statCard('Min Severity', data.minimumSeverity),
        statCard('Ready', data.readyToDispatchCount),
        statCard('Pending', data.pendingCount),
        statCard('Error', data.errorCount),
        statCard('Sent', data.sentCount),
        statCard('Suppressed', data.suppressedCount)
      ].join('');
    }

    function renderJobGroup(title, items) {
      if (!items.length) {
        return `<div class="item"><strong>${title}</strong><div class="empty">Пусто</div></div>`;
      }

      return items.map(item => `
        <div class="item">
          <strong>${title}</strong>
          <div>job=${item.id}, chart=${item.chartId}, status=${item.status}, attempt=${item.attempt}</div>
          <div class="muted">error=${item.errorCode || '—'}, worker=${item.workerId || '—'}, message=${item.messageId || '—'}</div>
          <div class="muted">created=${formatDate(item.createdAt)}, lease=${formatDate(item.leasedUntil)}, retry=${formatDate(item.nextRetryAt)}</div>
        </div>
      `).join('');
    }

    function renderOutboxGroup(title, items) {
      if (!items.length) {
        return `<div class="item"><strong>${title}</strong><div class="empty">Пусто</div></div>`;
      }

      return items.map(item => `
        <div class="item">
          <strong>${title}</strong>
          <div>outbox=${item.id}, job=${item.processingJobId || '—'}, status=${item.status}, attempts=${item.attemptCount}</div>
          <div class="muted">topic=${item.topic}, message=${item.messageId || '—'}</div>
          <div class="muted">created=${formatDate(item.createdAt)}, available=${formatDate(item.availableAt)}, published=${formatDate(item.publishedAt)}</div>
        </div>
      `).join('');
    }

    function renderInboxGroup(items) {
      if (!items.length) {
        return `<div class="item"><strong>Recent Inbox</strong><div class="empty">Пусто</div></div>`;
      }

      return items.map(item => `
        <div class="item">
          <strong>Recent Inbox</strong>
          <div>inbox=${item.id}, topic=${item.topic}</div>
          <div class="muted">message=${item.messageId}, created=${formatDate(item.createdAt)}</div>
        </div>
      `).join('');
    }

    function renderDiagnostics(data) {
      const diagnostics = data.diagnostics;
      document.getElementById('jobs-column').innerHTML = [
        renderJobGroup('Stale Processing', diagnostics.staleProcessingJobs),
        renderJobGroup('Queued Ready', diagnostics.queuedReadyJobs),
        renderJobGroup('Failed Jobs', diagnostics.failedJobs)
      ].join('');

      document.getElementById('messages-column').innerHTML = [
        renderOutboxGroup('Pending Outbox', diagnostics.pendingOutboxMessages),
        renderOutboxGroup('Error Outbox', diagnostics.errorOutboxMessages),
        renderInboxGroup(diagnostics.recentInboxMessages)
      ].join('');
    }

    function renderHistory(data) {
      const container = document.getElementById('history-column');
      if (!data.recentAlertEvents.length) {
        container.innerHTML = '<div class="empty">История alert-событий пока пустая.</div>';
        return;
      }

      container.innerHTML = data.recentAlertEvents.map(item => `
        <div class="item">
          <strong>${item.eventType}</strong>
          <div>${item.alertCode} · severity=${item.severity} · count=${item.count}</div>
          <div class="muted">${item.message}</div>
          <div class="muted">created=${formatDate(item.createdAt)} · notify=${item.notificationStatus} · attempts=${item.notificationAttemptCount}</div>
          <div class="muted">notified=${formatDate(item.notifiedAt)} · nextRetry=${formatDate(item.notificationNextAttemptAt)}</div>
          <div style="margin-top:10px;"><button class="secondary" type="button" onclick="previewEvent(${item.id})">Preview payload</button></div>
          ${item.notificationError ? `<div class="error">${item.notificationError}</div>` : ''}
          ${item.samples.length ? `<ul class="samples">${item.samples.map(sample => `<li>${sample}</li>`).join('')}</ul>` : ''}
        </div>
      `).join('');
    }

    async function previewEvent(eventId) {
      const previewBox = document.getElementById('preview-box');
      previewBox.textContent = 'Loading preview...';
      try {
        const response = await fetch(`/admin/processing/alerts/${eventId}/preview`, { credentials: 'same-origin' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        previewBox.textContent = JSON.stringify(data, null, 2);
      } catch (error) {
        previewBox.textContent = `Preview failed: ${error.message}`;
      }
    }

    async function dispatchNow() {
      const button = document.getElementById('dispatch-button');
      const result = document.getElementById('dispatch-result');
      button.disabled = true;
      result.textContent = 'Dispatching...';
      try {
        const response = await fetch(state.notifierDispatchUrl, {
          method: 'POST',
          credentials: 'same-origin'
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        result.textContent = `Dispatched: ${data.dispatchedCount}`;
        await refresh();
      } catch (error) {
        result.textContent = `Dispatch failed: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    }

    async function refresh() {
      const refreshStatus = document.getElementById('refresh-status');
      try {
        refreshStatus.textContent = 'Refreshing…';
        const response = await fetch(state.overviewUrl, { credentials: 'same-origin' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const notifierResponse = await fetch(state.notifierStatusUrl, { credentials: 'same-origin' });
        if (!notifierResponse.ok) {
          throw new Error(`Notifier HTTP ${notifierResponse.status}`);
        }
        const notifierData = await notifierResponse.json();
        document.getElementById('generated-at').textContent = `Snapshot: ${formatDate(data.generatedAt)}`;
        refreshStatus.textContent = 'Auto-refresh every 15s';
        renderSummary(data);
        renderAlerts(data);
        renderDiagnostics(data);
        renderHistory(data);
        renderNotifierStatus(notifierData);
      } catch (error) {
        refreshStatus.innerHTML = `<span class="error">Refresh failed: ${error.message}</span>`;
      }
    }

    document.getElementById('dispatch-button').addEventListener('click', dispatchNow);
    window.previewEvent = previewEvent;
    refresh();
    setInterval(refresh, state.refreshEveryMs);
  </script>
</body>
</html>
""";
    }
}
