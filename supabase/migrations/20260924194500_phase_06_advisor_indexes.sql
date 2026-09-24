-- Cover Phase 06 foreign keys used by ownership checks and append-only history reads.

create index account_goal_progress_events_user_id_idx
  on public.account_goal_progress_events(user_id);

create index account_status_events_user_id_idx
  on public.account_status_events(user_id);

create index account_status_events_actor_user_id_idx
  on public.account_status_events(actor_user_id)
  where actor_user_id is not null;

create index account_goals_account_owner_idx
  on public.account_goals(account_id, user_id);

create index account_snapshots_account_owner_captured_idx
  on public.account_snapshots(account_id, user_id, captured_at desc);
