/**
 * Hand-written counterpart to `supabase gen types typescript` (no CLI/DB
 * access from here to generate it), kept in sync with supabase/schema.sql.
 * Wiring this into createClient<Database>() in lib/supabase.ts is what lets
 * `.insert()`/`.update()` catch a typo'd column name at compile time instead
 * of needing `as never` to silence the untyped client everywhere.
 *
 * Only tables/functions actually touched via supabase-js from the browser are
 * listed — service-role-only tables (otp_codes) and server-only RPCs
 * (create_team_with_owner, transfer_team_ownership, is_team_member) live
 * entirely behind the Netlify functions and never go through this client.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Insert, Update = Partial<Insert>> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };

export interface Database {
  public: {
    Tables: {
      users: Table<
        { id: string; email: string; full_name: string },
        never // never inserted/updated via this client — see netlify/functions/auth.ts
      >;
      teams: Table<
        { id: string; name: string; owner_id: string; created_at: string },
        never // writes go through netlify/functions/teams.ts
      >;
      team_members: Table<
        { team_id: string; user_id: string; role: "owner" | "admin" | "member" | "viewer"; joined_at: string },
        never
      >;
      team_invites: Table<
        {
          id: string; team_id: string; email: string; role: "admin" | "member" | "viewer"; token_hash: string;
          invited_by: string; status: "pending" | "accepted" | "revoked" | "expired";
          expires_at: string; accepted_at: string | null; created_at: string;
        },
        never
      >;
      projects: Table<
        {
          id: string; user_id: string; team_id: string | null; name: string; client: string | null;
          stacks: string[]; status: "active" | "hold" | "archived"; accent: string | null;
          fe_path: string | null; sln_path: string | null; dev_port: number | null;
          branch: string | null; description: string | null;
          sprint_project_id: string | null; sprint_project_name: string | null;
          repo_provider: "github" | "gitlab" | "azuredevops" | null; repo_full_name: string | null;
          repo_id: string | null; repo_default_branch: string | null; created_at: string;
        },
        {
          id?: string; user_id: string; team_id?: string | null; name: string; client?: string | null;
          stacks?: string[]; status?: "active" | "hold" | "archived"; accent?: string | null;
          fe_path?: string | null; sln_path?: string | null; dev_port?: number | null;
          branch?: string | null; description?: string | null;
          sprint_project_id?: string | null; sprint_project_name?: string | null;
          repo_provider?: "github" | "gitlab" | "azuredevops" | null; repo_full_name?: string | null;
          repo_id?: string | null; repo_default_branch?: string | null; created_at?: string;
        }
      >;
      tasks: Table<
        {
          id: string; user_id: string; project_id: string | null; team_id: string | null; title: string;
          status: "todo" | "doing" | "review" | "done"; priority: "low" | "med" | "high";
          due_date: string | null; estimate_minutes: number | null; completed_at: string | null; created_at: string;
        },
        {
          id?: string; user_id: string; project_id?: string | null; team_id?: string | null; title: string;
          status?: "todo" | "doing" | "review" | "done"; priority?: "low" | "med" | "high";
          due_date?: string | null; estimate_minutes?: number | null; completed_at?: string | null; created_at?: string;
        }
      >;
      tickets: Table<
        {
          id: string; user_id: string; project_id: string | null; zoho_id: string | null;
          title: string; body: string | null; priority: "low" | "med" | "high"; status: string;
          synced_at: string | null; ai_note: string | null; created_at: string;
        },
        {
          id?: string; user_id: string; project_id?: string | null; zoho_id?: string | null;
          title: string; body?: string | null; priority?: "low" | "med" | "high"; status?: string;
          synced_at?: string | null; ai_note?: string | null; created_at?: string;
        }
      >;
      events: Table<
        {
          id: string; user_id: string; project_id: string | null; title: string;
          starts_at: string; ends_at: string | null; kind: string | null; meeting_url: string | null; created_at: string;
        },
        {
          id?: string; user_id: string; project_id?: string | null; title: string;
          starts_at: string; ends_at?: string | null; kind?: string | null; meeting_url?: string | null; created_at?: string;
        }
      >;
      notifications: Table<
        { id: string; user_id: string; kind: string; title: string; body: string | null; link: string | null; read: boolean; created_at: string },
        { id?: string; user_id: string; kind?: string; title: string; body?: string | null; link?: string | null; read?: boolean; created_at?: string }
      >;
      time_entries: Table<
        { id: string; user_id: string; project_id: string | null; task_id: string | null; started_at: string; ended_at: string | null; seconds: number; created_at: string },
        { id?: string; user_id: string; project_id?: string | null; task_id?: string | null; started_at: string; ended_at?: string | null; seconds?: number; created_at?: string }
      >;
      integrations: Table<
        {
          user_id: string; zoho_client_id: string | null; zoho_client_secret: string | null; zoho_refresh_token: string | null;
          zoho_dc: string | null; zoho_team_id: string | null; zoho_project_id: string | null;
          gmail_user: string | null; gmail_app_password: string | null;
          anthropic_api_key: string | null; gemini_api_key: string | null; openai_api_key: string | null; grok_api_key: string | null;
          ai_provider: string | null; updated_at: string;
        },
        {
          user_id: string; zoho_client_id?: string | null; zoho_client_secret?: string | null; zoho_refresh_token?: string | null;
          zoho_dc?: string | null; zoho_team_id?: string | null; zoho_project_id?: string | null;
          gmail_user?: string | null; gmail_app_password?: string | null;
          anthropic_api_key?: string | null; gemini_api_key?: string | null; openai_api_key?: string | null; grok_api_key?: string | null;
          ai_provider?: string | null; updated_at?: string;
        }
      >;
      pg_servers: Table<
        {
          id: string; user_id: string; name: string; host: string; port: number; db_user: string;
          password: string | null; database: string | null; ssl: boolean; created_at: string; updated_at: string;
        },
        {
          id?: string; user_id: string; name: string; host: string; port?: number; db_user: string;
          password?: string | null; database?: string | null; ssl?: boolean; created_at?: string; updated_at?: string;
        }
      >;
      mail_templates: Table<
        { id: string; user_id: string; name: string; subject: string | null; body: string; created_at: string; updated_at: string },
        { id?: string; user_id: string; name: string; subject?: string | null; body?: string; created_at?: string; updated_at?: string }
      >;
      scheduled_emails: Table<
        {
          id: string; user_id: string; to_addr: string; cc: string | null; bcc: string | null;
          subject: string | null; body: string; html: string | null; in_reply_to: string | null; references: string | null;
          send_at: string; status: "pending" | "sent" | "failed" | "canceled"; error: string | null;
          created_at: string; sent_at: string | null;
        },
        {
          id?: string; user_id: string; to_addr: string; cc?: string | null; bcc?: string | null;
          subject?: string | null; body?: string; html?: string | null; in_reply_to?: string | null; references?: string | null;
          send_at: string; status?: "pending" | "sent" | "failed" | "canceled"; error?: string | null;
          created_at?: string; sent_at?: string | null;
        }
      >;
      mail_rules: Table<
        { id: string; user_id: string; field: "from" | "subject"; value: string; enabled: boolean; created_at: string },
        { id?: string; user_id: string; field: "from" | "subject"; value: string; enabled?: boolean; created_at?: string }
      >;
      automation_rules: Table<
        {
          id: string; user_id: string; name: string; enabled: boolean;
          trigger_type: string; trigger_config: Record<string, unknown>;
          action_type: string; action_config: Record<string, unknown>;
          run_count: number; last_run_at: string | null; created_at: string;
        },
        {
          id?: string; user_id: string; name: string; enabled?: boolean;
          trigger_type: string; trigger_config?: Record<string, unknown>;
          action_type: string; action_config?: Record<string, unknown>;
          run_count?: number; last_run_at?: string | null; created_at?: string;
        }
      >;
      provider_connections: Table<
        {
          id: string; user_id: string; provider: "github" | "gitlab" | "azuredevops" | "sentry" | "netlify" | "vercel" | "aws" | "msteams";
          status: "connected" | "disconnected" | "error";
          client_id: string | null; client_secret: string | null;
          access_token: string | null; refresh_token: string | null; expires_at: string | null; scope: string | null;
          external_account_id: string | null; external_account_name: string | null;
          config: Json; created_at: string; updated_at: string;
        },
        {
          id?: string; user_id: string; provider: "github" | "gitlab" | "azuredevops" | "sentry" | "netlify" | "vercel" | "aws" | "msteams";
          status?: "connected" | "disconnected" | "error";
          client_id?: string | null; client_secret?: string | null;
          access_token?: string | null; refresh_token?: string | null; expires_at?: string | null; scope?: string | null;
          external_account_id?: string | null; external_account_name?: string | null;
          config?: Json; created_at?: string; updated_at?: string;
        }
      >;
      user_settings: Table<
        { user_id: string; data: Json; updated_at: string },
        never // written only via the merge_user_settings RPC below
      >;
      break_logs: Table<
        {
          id: string; user_id: string; started_at: string; ended_at: string; seconds: number;
          beverage: string | null; rows: Json; summary: Json; created_at: string;
        },
        {
          id?: string; user_id: string; started_at: string; ended_at: string; seconds?: number;
          beverage?: string | null; rows?: Json; summary?: Json; created_at?: string;
        }
      >;
      audit_log: Table<
        {
          id: string; user_id: string; team_id: string | null; action: string; entity_type: string;
          entity_id: string | null; meta: Json; created_at: string;
        },
        {
          id?: string; user_id: string; team_id?: string | null; action: string; entity_type: string;
          entity_id?: string | null; meta?: Json; created_at?: string;
        },
        never // append-only — no update policy in schema.sql, rows are never edited after insert
      >;
      focus_events: Table<
        {
          id: string; user_id: string; project_id: string | null;
          type: "idle" | "resume" | "route_change"; route: string | null; at: string; created_at: string;
        },
        {
          id?: string; user_id: string; project_id?: string | null;
          type: "idle" | "resume" | "route_change"; route?: string | null; at?: string; created_at?: string;
        },
        never // append-only — no update policy in schema.sql, rows are never edited after insert
      >;
    };
    Views: Record<string, never>;
    Functions: {
      merge_user_settings: { Args: { p_patch: Json }; Returns: Json };
      orbit_hours: { Args: { p_day_start: string }; Returns: { today_seconds: number; total_seconds: number }[] };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
