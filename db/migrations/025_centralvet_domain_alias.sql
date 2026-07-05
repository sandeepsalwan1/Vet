with central as (
  select id from clinics where slug = 'central-vet'
)
insert into clinic_domains (clinic_id, hostname, is_primary)
select id, hostname, is_primary
from central
cross join (
  values
    ('centralvet.eepish.com', true),
    ('central-vet.eepish.com', true)
) as domains(hostname, is_primary)
on conflict (hostname) do update set
  clinic_id = excluded.clinic_id,
  is_primary = excluded.is_primary,
  updated_at = now();
