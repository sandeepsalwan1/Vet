alter table tasks
  add column if not exists completed_by_role app_role,
  add column if not exists archived_by_role app_role;

update tasks
set completed_by_role = event_roles.actor_role
from (
  select distinct on (task_id) task_id, actor_role
  from task_events
  where event_type = 'completed'
    and actor_role is not null
  order by task_id, created_at desc
) event_roles
where tasks.id = event_roles.task_id
  and tasks.completed_by_role is null;

update tasks
set archived_by_role = event_roles.actor_role
from (
  select distinct on (task_id) task_id, actor_role
  from task_events
  where event_type in ('archived', 'marked_invalid')
    and actor_role is not null
  order by task_id, created_at desc
) event_roles
where tasks.id = event_roles.task_id
  and tasks.archived_by_role is null;
