import type { Database, Json } from "@/types/database";

/** Hand-maintained RPC extension; generated canonical table types stay unchanged. */
export type IntegrationDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      reserve_integration_setup: { Args: { p_operation_id: string; p_client_kind: string; p_account_id: string | null; p_resource: string }; Returns: Json };
      reconcile_integration_setup: { Args: { p_profile_id: string; p_expected_version: string }; Returns: Json };
      list_integration_setups: { Args: Record<string, never>; Returns: Json };
      approve_mt5_setup_pairing: { Args: { p_request: Json }; Returns: Json };
      get_mt5_setup_pairing: { Args: { p_profile_id: string; p_resource: string | null }; Returns: Json };
      approve_integration_grant: { Args: { p_authorization_id: string; p_purpose: string; p_account_id?: string | null }; Returns: Json };
      revoke_integration_grant: { Args: { p_grant_id: string; p_expected_version: string }; Returns: Json };
      list_integration_grants: { Args: Record<string, never>; Returns: Json };
      authorize_integration: { Args: { p_resource: string; p_purpose: string }; Returns: Json };
      get_integration_operation: { Args: { p_resource: string; p_purpose: string; p_operation_id: string }; Returns: Json };
      get_integration_consent_request: { Args: { p_authorization_id: string }; Returns: Json };
      activate_integration_grant: { Args: { p_authorization_id: string; p_expected_version: string }; Returns: Json };
      mt5_register_connection: { Args: { p_grant_id: string; p_operation_id: string; p_identity: Json }; Returns: Json };
      mt5_list_connections: { Args: Record<string, never>; Returns: Json };
      mt5_browser_source_page: { Args: { p_connection_id: string; p_offset?: number; p_limit?: number }; Returns: Json };
      mt5_set_connection_state: { Args: { p_connection_id: string; p_expected_version: string; p_operation_id: string;
        p_action: string; p_reason: string }; Returns: Json };
      mt5_acquire_lease: { Args: { p_resource: string; p_connection_id: string; p_worker_id: string; p_operation_id: string }; Returns: Json };
      mt5_capture: { Args: { p_resource: string; p_connection_id: string; p_worker_id: string; p_fencing_token: string;
        p_operation_id: string; p_identity: Json; p_checkpoint: string; p_events: Json; p_collection: Json }; Returns: Json };
    };
  };
};
