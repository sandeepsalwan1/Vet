alter table tasks
  add column if not exists due_time time not null default time '19:00';

create index if not exists idx_tasks_due_date_time_source
  on tasks(due_date, due_time, source, created_at);
