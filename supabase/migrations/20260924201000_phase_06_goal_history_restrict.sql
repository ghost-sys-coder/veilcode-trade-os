-- A goal with recorded progress is historical evidence and must be archived, not deleted.

alter table public.account_goal_progress_events
  drop constraint account_goal_progress_events_goal_owner_fk,
  add constraint account_goal_progress_events_goal_owner_fk
    foreign key (goal_id, user_id)
    references public.account_goals(id, user_id)
    on delete restrict;
