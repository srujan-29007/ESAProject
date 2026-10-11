import type { NextRequest } from 'next/server';
import { sb, toSurgery, scansBetween, SURGERY_COLS, type SurgeryRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// One surgery and every scan made during it.
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/surgeries/[id]'>) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return Response.json({ error: 'not found' }, { status: 404 });
  const [row] = await sb<SurgeryRow[]>(`or_surgeries?select=${SURGERY_COLS}&id=eq.${id}`);
  if (!row) return Response.json({ error: 'not found' }, { status: 404 });
  const surgery = toSurgery(row);
  return Response.json({ surgery, scans: await scansBetween(surgery.startedAt, surgery.endedAt ?? new Date().toISOString()) });
}
