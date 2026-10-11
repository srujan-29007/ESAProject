import { sb, toSurgery, scansBetween, SURGERY_COLS, type SurgeryRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// The surgery in progress (with its scans so far), or null.
export async function GET() {
  const [row] = await sb<SurgeryRow[]>(`or_surgeries?select=${SURGERY_COLS}&ended_at=is.null&limit=1`);
  if (!row) return Response.json(null);
  const surgery = toSurgery(row);
  return Response.json({ surgery, scans: await scansBetween(surgery.startedAt, new Date().toISOString()) });
}
