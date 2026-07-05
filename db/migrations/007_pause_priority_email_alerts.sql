insert into app_settings (key, value)
values ('priority_alerts_enabled', 'false')
on conflict (key) do nothing;
