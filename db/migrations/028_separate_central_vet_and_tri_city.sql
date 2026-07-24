do $$
begin
  if not exists (select 1 from clinics where slug = 'tri-city-vet') then
    update clinics
    set
      slug = 'tri-city-vet',
      name = 'Tri-City Veterinary Hospital',
      updated_at = now()
    where slug = 'central-vet';
  end if;
end $$;

insert into clinics (slug, name, time_zone, status)
values (
  'tri-city-vet',
  'Tri-City Veterinary Hospital',
  'America/Los_Angeles',
  'active'
)
on conflict (slug) do update set
  name = excluded.name,
  status = excluded.status,
  updated_at = now();

insert into clinics (slug, name, time_zone, status)
values (
  'central-vet',
  'Central Veterinary Hospital',
  'America/Los_Angeles',
  'active'
)
on conflict (slug) do update set
  name = excluded.name,
  status = excluded.status,
  updated_at = now();

with tri_city as (
  select id from clinics where slug = 'tri-city-vet'
)
insert into client_journey_settings (
  clinic_id,
  public_name,
  family_story,
  primary_domain,
  pims_provider,
  pims_mode
)
select
  id,
  'Tri-City Veterinary Hospital',
  'Family-run since 1986, with three generations serving local pets and their people.',
  'tricityvet.eepish.com',
  'mock-clinic',
  'adapter'
from tri_city
on conflict (clinic_id) do update set
  public_name = excluded.public_name,
  family_story = excluded.family_story,
  primary_domain = excluded.primary_domain,
  updated_at = now();

with central as (
  select id from clinics where slug = 'central-vet'
)
insert into client_journey_settings (
  clinic_id,
  public_name,
  family_story,
  primary_domain,
  pims_provider,
  pims_mode
)
select
  id,
  'Central Veterinary Hospital',
  '',
  'centralvet.eepish.com',
  'unconfigured',
  'adapter'
from central
on conflict (clinic_id) do update set
  public_name = excluded.public_name,
  primary_domain = excluded.primary_domain,
  updated_at = now();

update clinic_domains
set is_primary = false, updated_at = now()
where clinic_id in (
  select id from clinics where slug in ('central-vet', 'tri-city-vet')
);

with hospital_domains(slug, hostname, is_primary) as (
  values
    ('tri-city-vet', 'tricityvet.eepish.com', true),
    ('tri-city-vet', 'vetagent-internal.onrender.com', false),
    ('central-vet', 'centralvet.eepish.com', true),
    ('central-vet', 'central-vet.eepish.com', false),
    ('central-vet', 'central-vet.vet.eepish.com', false),
    ('central-vet', 'localhost', false),
    ('central-vet', '127.0.0.1', false)
)
insert into clinic_domains (clinic_id, hostname, is_primary)
select clinic.id, domain.hostname, domain.is_primary
from hospital_domains domain
join clinics clinic on clinic.slug = domain.slug
on conflict (hostname) do update set
  clinic_id = excluded.clinic_id,
  is_primary = excluded.is_primary,
  updated_at = now();

with tri_city as (
  select id from clinics where slug = 'tri-city-vet'
)
insert into app_settings (key, value, updated_by_name, updated_at)
select
  'clinic:' || tri_city.id || ':' || setting.key,
  setting.value,
  setting.updated_by_name,
  setting.updated_at
from app_settings setting
cross join tri_city
where setting.key not like 'clinic:%'
on conflict (key) do nothing;

do $$
declare
  tenant_table record;
begin
  for tenant_table in
    select table_schema, table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'clinic_id'
      and column_default like '%default_clinic_id%'
  loop
    execute format(
      'alter table %I.%I alter column clinic_id drop default',
      tenant_table.table_schema,
      tenant_table.table_name
    );
  end loop;
end $$;
