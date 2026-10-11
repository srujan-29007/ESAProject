import type { NextRequest } from 'next/server';
import { sb, toProcedure, PROCEDURE_COLS, type ProcedureRow } from '@/lib/supabase';
import { isAdmin, unauthorized } from '@/lib/auth';
import { parseProcedureInput } from '@/lib/procedures';

const validId = (id: string) => /^[a-z0-9-]{1,60}$/.test(id);

// Update a procedure, or archive/restore it with { active }. Surgeries keep the
// plan they were started with, so this never changes past reports.
export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/procedures/[id]'>) {
  if (!isAdmin(req)) return unauthorized();
  const { id } = await ctx.params;
  if (!validId(id)) return Response.json({ error: 'not found' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  let patch: Record<string, unknown>;
  if (typeof body.active === 'boolean' && Object.keys(body).length === 1) {
    patch = { active: body.active };
  } else {
    const input = parseProcedureInput(body);
    if (typeof input === 'string') return Response.json({ error: input }, { status: 400 });
    patch = { name: input.name, summary: input.summary, est_minutes: input.estMinutes, alert_minutes: input.alertMinutes, steps: input.steps };
  }
  const rows = await sb<ProcedureRow[]>(`or_procedures?id=eq.${id}&select=${PROCEDURE_COLS}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!rows.length) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(toProcedure(rows[0]));
}
