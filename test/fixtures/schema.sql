-- Test fixture copied from Aokkorn Supabase initial schema; in-memory PostgreSQL only.
-- Aokkorn MVP: run once on an empty Supabase project.
-- NestJS on Render is the only application client of these tables.
-- This migration deliberately fails if a table already exists; review an
-- existing schema instead of silently accepting a mismatched definition.
begin;

create schema if not exists aokkorn_private;
revoke all on schema aokkorn_private from public;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  line_subject text not null unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_line_subject_not_blank check (length(btrim(line_subject)) > 0),
  constraint users_display_name_not_blank check (length(btrim(display_name)) > 0)
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sessions_token_hash_not_blank check (length(btrim(token_hash)) > 0),
  constraint sessions_expiry_after_creation check (expires_at > created_at),
  constraint sessions_revocation_after_creation check (
    revoked_at is null or revoked_at >= created_at
  )
);

create table public.currencies (
  code text primary key,
  symbol text not null,
  minor_unit_digits smallint not null,
  constraint currencies_code_format check (code ~ '^[A-Z]{3}$'),
  constraint currencies_symbol_not_blank check (length(btrim(symbol)) > 0),
  constraint currencies_minor_digits_range check (minor_unit_digits between 0 and 4)
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  base_currency_code text not null references public.currencies (code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint trips_name_not_blank check (length(btrim(name)) > 0)
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  display_name text not null,
  sort_order integer not null,
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint participants_id_trip_unique unique (id, trip_id),
  constraint participants_trip_sort_unique unique (trip_id, sort_order),
  constraint participants_name_not_blank check (length(btrim(display_name)) > 0),
  constraint participants_sort_positive check (sort_order > 0)
);

create table public.trip_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  name text not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_days_id_trip_unique unique (id, trip_id),
  constraint trip_days_trip_sort_unique unique (trip_id, sort_order),
  constraint trip_days_name_not_blank check (length(btrim(name)) > 0),
  constraint trip_days_sort_positive check (sort_order > 0)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  day_id uuid not null,
  name text not null,
  amount_minor bigint not null,
  currency_code text not null references public.currencies (code),
  payer_participant_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_name_not_blank check (length(btrim(name)) > 0),
  constraint expenses_amount_positive check (amount_minor > 0),
  constraint expenses_day_same_trip
    foreign key (day_id, trip_id)
    references public.trip_days (id, trip_id)
    on delete no action deferrable initially deferred,
  constraint expenses_payer_same_trip
    foreign key (payer_participant_id, trip_id)
    references public.participants (id, trip_id)
    on delete no action deferrable initially deferred
);

-- A historical snapshot remains after changing the trip's base currency.
-- At most one snapshot per expense can be current.
create table public.expense_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  from_currency text not null references public.currencies (code),
  to_currency text not null references public.currencies (code),
  rate numeric(30, 15) not null,
  source text not null,
  captured_at timestamptz not null,
  converted_amount_minor bigint not null,
  is_current boolean not null default true,
  constraint expense_rates_different_currencies check (
    from_currency <> to_currency
  ),
  constraint expense_rates_rate_positive check (rate > 0),
  constraint expense_rates_source_valid check (source in ('provider', 'manual')),
  constraint expense_rates_converted_nonnegative check (
    converted_amount_minor >= 0
  )
);

create table public.expense_shares (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  participant_id uuid not null references public.participants (id)
    on delete no action deferrable initially deferred,
  amount_minor bigint not null,
  split_order integer not null,
  constraint expense_shares_pkey primary key (expense_id, participant_id),
  constraint expense_shares_split_order_unique unique (expense_id, split_order),
  constraint expense_shares_amount_nonnegative check (amount_minor >= 0),
  constraint expense_shares_order_positive check (split_order > 0)
);

create table public.obligations (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  debtor_participant_id uuid not null references public.participants (id)
    on delete no action deferrable initially deferred,
  creditor_participant_id uuid not null references public.participants (id)
    on delete no action deferrable initially deferred,
  amount_minor bigint not null,
  currency_code text not null references public.currencies (code),
  status text not null default 'unpaid',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint obligations_expense_debtor_unique unique (
    expense_id, debtor_participant_id
  ),
  constraint obligations_distinct_people check (
    debtor_participant_id <> creditor_participant_id
  ),
  constraint obligations_amount_positive check (amount_minor > 0),
  constraint obligations_status_valid check (status in ('unpaid', 'paid'))
);

create table public.obligation_settlements (
  obligation_id uuid primary key references public.obligations (id)
    on delete cascade,
  paid_currency text not null references public.currencies (code),
  paid_amount_minor bigint not null,
  paid_at timestamptz not null,
  fx_rate numeric(30, 15),
  fx_source text,
  fx_captured_at timestamptz,
  expected_paid_amount_minor bigint,
  constraint settlements_amount_positive check (paid_amount_minor > 0),
  constraint settlements_fx_complete check (
    (
      fx_rate is null
      and fx_source is null
      and fx_captured_at is null
      and expected_paid_amount_minor is null
    )
    or
    (
      fx_rate is not null
      and fx_rate > 0
      and fx_source is not null
      and fx_source in ('provider', 'manual')
      and fx_captured_at is not null
      and expected_paid_amount_minor is not null
      and expected_paid_amount_minor >= 0
    )
  )
);

-- Unique and foreign-key indexes are created by PostgreSQL where necessary.
-- These extra indexes target common lookups and session cleanup.
create index sessions_user_id_idx on public.sessions (user_id);
create index sessions_expires_at_idx on public.sessions (expires_at);
create index sessions_revoked_at_idx on public.sessions (revoked_at)
  where revoked_at is not null;
create index trips_owner_active_idx
  on public.trips (owner_user_id, created_at desc)
  where deleted_at is null;
create index trips_owner_deleted_idx
  on public.trips (owner_user_id, deleted_at desc)
  where deleted_at is not null;
create unique index participants_one_owner_per_trip_idx
  on public.participants (trip_id)
  where is_owner;
create index expenses_trip_day_created_idx
  on public.expenses (trip_id, day_id, created_at, id);
create index expenses_payer_trip_idx
  on public.expenses (payer_participant_id, trip_id);
create unique index expense_rates_one_current_idx
  on public.expense_exchange_rates (expense_id)
  where is_current;
create index expense_rates_history_idx
  on public.expense_exchange_rates (expense_id, captured_at desc);
create index expense_shares_participant_idx
  on public.expense_shares (participant_id);
create index obligations_debtor_idx
  on public.obligations (debtor_participant_id);
create index obligations_creditor_idx
  on public.obligations (creditor_participant_id);
create index obligations_expense_idx
  on public.obligations (expense_id);

-- Maintain updated_at for mutable rows.
create function aokkorn_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function aokkorn_private.touch_updated_at() from public;

create trigger users_touch_updated_at
before update on public.users
for each row execute function aokkorn_private.touch_updated_at();

create trigger trips_touch_updated_at
before update on public.trips
for each row execute function aokkorn_private.touch_updated_at();

create trigger participants_touch_updated_at
before update on public.participants
for each row execute function aokkorn_private.touch_updated_at();

create trigger trip_days_touch_updated_at
before update on public.trip_days
for each row execute function aokkorn_private.touch_updated_at();

create trigger expenses_touch_updated_at
before update on public.expenses
for each row execute function aokkorn_private.touch_updated_at();

create trigger obligations_touch_updated_at
before update on public.obligations
for each row execute function aokkorn_private.touch_updated_at();

-- LINE authentication and per-trip authorization live in NestJS, not
-- Supabase Auth. Keep the generated Data API closed to browser roles.
alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.currencies enable row level security;
alter table public.trips enable row level security;
alter table public.participants enable row level security;
alter table public.trip_days enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_exchange_rates enable row level security;
alter table public.expense_shares enable row level security;
alter table public.obligations enable row level security;
alter table public.obligation_settlements enable row level security;

revoke all on table
  public.users,
  public.sessions,
  public.currencies,
  public.trips,
  public.participants,
  public.trip_days,
  public.expenses,
  public.expense_exchange_rates,
  public.expense_shares,
  public.obligations,
  public.obligation_settlements
from anon, authenticated, service_role;

commit;
