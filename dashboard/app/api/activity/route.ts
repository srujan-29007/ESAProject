import type { NextRequest } from 'next/server';
import { sb } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type Row = { created_at: string; or_tags: { rfid_uid: string } };

// Every scan since ?since= (time + tag), for the hourly activity chart. The
// client buckets them into hours in its own timezone.
export async function GET(req: NextRequest) {
  const since = new Date(req.nextUrl.searchParams.get('since') ?? '');
  if (isNaN(since.getTime())) return Response.json({ error: 'since is required' }, { status: 400 });
  const rows = await sb<Row[]>(
    `or_scans?select=created_at,or_tags(rfid_uid)&created_at=gte.${since.toISOString()}&order=created_at&limit=5000`,
  );
  return Response.json(rows.map((r) => ({ time: r.created_at, rfidUid: r.or_tags.rfid_uid })));
}
