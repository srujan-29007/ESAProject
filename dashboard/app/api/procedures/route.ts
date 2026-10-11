import { sb, toProcedure, PROCEDURE_COLS, type ProcedureRow } from '@/lib/supabase';
import { isAdmin, unauthorized } from '@/lib/auth';
import { parseProcedureInput } from '@/lib/procedures';

export const dynamic = 'force-dynamic';

// Procedures in display order. ?all=1 includes archived ones.
export async function GET(req: Request) {
  const all = new URL(req.url).searchParams.get('all') === '1';
  const rows = await sb<ProcedureRow[]>(`or_procedures?select=${PROCEDURE_COLS}${all ? '' : '&active=is.true'}&order=sort,created_at`);
  return Response.json(rows.map(toProcedure));
}

// Create a procedure.
export async function POST(req: Request) {
  if (!isAdmin(req)) return unauthorized();
  const input = parseProcedureInput(await req.json().catch(() => ({})));
  if (typeof input === 'string') return Response.json({ error: input }, { status: 400 });
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'procedure';
  const id = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const [last] = await sb<{ sort: number }[]>('or_procedures?select=sort&order=sort.desc&limit=1');
  const [row] = await sb<ProcedureRow[]>(`or_procedures?select=${PROCEDURE_COLS}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ id, name: input.name, summary: input.summary, est_minutes: input.estMinutes, alert_minutes: input.alertMinutes, steps: input.steps, sort: (last?.sort ?? 0) + 1 }),
  });
  return Response.json(toProcedure(row));
}
