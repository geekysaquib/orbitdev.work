export type ProjectStatus = "active" | "hold" | "archived";
export type TaskStatus = "todo" | "doing" | "review" | "done";
export type Priority = "low" | "med" | "high";
export type TeamRole = "owner" | "admin" | "member" | "viewer";

export interface Project {
  id: string; user_id: string; team_id: string | null; name: string; client: string | null;
  stacks: string[]; status: ProjectStatus; accent: string | null;
  fe_path: string | null; sln_path: string | null; dev_port: number | null;
  branch: string | null; description: string | null;
  sprint_project_id: string | null; sprint_project_name: string | null;
  repo_provider: "github" | "gitlab" | "azuredevops" | null; repo_full_name: string | null;
  repo_id: string | null; repo_default_branch: string | null;
  created_at: string;
}
export interface Task {
  id: string; user_id: string; project_id: string | null; team_id: string | null; title: string;
  status: TaskStatus; priority: Priority; due_date: string | null; created_at: string;
}
export interface Team {
  id: string; name: string; owner_id: string; created_at: string;
}
export interface TeamMember {
  team_id: string; user_id: string; role: TeamRole; joined_at: string;
  // joined client-side from `users` via the "teammates are visible" policy
  full_name?: string; email?: string;
}
export interface TeamInvite {
  id: string; team_id: string; email: string; role: Exclude<TeamRole, "owner">;
  invited_by: string; status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string; accepted_at: string | null; created_at: string;
}
export interface TeamActivity {
  id: string; user_id: string; team_id: string | null; action: string; entity_type: string;
  entity_id: string | null; meta: Record<string, unknown>; created_at: string;
  full_name?: string; email?: string;
}
export interface Ticket {
  id: string; user_id: string; project_id: string | null; zoho_id: string | null;
  title: string; body: string | null; priority: Priority; status: string;
  synced_at: string | null; ai_note: string | null; created_at: string;
}
export interface CalEvent {
  id: string; user_id: string; project_id: string | null; title: string;
  starts_at: string; ends_at: string | null; kind: string | null; meeting_url: string | null;
}
export interface Notification {
  id: string; user_id: string; kind: string; title: string;
  body: string | null; link: string | null; read: boolean; created_at: string;
}
export type ProviderId = "github" | "gitlab" | "azuredevops" | "sentry" | "netlify" | "vercel" | "aws" | "msteams";
export interface ProviderConnection {
  id: string; user_id: string; provider: ProviderId; status: "connected" | "disconnected" | "error";
  client_id: string | null; client_secret: string | null;
  access_token: string | null; refresh_token: string | null; expires_at: string | null; scope: string | null;
  external_account_id: string | null; external_account_name: string | null;
  config: Record<string, unknown>; created_at: string; updated_at: string;
}
