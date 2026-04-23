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

            CREATE TABLE IF NOT EXISTS mqtt_messages (
                id BIGSERIAL PRIMARY KEY,
                processing_job_id BIGINT NULL,
                direction VARCHAR(16) NOT NULL DEFAULT 'out',
                topic VARCHAR(200) NOT NULL,
                status VARCHAR(32) NOT NULL,
                payload JSONB NULL,
                message_id VARCHAR(100) NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                error_message TEXT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_attempt_at TIMESTAMPTZ NULL,
                available_at TIMESTAMPTZ NULL,
                processed_at TIMESTAMPTZ NULL
            );

            ALTER TABLE IF EXISTS mqtt_messages ADD COLUMN IF NOT EXISTS processing_job_id BIGINT NULL;
            ALTER TABLE IF EXISTS mqtt_messages ADD COLUMN IF NOT EXISTS direction VARCHAR(16) NOT NULL DEFAULT 'out';
            ALTER TABLE IF EXISTS mqtt_messages ADD COLUMN IF NOT EXISTS topic VARCHAR(200) NOT NULL DEFAULT '';
            ALTER TABLE IF EXISTS mqtt_messages ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'pending';
            ALTER TABLE IF EXISTS mqtt_messages ADD COLUMN IF NOT EXISTS payload JSONB NULL;
            ALTER TABLE IF EXISTS mqtt_messages ADD COLUMN IF NOT EXISTS message_id VARCHAR(100) NULL;
            ALTER TABLE IF EXISTS mqtt_messages ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE IF EXISTS mqtt_messages ADD COLUMN IF NOT EXISTS error_message TEXT NULL;
            ALTER TABLE IF EXISTS mqtt_messages ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ NULL;
            ALTER TABLE IF EXISTS mqtt_messages ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NULL;
            ALTER TABLE IF EXISTS mqtt_messages ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ NULL;

            DO $$
            BEGIN
                IF to_regclass('public.outbox_messages') IS NOT NULL THEN
                    EXECUTE $migration$
                        INSERT INTO mqtt_messages (
                            processing_job_id,
                            direction,
                            topic,
                            status,
                            payload,
                            message_id,
                            attempt_count,
                            error_message,
                            created_at,
                            last_attempt_at,
                            available_at,
                            processed_at
                        )
                        SELECT
                            processing_job_id,
                            'out',
                            topic,
                            status,
                            payload,
                            message_id,
                            attempt_count,
                            error_message,
                            created_at,
                            last_attempt_at,
                            available_at,
                            published_at
                        FROM outbox_messages source
                        WHERE NOT EXISTS (
                            SELECT 1
                            FROM mqtt_messages target
                            WHERE target.direction = 'out'
                              AND target.message_id IS NOT DISTINCT FROM source.message_id
                        )
                    $migration$;
                END IF;
            END
            $$;

            DO $$
            BEGIN
                IF to_regclass('public.inbox_messages') IS NOT NULL THEN
                    EXECUTE $migration$
                        INSERT INTO mqtt_messages (
                            direction,
                            topic,
                            status,
                            payload,
                            message_id,
                            created_at,
                            processed_at
                        )
                        SELECT
                            'in',
                            topic,
                            'processed',
                            payload,
                            message_id,
                            created_at,
                            created_at
                        FROM inbox_messages source
                        WHERE NOT EXISTS (
                            SELECT 1
                            FROM mqtt_messages target
                            WHERE target.direction = 'in'
                              AND target.message_id IS NOT DISTINCT FROM source.message_id
                        )
                    $migration$;
                END IF;
            END
            $$;

            DROP TABLE IF EXISTS processing_alert_events;
            DROP TABLE IF EXISTS processing_alert_states;
            DROP TABLE IF EXISTS inbox_messages;
            DROP TABLE IF EXISTS outbox_messages;

            CREATE INDEX IF NOT EXISTS ix_mqtt_messages_processing_job_id ON mqtt_messages (processing_job_id);
            CREATE INDEX IF NOT EXISTS ix_mqtt_messages_direction ON mqtt_messages (direction);
            CREATE INDEX IF NOT EXISTS ix_mqtt_messages_status ON mqtt_messages (status);
            CREATE INDEX IF NOT EXISTS ix_mqtt_messages_created_at ON mqtt_messages (created_at);
            CREATE INDEX IF NOT EXISTS ix_mqtt_messages_available_at ON mqtt_messages (available_at);
            CREATE UNIQUE INDEX IF NOT EXISTS ix_mqtt_messages_direction_message_id ON mqtt_messages (direction, message_id);
            """;

        await _db.Database.ExecuteSqlRawAsync(sql, cancellationToken);
        await BootstrapAdminRolesAsync(cancellationToken);
        _logger.LogInformation("Ensured compact processing orchestration tables exist.");
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
