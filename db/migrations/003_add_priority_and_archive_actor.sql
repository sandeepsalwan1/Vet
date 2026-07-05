alter table tasks
  add column if not exists priority text not null default 'medium',
  add column if not exists archived_by_name text;

do $$
begin
  alter table tasks
    add constraint tasks_priority_check
    check (priority in ('low', 'medium', 'high'));
exception
  when duplicate_object then null;
end $$;

update tasks
set status = 'archived',
    archived_at = coalesce(archived_at, updated_at, now()),
    archived_by_name = coalesce(archived_by_name, updated_by_name)
where status = 'invalid';
