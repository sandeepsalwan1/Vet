alter type app_role add value if not exists 'va';
alter type app_role add value if not exists 'admin';

alter type task_source add value if not exists 'va';
alter type task_source add value if not exists 'admin';

alter table tasks
  add column if not exists request_type text not null default 'labs_xrays',
  add column if not exists escalated_at timestamptz,
  add column if not exists escalated_by_name text,
  add column if not exists escalated_by_role app_role;

do $$
begin
  alter table tasks
    add constraint tasks_request_type_check
    check (request_type in ('prescription', 'labs_xrays', 'records_request', 'scheduling', 'patient_update'));
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_tasks_escalated_active
  on tasks(escalated_at desc)
  where escalated_at is not null and archived_at is null;

insert into app_settings (key, value)
values
  (
    'recipient_profile:shiv',
    '{"profileId":"shiv","displayName":"Dr. Shiv","email":"","phone":"","emailOptIn":false,"smsOptIn":false}'
  ),
  (
    'recipient_profile:raj',
    '{"profileId":"raj","displayName":"Dr. Raj","email":"","phone":"","emailOptIn":false,"smsOptIn":false}'
  )
on conflict (key) do nothing;
