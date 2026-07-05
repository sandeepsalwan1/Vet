with applied as (
  insert into app_settings (key, value, updated_at)
  values ('vet_profile_default_passcodes_seeded', 'true', now())
  on conflict (key) do nothing
  returning key
)
update app_settings
set value = jsonb_set(
      value::jsonb,
      '{passcode}',
      to_jsonb(coalesce(value::jsonb ->> 'passcode', '')),
      true
    )::text,
    updated_at = now()
where key in ('recipient_profile:shiv', 'recipient_profile:raj')
  and updated_by_name is null
  and exists (select 1 from applied);
