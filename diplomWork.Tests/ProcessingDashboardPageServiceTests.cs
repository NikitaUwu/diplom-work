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
        Assert.Contains("Processing Dashboard", html);
        Assert.Contains("Operational Alerts", html);
        Assert.Contains("Diagnostics", html);
        Assert.Contains("Auto-refresh every 15s", html);
        Assert.DoesNotContain("/admin/processing/notifier/status", html);
        Assert.DoesNotContain("/admin/processing/notifier/dispatch", html);
        Assert.DoesNotContain("/admin/processing/alerts/", html);
        Assert.DoesNotContain("Recent Alert Events", html);
        Assert.DoesNotContain("Payload Preview", html);
        Assert.DoesNotContain("Dispatch Pending Now", html);
    }
}
