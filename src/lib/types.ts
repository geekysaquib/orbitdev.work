export type ProjectStatus = "active" | "hold" | "archived" | "released";
export type TaskStatus = "todo" | "doing" | "review" | "done";
export type Priority = "low" | "med" | "high";

export interface Project {
  id: string; user_id: string; name: string; client: string | null;
  stacks: string[]; status: ProjectStatus; accent: string | null;
  fe_path: string | null; sln_path: string | null; dev_port: number | null;
  branch: string | null; description: string | null;
  sprint_project_id: string | null; sprint_project_name: string | null;
  created_at: string;
}
export interface Task {
  id: string; user_id: string; project_id: string | null; title: string;
  status: TaskStatus; priority: Priority; due_date: string | null; created_at: string;
}
export interface Ticket {
  id: string; user_id: string; project_id: string | null; zoho_id: string | null;
  title: string; body: string | null; priority: Priority; status: string;
  synced_at: string | null; created_at: string;
}
export interface CalEvent {
  id: string; user_id: string; project_id: string | null; title: string;
  starts_at: string; ends_at: string | null; kind: string | null;
}
export interface Notification {
  id: string; user_id: string; kind: string; title: string;
  body: string | null; read: boolean; created_at: string;
}
export interface Integration {
  id: string; user_id: string; provider: string; connected: boolean; config: Record<string, unknown>;
}
