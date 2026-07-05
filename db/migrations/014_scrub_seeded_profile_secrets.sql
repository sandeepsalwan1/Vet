with applied as (
  insert into app_settings (key, value, updated_at)
  values ('vet_profile_seeded_secrets_scrubbed', 'true', now())
  on conflict (key) do nothing
  returning key
)
update app_settings
set value = jsonb_set(
      jsonb_set(value::jsonb, '{email}', '""'::jsonb, true),
      '{phone}',
      '""'::jsonb,
      true
    )::text,
    updated_at = now()
where key like 'recipient_profile:%'
  and updated_by_name is null
  and exists (select 1 from applied);
