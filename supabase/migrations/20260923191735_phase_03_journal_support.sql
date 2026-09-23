-- Phase 03 search and normalized tag support.

alter table public.tags
  drop constraint if exists tags_owner_name_unique;

alter table public.tags
  add column normalized_name text generated always as (lower(btrim(name))) stored;

alter table public.tags
  add constraint tags_normalized_name_not_blank check (normalized_name <> '');

create unique index tags_owner_normalized_name_unique
  on public.tags(user_id, normalized_name);

alter table public.trades
  add column search_vector tsvector generated always as (
    to_tsvector(
      'simple',
      coalesce(thesis, '') || ' ' ||
      coalesce(entry_reason, '') || ' ' ||
      coalesce(confirmation_notes, '')
    )
  ) stored;

create index trades_search_vector_idx on public.trades using gin(search_vector);
create index trades_user_journal_date_idx
  on public.trades(user_id, coalesce(opened_at, planned_at, created_at), id);
create index trades_user_realized_date_idx
  on public.trades(user_id, closed_at, id)
  where status = 'CLOSED';
