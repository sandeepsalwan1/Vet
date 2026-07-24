import { getClientJourneySettings } from "./clientJourney";
import { resolveClinicId } from "./clinics";
import { getSql } from "./connection";
import {
  normalizeWaitStages,
  ratePercent,
  type AnalyticsRangeDays,
  type ClientAnalyticsSnapshot,
  type ClientVisitStage,
  type WaitMetricRow
} from "./analyticsRows";

type RetentionRow = {
  completed: number;
  clients: number;
  returning_clients: number;
  rebooked_clients: number;
};

type ResponseRow = {
  response_type: "visit_experience" | "pet_health";
  responses: number;
  positive: number;
  negative: number;
};

type PromptRow = {
  response_type: "visit_experience" | "pet_health";
  sent: number;
};

type FollowupCountRow = {
  emails_sent: number;
  awaiting_response: number;
  calls_due: number;
};

type FollowupRow = {
  client_id: string;
  client_name: string | null;
  pet_name: string | null;
  phone: string | null;
  appointment_id: string | null;
  email_sent_at: string;
  call_due_at: string;
};

type FreshnessRow = {
  latest_at: string | null;
};

export async function recordClientVisitStage(input: {
  clinicId?: string | null;
  clientId?: string | null;
  petId?: string | null;
  appointmentId: string;
  stage: ClientVisitStage;
  source: string;
  occurredAt?: string;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  await sql`
    insert into client_visit_stage_events (
      clinic_id,
      client_id,
      pet_id,
      appointment_id,
      stage,
      source,
      occurred_at
    ) values (
      ${clinicId},
      ${input.clientId ?? null},
      ${input.petId ?? null},
      ${input.appointmentId},
      ${input.stage},
      ${input.source},
      ${input.occurredAt ?? new Date().toISOString()}
    )
    on conflict (clinic_id, appointment_id, stage) do nothing
  `;
}

export async function getClientAnalytics(input: {
  clinicId?: string | null;
  rangeDays: AnalyticsRangeDays;
}): Promise<ClientAnalyticsSnapshot> {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const settings = await getClientJourneySettings({ clinicId });
  const emailAfterHours = settings.petCheckDelayHours;
  // Start the no-reply window at actual delivery, not the visit or planned send time.
  const callAfterEmailHours = settings.followupCallDelayHours;

  const [
    waitRows,
    retentionRows,
    responseRows,
    promptRows,
    followupCountRows,
    followupRows,
    freshnessRows
  ] = await Promise.all([
    sql<WaitMetricRow[]>`
      with visits as (
        select
          appointment_id,
          min(occurred_at) filter (where stage = 'checked_in') as checked_in_at,
          min(occurred_at) filter (where stage = 'roomed') as roomed_at,
          min(occurred_at) filter (where stage = 'care_started') as care_started_at,
          min(occurred_at) filter (where stage = 'care_complete') as care_complete_at,
          min(occurred_at) filter (where stage = 'checkout_complete') as checkout_at
        from client_visit_stage_events
        where clinic_id = ${clinicId}
          and occurred_at >= now() - (${input.rangeDays + 1} * interval '1 day')
        group by appointment_id
      ),
      durations as (
        select
          'check_in_to_room' as key,
          extract(epoch from (roomed_at - checked_in_at)) / 60 as minutes
        from visits
        union all
        select
          'room_to_care',
          extract(epoch from (care_started_at - roomed_at)) / 60
        from visits
        union all
        select
          'care_time',
          extract(epoch from (care_complete_at - care_started_at)) / 60
        from visits
        union all
        select
          'ready_to_checkout',
          extract(epoch from (checkout_at - care_complete_at)) / 60
        from visits
        union all
        select
          'total_visit',
          extract(epoch from (checkout_at - checked_in_at)) / 60
        from visits
      )
      select
        key,
        percentile_cont(0.5) within group (order by minutes) as median_minutes,
        percentile_cont(0.9) within group (order by minutes) as p90_minutes,
        count(*)::int as sample_size
      from durations
      where minutes >= 0
        and minutes <= 1440
      group by key
    `,
    sql<RetentionRow[]>`
      with range_visits as (
        select client_id, appointment_id, occurred_at
        from client_visit_stage_events
        where clinic_id = ${clinicId}
          and stage = 'checkout_complete'
          and client_id is not null
          and occurred_at >= now() - (${input.rangeDays} * interval '1 day')
      ),
      range_clients as (
        select client_id, max(occurred_at) as latest_visit_at
        from range_visits
        group by client_id
      ),
      lifetime_visits as (
        select client_id, count(distinct appointment_id)::int as visit_count
        from client_visit_stage_events
        where clinic_id = ${clinicId}
          and stage = 'checkout_complete'
          and client_id is not null
        group by client_id
      )
      select
        (select count(*)::int from range_visits) as completed,
        count(*)::int as clients,
        count(*) filter (where lifetime.visit_count > 1)::int as returning_clients,
        count(*) filter (
          where exists (
            select 1
            from mock_appointments appointment
            where appointment.clinic_id = ${clinicId}
              and appointment.client_id = range_client.client_id
              and (appointment.appointment_date + appointment.appointment_time)
                at time zone ${settings.timeZone} > now()
              and appointment.status in ('scheduled', 'confirmed')
              and not exists (
                select 1
                from range_visits completed_visit
                where completed_visit.client_id = range_client.client_id
                  and completed_visit.appointment_id = appointment.id
              )
          )
        )::int as rebooked_clients
      from range_clients range_client
      join lifetime_visits lifetime on lifetime.client_id = range_client.client_id
    `,
    sql<ResponseRow[]>`
      select
        response_type,
        count(*)::int as responses,
        count(*) filter (where sentiment = 'up')::int as positive,
        count(*) filter (where sentiment = 'down')::int as negative
      from client_journey_responses
      where clinic_id = ${clinicId}
        and created_at >= now() - (${input.rangeDays} * interval '1 day')
      group by response_type
    `,
    sql<PromptRow[]>`
      select
        case
          when message_type = 'visit_experience' then 'visit_experience'
          else 'pet_health'
        end as response_type,
        count(*) filter (where status = 'sent')::int as sent
      from client_journey_messages
      where clinic_id = ${clinicId}
        and message_type in ('visit_experience', 'pet_health_check')
        and scheduled_for >= now() - (${input.rangeDays} * interval '1 day')
      group by response_type
    `,
    sql<FollowupCountRow[]>`
      select
        count(*) filter (where message.status = 'sent')::int as emails_sent,
        count(*) filter (
          where message.status = 'sent'
            and response.id is null
        )::int as awaiting_response,
        count(*) filter (
          where message.status = 'sent'
            and response.id is null
            and coalesce(message.sent_at, message.scheduled_for)
              + (${callAfterEmailHours} * interval '1 hour') <= now()
        )::int as calls_due
      from client_journey_messages message
      left join client_journey_responses response
        on response.clinic_id = message.clinic_id
        and response.client_id = message.client_id
        and response.pet_id is not distinct from message.pet_id
        and response.appointment_id is not distinct from message.appointment_id
        and response.response_type = 'pet_health'
      where message.clinic_id = ${clinicId}
        and message.message_type = 'pet_health_check'
        and message.channel = 'email'
        and coalesce(message.sent_at, message.scheduled_for)
          >= now() - (${input.rangeDays} * interval '1 day')
    `,
    sql<FollowupRow[]>`
      select
        message.client_id,
        client.full_name as client_name,
        pet.name as pet_name,
        coalesce(preferences.phone, client.phone) as phone,
        message.appointment_id,
        coalesce(message.sent_at, message.scheduled_for) as email_sent_at,
        coalesce(message.sent_at, message.scheduled_for)
          + (${callAfterEmailHours} * interval '1 hour') as call_due_at
      from client_journey_messages message
      left join client_journey_responses response
        on response.clinic_id = message.clinic_id
        and response.client_id = message.client_id
        and response.pet_id is not distinct from message.pet_id
        and response.appointment_id is not distinct from message.appointment_id
        and response.response_type = 'pet_health'
      left join client_contact_preferences preferences
        on preferences.clinic_id = message.clinic_id
        and preferences.client_id = message.client_id
      left join mock_clients client
        on client.clinic_id = message.clinic_id
        and client.id = message.client_id
      left join mock_pets pet
        on pet.clinic_id = message.clinic_id
        and pet.id = message.pet_id
      where message.clinic_id = ${clinicId}
        and message.client_id is not null
        and message.message_type = 'pet_health_check'
        and message.channel = 'email'
        and message.status = 'sent'
        and response.id is null
        and coalesce(message.sent_at, message.scheduled_for)
          >= now() - (${input.rangeDays} * interval '1 day')
        and coalesce(message.sent_at, message.scheduled_for)
          + (${callAfterEmailHours} * interval '1 hour') <= now()
      order by call_due_at asc
      limit 40
    `,
    sql<FreshnessRow[]>`
      select max(latest_at) as latest_at
      from (
        select max(occurred_at) as latest_at
        from client_visit_stage_events
        where clinic_id = ${clinicId}
        union all
        select max(created_at)
        from client_journey_responses
        where clinic_id = ${clinicId}
        union all
        select max(updated_at)
        from client_journey_messages
        where clinic_id = ${clinicId}
      ) activity
    `
  ]);

  const retention = retentionRows[0] ?? {
    completed: 0,
    clients: 0,
    returning_clients: 0,
    rebooked_clients: 0
  };
  const responses = new Map(responseRows.map((row) => [row.response_type, row]));
  const prompts = new Map(promptRows.map((row) => [row.response_type, row.sent]));
  const experience = responses.get("visit_experience") ?? {
    responses: 0,
    positive: 0,
    negative: 0
  };
  const petHealth = responses.get("pet_health") ?? {
    responses: 0,
    positive: 0,
    negative: 0
  };
  const followup = followupCountRows[0] ?? {
    emails_sent: 0,
    awaiting_response: 0,
    calls_due: 0
  };
  const experiencePrompts = prompts.get("visit_experience") ?? 0;
  const petHealthPrompts = prompts.get("pet_health") ?? 0;

  return {
    rangeDays: input.rangeDays,
    generatedAt: new Date().toISOString(),
    dataThrough: freshnessRows[0]?.latest_at ?? null,
    visits: {
      completed: retention.completed,
      clients: retention.clients,
      returningClients: retention.returning_clients,
      returnRate: ratePercent(retention.returning_clients, retention.clients),
      rebookedClients: retention.rebooked_clients,
      rebookRate: ratePercent(retention.rebooked_clients, retention.clients)
    },
    waitStages: normalizeWaitStages(waitRows),
    experience: {
      positive: experience.positive,
      responses: experience.responses,
      positiveRate: ratePercent(experience.positive, experience.responses),
      promptsSent: experiencePrompts,
      responseRate: ratePercent(experience.responses, experiencePrompts)
    },
    petHealth: {
      doingWell: petHealth.positive,
      concerns: petHealth.negative,
      responses: petHealth.responses,
      doingWellRate: ratePercent(petHealth.positive, petHealth.responses),
      promptsSent: petHealthPrompts,
      responseRate: ratePercent(petHealth.responses, petHealthPrompts)
    },
    followup: {
      emailAfterHours,
      callAfterEmailHours,
      emailsSent: followup.emails_sent,
      awaitingResponse: followup.awaiting_response,
      callsDue: followup.calls_due,
      items: followupRows.map((row) => ({
        clientId: row.client_id,
        clientName: row.client_name ?? "Client",
        petName: row.pet_name ?? "Pet",
        phone: row.phone ?? "",
        appointmentId: row.appointment_id,
        emailSentAt: row.email_sent_at,
        callDueAt: row.call_due_at
      }))
    }
  };
}
