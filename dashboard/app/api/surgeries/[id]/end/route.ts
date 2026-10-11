import type { NextRequest } from 'next/server';
import { sb, toSurgery, SURGERY_COLS, type SurgeryRow } from '@/lib/supabase';
import { isAdmin, unauthorized } from '@/lib/auth';

// End a surgery in progress.
export async function POST(req: NextRequest, ctx: RouteContext<'/api/surgeries/[id]/end'>) {
  if (!isAdmin(req)) return unauthorized();
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return Response.json({ error: 'not found' }, { status: 404 });
  const rows = await sb<SurgeryRow[]>(`or_surgeries?id=eq.${id}&ended_at=is.null&select=${SURGERY_COLS}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ended_at: new Date().toISOString() }),
  });
  if (!rows.length) return Response.json({ error: 'Surgery not found or already ended' }, { status: 404 });
  return Response.json(toSurgery(rows[0]));
}
