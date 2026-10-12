/** Fixed release prerequisites for the adapted browser and MCP services. */
export const INTEGRATION_SETUP_DATABASE_FUNCTIONS = [
  "private.reserve_integration_setup(uuid,text,uuid,text)",
  "private.reconcile_integration_setup(uuid,text)", "private.list_integration_setups()",
  "public.reserve_integration_setup(uuid,text,uuid,text)",
  "public.reconcile_integration_setup(uuid,text)", "public.list_integration_setups()",
  "private.enforce_setup_grant_binding()",
] as const;
export function applicationDatabaseFunctions(env: { TRADE_OS_INTEGRATION_SETUP_ENABLED?: string }) {
  return env.TRADE_OS_INTEGRATION_SETUP_ENABLED === "true"
    ? [...APPLICATION_DATABASE_FUNCTIONS, ...INTEGRATION_SETUP_DATABASE_FUNCTIONS]
    : [...APPLICATION_DATABASE_FUNCTIONS];
}
export const APPLICATION_DATABASE_FUNCTIONS = [
  "private.application_deletion_read(jsonb)","private.application_deletion_write(jsonb)",
  "private.application_file_read(jsonb)","private.application_file_prepare(jsonb)","private.application_file_write(jsonb,jsonb)",
  "private.application_mt5_grants(jsonb)","private.application_mt5_workflow_prepare(jsonb)","private.application_mt5_workflow_write(jsonb,jsonb)",
  "private.application_integration_read(jsonb)","private.application_mt5_review_prepare(jsonb)","private.application_mt5_review_write(jsonb,jsonb)",
  "private.application_profile_read(jsonb)","private.application_profile_write(jsonb)",
  "private.application_reporting_data(jsonb)",
  "private.application_reference_read(jsonb)","private.application_reference_write(jsonb)","private.application_trade_tag_write(jsonb)",
  "private.configuration_read(jsonb)", "private.configuration_write(jsonb)",
  "private.application_account_read(jsonb)", "private.application_account_write(jsonb)",
  "private.application_account_ledger(jsonb)", "private.application_account_event_read(jsonb)",
  "private.application_account_event_prepare(jsonb)", "private.application_account_event_write(jsonb,jsonb)",
  "private.application_trade_read(jsonb)", "private.application_trade_prepare(jsonb)",
  "private.application_trade_write(jsonb,jsonb)", "private.application_trade_references(jsonb)",
  "private.application_journal_read(jsonb)", "private.application_journal_write(jsonb)",
  "private.application_progress_read(jsonb)", "private.application_progress_prepare(jsonb)",
  "private.application_progress_write(jsonb,jsonb)", "private.application_progress_data(jsonb)",
] as const;
export const APPLICATION_DATABASE_COLUMNS = [
  {table:"profiles",column:"record_version"},
  {table:"tags",column:"record_version"},
  {table:"instruments",column:"record_version"},
  {table:"trading_accounts", column:"record_version"},
  {table:"account_adjustments", column:"record_version"},
  {table:"strategies", column:"record_version"},
  {table:"setups", column:"record_version"},
  {table:"trading_rules", column:"record_version"},
  {table:"trade_plan_corrections", column:"correction_sequence"},
  {table:"daily_logs", column:"record_version"},
  {table:"weekly_reviews", column:"record_version"},
  {table:"monthly_reviews", column:"record_version"},
  {table:"account_goals", column:"record_version"},
  {table:"prop_firm_configs", column:"record_version"},
] as const;
