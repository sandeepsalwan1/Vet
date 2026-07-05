alter table tasks
  add column if not exists assigned_by_role app_role;

update tasks
set assigned_by_role = pending_events.actor_role
from (
  select distinct on (task_id) task_id, actor_role
  from task_events
  where next_status = 'pending'
    and actor_role is not null
  order by task_id, created_at desc
) pending_events
where tasks.id = pending_events.task_id
  and tasks.status = 'pending'
  and tasks.assigned_to is not null
  and tasks.assigned_by_role is null;

update tasks
set assigned_by_role = created_by_role
where status = 'pending'
  and assigned_to is not null
  and assigned_by_role is null
  and created_by_role is not null;
