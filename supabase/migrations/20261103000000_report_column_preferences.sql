create table public.report_column_preferences (
  email text not null check (email = lower(email) and email ~ '^[^@[:space:]]+@centricitynow[.]com$'),
  report_level text not null check (report_level in ('order', 'shipment')),
  layout jsonb not null check (jsonb_typeof(layout) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (email, report_level)
);

alter table public.report_column_preferences enable row level security;
revoke all on public.report_column_preferences from public, anon, authenticated;
grant select, insert, update on public.report_column_preferences to service_role;
