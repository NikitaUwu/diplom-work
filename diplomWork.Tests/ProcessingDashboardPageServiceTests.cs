using DiplomWork.Services;
using Xunit;

namespace DiplomWork.Tests;

public sealed class ProcessingDashboardPageServiceTests
{
    [Fact]
    public void Render_ContainsOverviewEndpointAndDashboardSections()
    {
        var service = new ProcessingDashboardPageService();

        var html = service.Render();

        Assert.Contains("/admin/processing/overview", html);
        Assert.Contains("/admin/processing/notifier/status", html);
        Assert.Contains("/admin/processing/notifier/dispatch", html);
        Assert.Contains("/admin/processing/alerts/", html);
        Assert.Contains("Processing Dashboard", html);
        Assert.Contains("Operational Alerts", html);
        Assert.Contains("Diagnostics", html);
        Assert.Contains("Recent Alert Events", html);
        Assert.Contains("Payload Preview", html);
        Assert.Contains("Dispatch Pending Now", html);
        Assert.Contains("Auto-refresh every 15s", html);
    }
}
