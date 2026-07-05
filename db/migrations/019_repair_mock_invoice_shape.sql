alter table mock_invoices
  add column if not exists pet_id text references mock_pets(id) on delete cascade,
  add column if not exists invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists total_cents int,
  add column if not exists line_items jsonb not null default '[]',
  add column if not exists flags jsonb not null default '[]';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mock_invoices'
      and column_name = 'total_amount'
  ) then
    update mock_invoices
    set
      pet_id = coalesce(pet_id, 'pet-otis'),
      invoice_number = coalesce(invoice_number, id::text),
      invoice_date = coalesce(invoice_date, current_date),
      total_cents = coalesce(total_cents, total_amount, 0)
    where pet_id is null
      or invoice_number is null
      or invoice_date is null
      or total_cents is null;
  else
    update mock_invoices
    set
      pet_id = coalesce(pet_id, 'pet-otis'),
      invoice_number = coalesce(invoice_number, id::text),
      invoice_date = coalesce(invoice_date, current_date),
      total_cents = coalesce(total_cents, 0)
    where pet_id is null
      or invoice_number is null
      or invoice_date is null
      or total_cents is null;
  end if;
end $$;
