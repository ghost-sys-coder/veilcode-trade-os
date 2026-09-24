-- Cover Phase 05 composite ownership foreign keys in column order.

create index trade_rule_reviews_trade_owner_idx
  on public.trade_rule_reviews(trade_id, user_id);

create index trade_rule_review_items_review_owner_idx
  on public.trade_rule_review_items(review_id, user_id);
