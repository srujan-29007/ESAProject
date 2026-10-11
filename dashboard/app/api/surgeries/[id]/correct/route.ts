import type { NextRequest } from 'next/server';
import { sb, SURGERY_COLS, type SurgeryRow, type TagRow } from '@/lib/supabase';
import { isAdmin, unauthorized } from '@/lib/auth';

// Fix a missed or extra tap during a surgery: records one manual tap for the
// instrument now, flipping it between "taken" and "returned". The response has
// the same shape as a reader scan so it can be broadcast to live dashboards.
export async function POST(req: NextRequest, ctx: RouteContext<'/api/surgeries/[id]/correct'>) {
  if (!isAdmin(req)) return unauthorized();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const rfidUid = typeof body.rfidUid === 'string' ? body.rfidUid.toUpperCase() : '';
  if (!/^\d+$/.test(id) || !/^[0-9A-F]{4,20}$/.test(rfidUid)) return Response.json({ error: 'bad request' }, { status: 400 });

  const [surgery] = await sb<SurgeryRow[]>(`or_surgeries?select=${SURGERY_COLS}&id=eq.${id}&ended_at=is.null`);
  if (!surgery) return Response.json({ error: 'This surgery is not in progress' }, { status: 409 });
  const [tag] = await sb<TagRow[]>(`or_tags?rfid_uid=eq.${rfidUid}&select=id,rfid_uid,name`);
  if (!tag) return Response.json({ error: 'Unknown instrument' }, { status: 404 });

  const [scan] = await sb<{ id: number; created_at: string }[]>('or_scans?select=id,created_at', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ tag_id: tag.id, source: 'manual' }),
  });
  return Response.json({ scanId: scan.id, rfidUid, name: tag.name, time: scan.created_at, delayed: false, manual: true });
}
