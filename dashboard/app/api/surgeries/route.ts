import { sb, toSurgery, toProcedure, scansBetween, SURGERY_COLS, PROCEDURE_COLS, type SurgeryRow, type ProcedureRow } from '@/lib/supabase';
import { isAdmin, unauthorized } from '@/lib/auth';
import { analyze } from '@/lib/surgery';

export const dynamic = 'force-dynamic';

// Recent surgeries with a summary of each (for the records list).
export async function GET() {
  const rows = await sb<SurgeryRow[]>(`or_surgeries?select=${SURGERY_COLS}&order=started_at.desc&limit=10`);
  const out = await Promise.all(rows.map(async (r) => {
    const s = toSurgery(r);
    const end = s.endedAt ?? new Date().toISOString();
    const a = analyze(await scansBetween(s.startedAt, end), s.plan, new Date(s.startedAt).getTime(), new Date(end).getTime());
    return { ...s, durationMs: a.durationMs, cycles: a.cycles.length, stepsDone: a.stepsDone, stepsTotal: s.plan.length, stillOut: a.stillOut.length };
  }));
  return Response.json(out);
}

// Start a surgery. Only one can run at a time. The procedure's current plan is
// copied onto the surgery so later edits to the procedure don't change it.
export async function POST(req: Request) {
  if (!isAdmin(req)) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const surgeon = typeof body.surgeon === 'string' ? body.surgeon.trim() : '';
  const procId = String(body.procedureId ?? '');
  const [procRow] = /^[a-z0-9-]{1,60}$/.test(procId)
    ? await sb<ProcedureRow[]>(`or_procedures?select=${PROCEDURE_COLS}&id=eq.${procId}&active=is.true`)
    : [];
  if (!procRow) return Response.json({ error: 'Choose a procedure' }, { status: 400 });
  if (!surgeon || surgeon.length > 60) return Response.json({ error: "Enter the surgeon's name" }, { status: 400 });
  const proc = toProcedure(procRow);

  const active = await sb<SurgeryRow[]>(`or_surgeries?select=id&ended_at=is.null`);
  if (active.length) return Response.json({ error: 'A surgery is already in progress' }, { status: 409 });

  const [row] = await sb<SurgeryRow[]>(`or_surgeries?select=${SURGERY_COLS}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ procedure_id: proc.id, surgeon, procedure_name: proc.name, plan: proc.steps, est_minutes: proc.estMinutes, alert_minutes: proc.alertMinutes }),
  });
  return Response.json(toSurgery(row));
}
