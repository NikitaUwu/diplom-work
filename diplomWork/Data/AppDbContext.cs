using DiplomWork.Models;
using Microsoft.EntityFrameworkCore;

namespace DiplomWork.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions options)
        : base(options)
    {
    }

    public DbSet<User> Users => Set<User>();
    public DbSet<Chart> Charts => Set<Chart>();
    public DbSet<ProcessingJob> ProcessingJobs => Set<ProcessingJob>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();
    public DbSet<InboxMessage> InboxMessages => Set<InboxMessage>();
    public DbSet<ProcessingAlertState> ProcessingAlertStates => Set<ProcessingAlertState>();
    public DbSet<ProcessingAlertEvent> ProcessingAlertEvents => Set<ProcessingAlertEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => item.Email).IsUnique();
            entity.HasIndex(item => item.Id);

            entity.Property(item => item.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(item => item.Email).HasColumnName("email").HasMaxLength(255).IsRequired();
            entity.Property(item => item.HashedPassword).HasColumnName("hashed_password").HasMaxLength(255).IsRequired();
            entity.Property(item => item.IsActive).HasColumnName("is_active").IsRequired();
            entity.Property(item => item.Role).HasColumnName("role").HasMaxLength(32).HasDefaultValue(UserRoles.User).IsRequired();
            entity.Property(item => item.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
        });

        modelBuilder.Entity<Chart>(entity =>
        {
            entity.ToTable("charts");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => item.Id);
            entity.HasIndex(item => item.UserId);
            entity.HasIndex(item => item.Sha256);

            entity.Property(item => item.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(item => item.UserId).HasColumnName("user_id").IsRequired();
            entity.Property(item => item.OriginalFilename).HasColumnName("original_filename").HasMaxLength(255).IsRequired();
            entity.Property(item => item.MimeType).HasColumnName("mime_type").HasMaxLength(100).IsRequired();
            entity.Property(item => item.Sha256).HasColumnName("sha256").HasMaxLength(64).IsRequired();
            entity.Property(item => item.OriginalPath).HasColumnName("original_path").HasMaxLength(1024).IsRequired();
            entity.Property(item => item.Status).HasColumnName("status").HasMaxLength(32).IsRequired();
            entity.Property(item => item.ErrorMessage).HasColumnName("error_message");
            entity.Property(item => item.ResultJson).HasColumnName("result_json").HasColumnType("jsonb");
            entity.Property(item => item.NPanels).HasColumnName("n_panels");
            entity.Property(item => item.NSeries).HasColumnName("n_series");
            entity.Property(item => item.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
            entity.Property(item => item.ProcessedAt).HasColumnName("processed_at");
        });

        modelBuilder.Entity<ProcessingJob>(entity =>
        {
            entity.ToTable("processing_jobs");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => item.ChartId);
            entity.HasIndex(item => item.Status);
            entity.HasIndex(item => item.CreatedAt);
            entity.HasIndex(item => item.LeasedUntil);
            entity.HasIndex(item => item.NextRetryAt);
            entity.HasIndex(item => item.ErrorCode);
            entity.HasIndex(item => item.MessageId).IsUnique();

            entity.Property(item => item.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(item => item.ChartId).HasColumnName("chart_id").IsRequired();
            entity.Property(item => item.Status).HasColumnName("status").HasMaxLength(32).IsRequired();
            entity.Property(item => item.RequestPayload).HasColumnName("request_payload").HasColumnType("jsonb");
            entity.Property(item => item.ResultPayload).HasColumnName("result_payload").HasColumnType("jsonb");
            entity.Property(item => item.ErrorMessage).HasColumnName("error_message");
            entity.Property(item => item.ErrorCode).HasColumnName("error_code").HasMaxLength(100);
            entity.Property(item => item.MessageId).HasColumnName("message_id").HasMaxLength(100);
            entity.Property(item => item.WorkerId).HasColumnName("worker_id").HasMaxLength(200);
            entity.Property(item => item.Attempt).HasColumnName("attempt").HasDefaultValue(0);
            entity.Property(item => item.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
            entity.Property(item => item.StartedAt).HasColumnName("started_at");
            entity.Property(item => item.LastHeartbeatAt).HasColumnName("last_heartbeat_at");
            entity.Property(item => item.LeasedUntil).HasColumnName("leased_until");
            entity.Property(item => item.NextRetryAt).HasColumnName("next_retry_at");
            entity.Property(item => item.FinishedAt).HasColumnName("finished_at");
        });

        modelBuilder.Entity<OutboxMessage>(entity =>
        {
            entity.ToTable("outbox_messages");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => item.Status);
            entity.HasIndex(item => item.CreatedAt);
            entity.HasIndex(item => item.AvailableAt);
            entity.HasIndex(item => item.MessageId).IsUnique();

            entity.Property(item => item.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(item => item.ProcessingJobId).HasColumnName("processing_job_id");
            entity.Property(item => item.Topic).HasColumnName("topic").HasMaxLength(200).IsRequired();
            entity.Property(item => item.Status).HasColumnName("status").HasMaxLength(32).IsRequired();
            entity.Property(item => item.Payload).HasColumnName("payload").HasColumnType("jsonb");
            entity.Property(item => item.MessageId).HasColumnName("message_id").HasMaxLength(100);
            entity.Property(item => item.AttemptCount).HasColumnName("attempt_count").HasDefaultValue(0);
            entity.Property(item => item.ErrorMessage).HasColumnName("error_message");
            entity.Property(item => item.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
            entity.Property(item => item.LastAttemptAt).HasColumnName("last_attempt_at");
            entity.Property(item => item.AvailableAt).HasColumnName("available_at");
            entity.Property(item => item.PublishedAt).HasColumnName("published_at");
        });

        modelBuilder.Entity<InboxMessage>(entity =>
        {
            entity.ToTable("inbox_messages");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => item.MessageId).IsUnique();
            entity.HasIndex(item => item.CreatedAt);

            entity.Property(item => item.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(item => item.MessageId).HasColumnName("message_id").HasMaxLength(100).IsRequired();
            entity.Property(item => item.Topic).HasColumnName("topic").HasMaxLength(200).IsRequired();
            entity.Property(item => item.Payload).HasColumnName("payload").HasColumnType("jsonb");
            entity.Property(item => item.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
        });

        modelBuilder.Entity<ProcessingAlertState>(entity =>
        {
            entity.ToTable("processing_alert_states");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => item.AlertCode).IsUnique();
            entity.HasIndex(item => item.IsActive);
            entity.HasIndex(item => item.UpdatedAt);

            entity.Property(item => item.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(item => item.AlertCode).HasColumnName("alert_code").HasMaxLength(100).IsRequired();
            entity.Property(item => item.IsActive).HasColumnName("is_active").IsRequired();
            entity.Property(item => item.Severity).HasColumnName("severity").HasMaxLength(32).IsRequired();
            entity.Property(item => item.Message).HasColumnName("message").IsRequired();
            entity.Property(item => item.LastCount).HasColumnName("last_count").IsRequired();
            entity.Property(item => item.SamplesText).HasColumnName("samples_text");
            entity.Property(item => item.FirstActivatedAt).HasColumnName("first_activated_at");
            entity.Property(item => item.LastObservedAt).HasColumnName("last_observed_at").IsRequired();
            entity.Property(item => item.LastResolvedAt).HasColumnName("last_resolved_at");
            entity.Property(item => item.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
            entity.Property(item => item.UpdatedAt).HasColumnName("updated_at").HasDefaultValueSql("now()");
        });

        modelBuilder.Entity<ProcessingAlertEvent>(entity =>
        {
            entity.ToTable("processing_alert_events");
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => item.AlertCode);
            entity.HasIndex(item => item.EventType);
            entity.HasIndex(item => item.CreatedAt);
            entity.HasIndex(item => item.NotificationStatus);
            entity.HasIndex(item => item.NotificationNextAttemptAt);

            entity.Property(item => item.Id).HasColumnName("id").ValueGeneratedOnAdd();
            entity.Property(item => item.AlertCode).HasColumnName("alert_code").HasMaxLength(100).IsRequired();
            entity.Property(item => item.EventType).HasColumnName("event_type").HasMaxLength(32).IsRequired();
            entity.Property(item => item.Severity).HasColumnName("severity").HasMaxLength(32).IsRequired();
            entity.Property(item => item.Message).HasColumnName("message").IsRequired();
            entity.Property(item => item.Count).HasColumnName("count").IsRequired();
            entity.Property(item => item.SamplesText).HasColumnName("samples_text");
            entity.Property(item => item.NotificationStatus).HasColumnName("notification_status").HasMaxLength(32).HasDefaultValue("pending");
            entity.Property(item => item.NotificationAttemptCount).HasColumnName("notification_attempt_count").HasDefaultValue(0);
            entity.Property(item => item.LastNotificationAttemptAt).HasColumnName("last_notification_attempt_at");
            entity.Property(item => item.NotificationNextAttemptAt).HasColumnName("notification_next_attempt_at");
            entity.Property(item => item.NotifiedAt).HasColumnName("notified_at");
            entity.Property(item => item.NotificationError).HasColumnName("notification_error");
            entity.Property(item => item.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
        });
    }
}
