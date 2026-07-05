insert into app_settings (key, value)
values
  (
    'recipient_profile:shiv',
    '{"profileId":"shiv","displayName":"Dr. Shiv","email":"","phone":"","passcode":"","active":true,"emailOptIn":false,"smsOptIn":false,"escalationOptIn":false,"dailyPriorityOptIn":false}'
  ),
  (
    'recipient_profile:raj',
    '{"profileId":"raj","displayName":"Dr. Raj","email":"","phone":"","passcode":"","active":true,"emailOptIn":false,"smsOptIn":false,"escalationOptIn":false,"dailyPriorityOptIn":false}'
  )
on conflict (key) do update
set value = case
      when app_settings.value::jsonb ? 'passcode' then app_settings.value
      else excluded.value
    end,
    updated_at = case
      when app_settings.value::jsonb ? 'passcode' then app_settings.updated_at
      else now()
    end;

update app_settings
set value = 'true',
    updated_at = now()
where key = 'priority_alerts_enabled'
  and value = 'false'
  and updated_by_name is null;
