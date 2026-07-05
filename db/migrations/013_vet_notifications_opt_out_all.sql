with applied as (
  insert into app_settings (key, value, updated_at)
  values ('vet_notification_all_profiles_opt_out_applied', 'true', now())
  on conflict (key) do nothing
  returning key
)
update app_settings
set value = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(value::jsonb, '{emailOptIn}', 'false'::jsonb, true),
          '{smsOptIn}',
          'false'::jsonb,
          true
        ),
        '{escalationOptIn}',
        'false'::jsonb,
        true
      ),
      '{dailyPriorityOptIn}',
      'false'::jsonb,
      true
    )::text,
    updated_at = now()
where key like 'recipient_profile:%'
  and exists (select 1 from applied);
