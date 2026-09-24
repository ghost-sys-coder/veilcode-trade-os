-- Phase 04 follow-up indexes for adjustment-classification foreign keys and ownership checks.

create index account_adjustment_classifications_user_id_idx
  on public.account_adjustment_classifications(user_id);

create index account_adjustment_classifications_actor_user_id_idx
  on public.account_adjustment_classifications(actor_user_id);

create index account_adjustments_account_owner_idx
  on public.account_adjustments(account_id, user_id);

create index account_adjustments_classified_by_user_id_idx
  on public.account_adjustments(classified_by_user_id)
  where classified_by_user_id is not null;
