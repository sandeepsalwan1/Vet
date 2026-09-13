import { createHash } from "node:crypto";
import { getSql } from "./connection";
import {
  normalizePlatformUsageSnapshot,
  type PlatformOperatorSettingsRow,
  type PlatformUsageRetentionRow,
  type PlatformUsageSnapshot,
  type PlatformUsageSummaryRow
} from "./productUsageRows";
import type { Actor } from "./types";

const activityBucketMinutes = 5;

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function activityBucket(date: Date) {
  const bucketMs = activityBucketMinutes * 60 * 1000;
  return new Date(Math.floor(date.getTime() / bucketMs) * bucketMs).toISOString();
}

export async function recordPlatformUsageEvent(input: {
  clinicId: string;
  actor: Actor;
  occurredAt?: Date;
}) {
  const sql = getSql();
  const occurredAt = input.occurredAt ?? new Date();
  const actorKeyHash = hashValue([
    input.clinicId,
    input.actor.role,
    input.actor.name.trim().toLowerCase()
  ].join("|"));
  const rows = await sql<{ id: string }[]>`
    insert into platform_usage_events (
      clinic_id,
      actor_key_hash,
      actor_role,
      activity_bucket,
      occurred_at
    )
    values (
      ${input.clinicId},
      ${actorKeyHash},
      ${input.actor.role},
      ${activityBucket(occurredAt)},
      ${occurredAt.toISOString()}
    )
    on conflict (clinic_id, actor_key_hash, activity_bucket) do nothing
    returning id
  `;
  return Boolean(rows[0]?.id);
}

export async function getPlatformOperatorSettings() {
  const sql = getSql();
  const rows = await sql<PlatformOperatorSettingsRow[]>`
    select
      usage_alerts_enabled,
      return_rate_threshold,
      current_alert_state,
      last_alerted_at,
      updated_at
    from platform_operator_settings
    where settings_key = 'default'
  `;
  if (!rows[0]) throw new Error("Platform operator settings are unavailable.");
  return rows[0];
}

export async function getPlatformUsageSnapshot(
  timeZone = process.env.APP_TIME_ZONE || process.env.TZ || "America/Los_Angeles"
): Promise<PlatformUsageSnapshot> {
  const sql = getSql();
  const monthStart = sql`
    date_trunc('month', now() at time zone ${timeZone}) at time zone ${timeZone}
  `;
  const dayStart = sql`
    date_trunc('day', now() at time zone ${timeZone}) at time zone ${timeZone}
  `;
  const [summaryRows, retentionRows, settings] = await Promise.all([
    sql<PlatformUsageSummaryRow[]>`
      with ordered as (
        select
          actor_key_hash,
          occurred_at,
          lag(occurred_at) over (
            partition by actor_key_hash
            order by occurred_at
          ) as previous_at
        from platform_usage_events
        where occurred_at >= ${monthStart} - interval '30 minutes'
      ),
      session_starts as (
        select occurred_at
        from ordered
        where occurred_at >= ${monthStart}
          and (
            previous_at is null
            or occurred_at - previous_at > interval '30 minutes'
          )
      )
      select
        (
          select count(distinct actor_key_hash)::int
          from platform_usage_events
          where occurred_at >= ${dayStart}
        ) as daily_active_users,
        (
          select count(distinct clinic_id)::int
          from platform_usage_events
          where occurred_at >= now() - interval '30 days'
        ) as active_hospitals,
        (select count(*)::int from session_starts) as sessions_this_month,
        (select max(occurred_at) from platform_usage_events) as data_through
    `,
    sql<PlatformUsageRetentionRow[]>`
      with first_seen as (
        select actor_key_hash, min(occurred_at) as first_at
        from platform_usage_events
        group by actor_key_hash
      ),
      eligible as (
        select actor_key_hash, first_at
        from first_seen
        where first_at <= now() - interval '30 days'
          and first_at >= now() - interval '120 days'
      )
      select
        count(*)::int as eligible_users,
        count(*) filter (
          where exists (
            select 1
            from platform_usage_events activity
            where activity.actor_key_hash = eligible.actor_key_hash
              and activity.occurred_at >= eligible.first_at + interval '8 days'
              and activity.occurred_at <= eligible.first_at + interval '30 days'
          )
        )::int as returned_users
      from eligible
    `,
    getPlatformOperatorSettings()
  ]);
  return normalizePlatformUsageSnapshot({
    summary: summaryRows[0],
    retention: retentionRows[0],
    settings
  });
}

export async function setPlatformUsageAlertsEnabled(enabled: boolean) {
  const sql = getSql();
  const rows = await sql<PlatformOperatorSettingsRow[]>`
    update platform_operator_settings
    set usage_alerts_enabled = ${enabled},
      updated_at = now()
    where settings_key = 'default'
    returning
      usage_alerts_enabled,
      return_rate_threshold,
      current_alert_state,
      last_alerted_at,
      updated_at
  `;
  if (!rows[0]) throw new Error("Platform operator settings are unavailable.");
  return rows[0];
}

export async function updatePlatformUsageAlertState(input: {
  state: "collecting" | "healthy" | "below";
  alertedAt?: string | null;
}) {
  const sql = getSql();
  await sql`
    update platform_operator_settings
    set current_alert_state = ${input.state},
      last_alerted_at = case
        when ${input.alertedAt ?? null}::timestamptz is null then last_alerted_at
        else ${input.alertedAt ?? null}::timestamptz
      end,
      updated_at = now()
    where settings_key = 'default'
  `;
}
