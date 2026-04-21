using DiplomWork.Configuration;
using DiplomWork.Data;
using DiplomWork.Models;
using Microsoft.EntityFrameworkCore;

namespace DiplomWork.Services;

public sealed class DatabaseInitializationService
{
    private readonly AppDbContext _db;
    private readonly AppOptions _options;
    private readonly ILogger<DatabaseInitializationService> _logger;

    public DatabaseInitializationService(AppDbContext db, AppOptions options, ILogger<DatabaseInitializationService> logger)
    {
        _db = db;
        _options = options;
        _logger = logger;
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        const string sql = """
            ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'user';
            UPDATE users SET role = LOWER(BTRIM(role)) WHERE role IS NOT NULL;
            UPDATE users SET role = 'user' WHERE role IS NULL OR BTRIM(role) = '' OR role NOT IN ('user', 'admin');

            CREATE TABLE IF NOT EXISTS processing_jobs (
                id BIGSERIAL PRIMARY KEY,
                chart_id INTEGER NOT NULL,
                status VARCHAR(32) NOT NULL,
                request_payload JSONB NULL,
                result_payload JSONB NULL,
                error_message TEXT NULL,
                error_code VARCHAR(100) NULL,
                message_id VARCHAR(100) NULL,
                worker_id VARCHAR(200) NULL,
                attempt INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                started_at TIMESTAMPTZ NULL,
                last_heartbeat_at TIMESTAMPTZ NULL,
                leased_until TIMESTAMPTZ NULL,
                next_retry_at TIMESTAMPTZ NULL,
                finished_at TIMESTAMPTZ NULL
            );

            ALTER TABLE IF EXISTS processing_jobs ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE IF EXISTS processing_jobs ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ NULL;
            ALTER TABLE IF EXISTS processing_jobs ADD COLUMN IF NOT EXISTS leased_until TIMESTAMPTZ NULL;
            ALTER TABLE IF EXISTS processing_jobs ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ NULL;
            ALTER TABLE IF EXISTS processing_jobs ADD COLUMN IF NOT EXISTS error_code VARCHAR(100) NULL;

            CREATE INDEX IF NOT EXISTS ix_processing_jobs_chart_id ON processing_jobs (chart_id);
            CREATE INDEX IF NOT EXISTS ix_processing_jobs_status ON processing_jobs (status);
            CREATE INDEX IF NOT EXISTS ix_processing_jobs_created_at ON processing_jobs (created_at);
            CREATE INDEX IF NOT EXISTS ix_processing_jobs_leased_until ON processing_jobs (leased_until);
            CREATE INDEX IF NOT EXISTS ix_processing_jobs_next_retry_at ON processing_jobs (next_retry_at);
            CREATE INDEX IF NOT EXISTS ix_processing_jobs_error_code ON processing_jobs (error_code);
            CREATE UNIQUE INDEX IF NOT EXISTS ix_processing_jobs_message_id ON processing_jobs (message_id);

            CREATE TABLE IF NOT EXISTS outbox_messages (
                id BIGSERIAL PRIMARY KEY,
                processing_job_id BIGINT NULL,
                topic VARCHAR(200) NOT NULL,
                status VARCHAR(32) NOT NULL,
                payload JSONB NULL,
                message_id VARCHAR(100) NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                error_message TEXT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_attempt_at TIMESTAMPTZ NULL,
                available_at TIMESTAMPTZ NULL,
                published_at TIMESTAMPTZ NULL
            );

            CREATE INDEX IF NOT EXISTS ix_outbox_messages_status ON outbox_messages (status);
            CREATE INDEX IF NOT EXISTS ix_outbox_messages_created_at ON outbox_messages (created_at);
            CREATE INDEX IF NOT EXISTS ix_outbox_messages_available_at ON outbox_messages (available_at);
            CREATE UNIQUE INDEX IF NOT EXISTS ix_outbox_messages_message_id ON outbox_messages (message_id);

            CREATE TABLE IF NOT EXISTS inbox_messages (
                id BIGSERIAL PRIMARY KEY,
                message_id VARCHAR(100) NOT NULL,
                topic VARCHAR(200) NOT NULL,
                payload JSONB NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE UNIQUE INDEX IF NOT EXISTS ix_inbox_messages_message_id ON inbox_messages (message_id);
            CREATE INDEX IF NOT EXISTS ix_inbox_messages_created_at ON inbox_messages (created_at);

            CREATE TABLE IF NOT EXISTS processing_alert_states (
                id BIGSERIAL PRIMARY KEY,
                alert_code VARCHAR(100) NOT NULL,
                is_active BOOLEAN NOT NULL,
                severity VARCHAR(32) NOT NULL,
                message TEXT NOT NULL,
                last_count INTEGER NOT NULL,
                samples_text TEXT NULL,
                first_activated_at TIMESTAMPTZ NULL,
                last_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_resolved_at TIMESTAMPTZ NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE UNIQUE INDEX IF NOT EXISTS ix_processing_alert_states_alert_code ON processing_alert_states (alert_code);
            CREATE INDEX IF NOT EXISTS ix_processing_alert_states_is_active ON processing_alert_states (is_active);
            CREATE INDEX IF NOT EXISTS ix_processing_alert_states_updated_at ON processing_alert_states (updated_at);

            CREATE TABLE IF NOT EXISTS processing_alert_events (
                id BIGSERIAL PRIMARY KEY,
                alert_code VARCHAR(100) NOT NULL,
                event_type VARCHAR(32) NOT NULL,
                severity VARCHAR(32) NOT NULL,
                message TEXT NOT NULL,
                count INTEGER NOT NULL,
                samples_text TEXT NULL,
                notification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
                notification_attempt_count INTEGER NOT NULL DEFAULT 0,
                last_notification_attempt_at TIMESTAMPTZ NULL,
                notification_next_attempt_at TIMESTAMPTZ NULL,
                notified_at TIMESTAMPTZ NULL,
                notification_error TEXT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            ALTER TABLE IF EXISTS processing_alert_events ADD COLUMN IF NOT EXISTS notification_status VARCHAR(32) NOT NULL DEFAULT 'pending';
            ALTER TABLE IF EXISTS processing_alert_events ADD COLUMN IF NOT EXISTS notification_attempt_count INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE IF EXISTS processing_alert_events ADD COLUMN IF NOT EXISTS last_notification_attempt_at TIMESTAMPTZ NULL;
            ALTER TABLE IF EXISTS processing_alert_events ADD COLUMN IF NOT EXISTS notification_next_attempt_at TIMESTAMPTZ NULL;
            ALTER TABLE IF EXISTS processing_alert_events ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ NULL;
            ALTER TABLE IF EXISTS processing_alert_events ADD COLUMN IF NOT EXISTS notification_error TEXT NULL;

            CREATE INDEX IF NOT EXISTS ix_processing_alert_events_alert_code ON processing_alert_events (alert_code);
            CREATE INDEX IF NOT EXISTS ix_processing_alert_events_event_type ON processing_alert_events (event_type);
            CREATE INDEX IF NOT EXISTS ix_processing_alert_events_created_at ON processing_alert_events (created_at);
            CREATE INDEX IF NOT EXISTS ix_processing_alert_events_notification_status ON processing_alert_events (notification_status);
            CREATE INDEX IF NOT EXISTS ix_processing_alert_events_notification_next_attempt_at ON processing_alert_events (notification_next_attempt_at);
            """;

        await _db.Database.ExecuteSqlRawAsync(sql, cancellationToken);
        await BootstrapAdminRolesAsync(cancellationToken);
        _logger.LogInformation("Ensured processing orchestration and alert-monitoring tables exist.");
    }

    private async Task BootstrapAdminRolesAsync(CancellationToken cancellationToken)
    {
        if (_options.AdminEmails.Length == 0)
        {
            return;
        }

        var bootstrapEmails = _options.AdminEmails
            .Select(item => item.Trim().ToLowerInvariant())
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Distinct()
            .ToArray();

        var users = await _db.Users
            .Where(item => bootstrapEmails.Contains(item.Email.ToLower()))
            .ToListAsync(cancellationToken);

        var updatedCount = 0;
        foreach (var user in users)
        {
            if (UserRoles.IsAdmin(user.Role))
            {
                continue;
            }

            user.Role = UserRoles.Admin;
            updatedCount++;
        }

        if (updatedCount == 0)
        {
            return;
        }

        await _db.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Bootstrapped admin role for {Count} user(s) from AdminEmails.", updatedCount);
    }
}
