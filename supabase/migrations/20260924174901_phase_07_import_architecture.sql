create type public.import_row_status as enum (
  'PENDING',
  'VALID',
  'INVALID',
  'DUPLICATE',
  'CONFLICT',
  'IMPORTED',
  'SKIPPED'
);

create type public.import_conflict_resolution as enum (
  'SKIP',
  'REVIEW',
  'LINK',
  'REPLACE'
);

alter table public.import_batches
  add column started_at timestamptz,
  add column source_reference text,
  add column skipped_count integer not null default 0,
  add column notes text,
  add column mapping_config jsonb,
  add column updated_at timestamptz not null default now();

update public.import_batches
set started_at = created_at
where started_at is null;

alter table public.import_batches
  alter column started_at set not null,
  alter column started_at set default now(),
  add constraint import_batches_import_source_only
    check (source_type <> 'MANUAL'),
  add constraint import_batches_skipped_count_non_negative
    check (skipped_count >= 0),
  add constraint import_batches_processed_counts_fit_total
    check (
      row_count is null or
      imported_count + skipped_count + failed_count <= row_count
    ),
  add constraint import_batches_mapping_config_object
    check (mapping_config is null or jsonb_typeof(mapping_config) = 'object'),
  add constraint import_batches_identity_unique
    unique (id, user_id, account_id, source_type);

alter table public.trades
  add column external_order_id text,
  add column external_position_id text,
  add column external_raw_data jsonb,
  add constraint trades_external_trade_id_not_blank
    check (external_trade_id is null or btrim(external_trade_id) <> ''),
  add constraint trades_external_order_id_not_blank
    check (external_order_id is null or btrim(external_order_id) <> ''),
  add constraint trades_external_position_id_not_blank
    check (external_position_id is null or btrim(external_position_id) <> ''),
  add constraint trades_external_raw_data_object
    check (external_raw_data is null or jsonb_typeof(external_raw_data) = 'object'),
  add constraint trades_import_source_requires_batch
    check (source_type = 'MANUAL' or import_batch_id is not null),
  add constraint trades_import_batch_identity_fk
    foreign key (import_batch_id, user_id, account_id, source_type)
    references public.import_batches(id, user_id, account_id, source_type);

create unique index trades_source_external_position_unique
  on public.trades(account_id, source_type, external_position_id)
  where external_position_id is not null;

create unique index trades_source_external_order_unique
  on public.trades(account_id, source_type, external_order_id)
  where external_order_id is not null;

create table public.import_batch_rows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null,
  row_number integer not null,
  status public.import_row_status not null default 'PENDING',
  deduplication_key text,
  external_trade_id text,
  external_order_id text,
  external_position_id text,
  raw_data jsonb not null,
  canonical_data jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  conflict_trade_id uuid,
  conflict_resolution public.import_conflict_resolution,
  resolution_notes text,
  resolution_confirmed_at timestamptz,
  resolution_confirmed_by_user_id uuid references auth.users(id),
  imported_trade_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_batch_rows_batch_owner_fk
    foreign key (batch_id, user_id)
    references public.import_batches(id, user_id) on delete cascade,
  constraint import_batch_rows_conflict_trade_owner_fk
    foreign key (conflict_trade_id, user_id)
    references public.trades(id, user_id),
  constraint import_batch_rows_imported_trade_owner_fk
    foreign key (imported_trade_id, user_id)
    references public.trades(id, user_id),
  constraint import_batch_rows_number_positive check (row_number > 0),
  constraint import_batch_rows_batch_row_unique unique (batch_id, row_number),
  constraint import_batch_rows_deduplication_key_not_blank
    check (deduplication_key is null or btrim(deduplication_key) <> ''),
  constraint import_batch_rows_external_trade_id_not_blank
    check (external_trade_id is null or btrim(external_trade_id) <> ''),
  constraint import_batch_rows_external_order_id_not_blank
    check (external_order_id is null or btrim(external_order_id) <> ''),
  constraint import_batch_rows_external_position_id_not_blank
    check (external_position_id is null or btrim(external_position_id) <> ''),
  constraint import_batch_rows_raw_data_object
    check (jsonb_typeof(raw_data) = 'object'),
  constraint import_batch_rows_canonical_data_object
    check (canonical_data is null or jsonb_typeof(canonical_data) = 'object'),
  constraint import_batch_rows_validation_errors_array
    check (jsonb_typeof(validation_errors) = 'array'),
  constraint import_batch_rows_invalid_has_errors
    check (status <> 'INVALID' or jsonb_array_length(validation_errors) > 0),
  constraint import_batch_rows_conflict_has_trade
    check (status <> 'CONFLICT' or conflict_trade_id is not null),
  constraint import_batch_rows_imported_has_trade
    check (status <> 'IMPORTED' or imported_trade_id is not null),
  constraint import_batch_rows_resolution_requires_conflict
    check (conflict_resolution is null or conflict_trade_id is not null),
  constraint import_batch_rows_replace_requires_confirmation
    check (
      conflict_resolution <> 'REPLACE' or (
        resolution_confirmed_at is not null and
        resolution_confirmed_by_user_id = user_id and
        length(btrim(coalesce(resolution_notes, ''))) >= 5
      )
    )
);

create index import_batch_rows_user_id_idx
  on public.import_batch_rows(user_id);

create index import_batch_rows_batch_status_idx
  on public.import_batch_rows(batch_id, status);

create index import_batch_rows_conflict_trade_id_idx
  on public.import_batch_rows(conflict_trade_id)
  where conflict_trade_id is not null;

create index import_batch_rows_imported_trade_id_idx
  on public.import_batch_rows(imported_trade_id)
  where imported_trade_id is not null;

create trigger import_batches_set_updated_at
before update on public.import_batches
for each row execute function private.set_updated_at();

create trigger import_batch_rows_set_updated_at
before update on public.import_batch_rows
for each row execute function private.set_updated_at();

alter table public.import_batch_rows enable row level security;
revoke all on table public.import_batch_rows from anon, authenticated;
grant select, insert, update, delete on table public.import_batch_rows to authenticated;

create policy import_batch_rows_select_own
on public.import_batch_rows for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy import_batch_rows_insert_own
on public.import_batch_rows for insert to authenticated
with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy import_batch_rows_update_own
on public.import_batch_rows for update to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()))
with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy import_batch_rows_delete_own
on public.import_batch_rows for delete to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));
