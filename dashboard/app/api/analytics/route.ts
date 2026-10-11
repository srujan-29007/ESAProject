import { sb, toSurgery, scansBetween, SURGERY_COLS, type SurgeryRow } from '@/lib/supabase';
import { analyze } from '@/lib/surgery';
import { kindOf } from '@/lib/instruments';

export const dynamic = 'force-dynamic';

// Per-surgery efficiency metrics for every completed surgery (for comparing surgeons).
export async function GET() {
  const rows = await sb<SurgeryRow[]>(`or_surgeries?select=${SURGERY_COLS}&ended_at=not.is.null&order=started_at.desc&limit=300`);
  if (!rows.length) return Response.json([]);
  const surgeries = rows.map(toSurgery);
  // One scan query covering every surgery, split up in memory.
  const from = surgeries.reduce((m, s) => (s.startedAt < m ? s.startedAt : m), surgeries[0].startedAt);
  const to = surgeries.reduce((m, s) => (s.endedAt! > m ? s.endedAt! : m), surgeries[0].endedAt!);
  const scans = await scansBetween(from, to);

  return Response.json(surgeries.map((s) => {
    const start = new Date(s.startedAt).getTime(), end = new Date(s.endedAt!).getTime();
    const a = analyze(scans.filter((x) => { const t = new Date(x.time).getTime(); return t >= start && t <= end; }), s.plan, start, end);
    return {
      id: s.id,
      procedureId: s.procedureId,
      procedureName: s.procedureName,
      surgeon: s.surgeon,
      startedAt: s.startedAt,
      estMinutes: s.estMinutes,
      durationMs: a.durationMs,
      cycles: a.cycles.length,
      stepsDone: a.stepsDone,
      stepsTotal: s.plan.length,
      inOrder: a.inOrder,
      idleMs: a.idleMs,
      busyMs: a.busyMs,
      stillOut: a.stillOut.length,
      corrections: a.corrections,
      tools: a.tools.map((t) => ({ name: t.name, kind: kindOf(t.name), cycles: t.cycles, outMs: t.outMs })),
    };
  }));
}
