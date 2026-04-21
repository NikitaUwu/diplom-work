using System.Text.Json;
using DiplomWork.Data;
using DiplomWork.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace DiplomWork.Tests;

internal sealed class TestAppDbContext : AppDbContext
{
    public TestAppDbContext(DbContextOptions options)
        : base(options)
    {
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        var jsonConverter = new ValueConverter<JsonDocument?, string?>(
            value => SerializeJsonDocument(value),
            value => DeserializeJsonDocument(value));

        modelBuilder.Entity<Chart>().Property(item => item.ResultJson).HasConversion(jsonConverter);
        modelBuilder.Entity<ProcessingJob>().Property(item => item.RequestPayload).HasConversion(jsonConverter);
        modelBuilder.Entity<ProcessingJob>().Property(item => item.ResultPayload).HasConversion(jsonConverter);
        modelBuilder.Entity<OutboxMessage>().Property(item => item.Payload).HasConversion(jsonConverter);
        modelBuilder.Entity<InboxMessage>().Property(item => item.Payload).HasConversion(jsonConverter);
    }

    private static string? SerializeJsonDocument(JsonDocument? value) =>
        value == null ? null : value.RootElement.GetRawText();

    private static JsonDocument? DeserializeJsonDocument(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : JsonDocument.Parse(value, default);
}
