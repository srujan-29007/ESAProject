import type { NextRequest } from 'next/server';
import { sb } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Scan count per tag, optionally only since a given time (?since=ISO date).
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('since');
  const since = raw ? new Date(raw) : null;
  if (since && isNaN(since.getTime())) return Response.json({ error: 'bad since' }, { status: 400 });
  const rows = await sb<{ rfid_uid: string; name: string; count: number }[]>('rpc/or_usage', {
    method: 'POST',
    body: JSON.stringify({ since: since?.toISOString() ?? null }),
  });
  return Response.json(rows.map((r) => ({ rfidUid: r.rfid_uid, name: r.name, count: Number(r.count) })));
}
