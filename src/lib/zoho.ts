/**
 * Zoho Sprints work items, fetched through a Netlify function so the client
 * secret / refresh token never touch the browser.
 * See netlify/functions/zoho-sprints.ts
 */
export interface ZohoItem {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  sprint?: string;
  modifiedTime?: string;
}

// Named fetchZohoTickets so the Tickets screen (which mirrors these into the
// Supabase `tickets` table) doesn't need to change — they're Sprints items now.
export async function fetchZohoTickets(): Promise<ZohoItem[]> {
  const r = await fetch("/.netlify/functions/zoho-sprints");
  if (!r.ok) throw new Error(`Zoho Sprints fetch failed (${r.status})`);
  const data = await r.json();
  return (data.data ?? []) as ZohoItem[];
}
