import { sb } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type Row = { id: number; created_at: string; source: string; or_tags: { rfid_uid: string; name: string } };

// Recent scan history.
export async function GET() {
  const rows = await sb<Row[]>('or_scans?select=id,created_at,source,or_tags(rfid_uid,name)&order=created_at.desc&limit=50');
  return Response.json(rows.map((r) => ({
    scanId: r.id,
    rfidUid: r.or_tags.rfid_uid,
    name: r.or_tags.name,
    time: r.created_at,
    ...(r.source === 'manual' ? { manual: true } : {}),
  })));
}
