// Server-only Supabase REST helper. Uses the secret service key, so never
// import this from a client component.
import 'server-only';
import type { Procedure, Step } from './procedures';
import type { Surgery, SurgeryScan } from './surgery';

const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function sb<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  if (!BASE || !KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  // `Prefer: return=minimal` writes come back with an empty body.
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export type TagRow = { id: number; rfid_uid: string; name: string; active?: boolean };
export const toTag = (t: TagRow) => ({ id: t.id, rfidUid: t.rfid_uid, name: t.name, active: t.active !== false });

export type SurgeryRow = {
  id: number; procedure_id: string; surgeon: string; started_at: string; ended_at: string | null;
  procedure_name: string | null; plan: Step[] | null; est_minutes: number | null; alert_minutes: number | null;
};
export const SURGERY_COLS = 'id,procedure_id,surgeon,started_at,ended_at,procedure_name,plan,est_minutes,alert_minutes';
export const toSurgery = (r: SurgeryRow): Surgery => ({
  id: r.id,
  procedureId: r.procedure_id,
  procedureName: r.procedure_name ?? r.procedure_id,
  surgeon: r.surgeon,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  plan: r.plan ?? [],
  estMinutes: r.est_minutes ?? 0,
  alertMinutes: r.alert_minutes ?? 10,
});

export type ProcedureRow = { id: string; name: string; summary: string; est_minutes: number; alert_minutes: number; steps: Step[]; sort: number; active: boolean };
export const PROCEDURE_COLS = 'id,name,summary,est_minutes,alert_minutes,steps,sort,active';
export const toProcedure = (r: ProcedureRow): Procedure => ({
  id: r.id, name: r.name, summary: r.summary, estMinutes: r.est_minutes, alertMinutes: r.alert_minutes, steps: r.steps, sort: r.sort, active: r.active,
});

type ScanJoinRow = { id: number; created_at: string; source: string; or_tags: { rfid_uid: string; name: string } };
const toSurgeryScan = (r: ScanJoinRow): SurgeryScan => ({ scanId: r.id, time: r.created_at, rfidUid: r.or_tags.rfid_uid, name: r.or_tags.name, manual: r.source === 'manual' });

// Scans (time + tag) between two instants, oldest first.
export async function scansBetween(from: string, to: string): Promise<SurgeryScan[]> {
  const rows = await sb<ScanJoinRow[]>(
    `or_scans?select=id,created_at,source,or_tags(rfid_uid,name)&and=(created_at.gte.${new Date(from).toISOString()},created_at.lte.${new Date(to).toISOString()})&order=created_at&limit=10000`,
  );
  return rows.map(toSurgeryScan);
}
