import type { NextRequest } from 'next/server';
import { sb, type TagRow } from '@/lib/supabase';

// The ESP32 POSTs every scan here (authenticated with a device key). The JSON
// it gets back is exactly what it then publishes over MQTT to live dashboards.
export async function POST(req: NextRequest) {
  if (!process.env.OR_DEVICE_KEY || req.headers.get('x-device-key') !== process.env.OR_DEVICE_KEY) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const rfidUid = typeof body.rfidUid === 'string' ? body.rfidUid.toUpperCase() : '';
  if (!/^[0-9A-F]{4,20}$/.test(rfidUid)) return Response.json({ error: 'bad rfidUid' }, { status: 400 });

  // Scans queued on the ESP32 while it was offline carry how long ago they
  // happened, so they're stored at their real time rather than arrival time.
  const ageMs = Number(body.ageMs) || 0;
  const delayed = ageMs > 3000 && ageMs < 7 * 24 * 3600 * 1000;
  const scannedAt = new Date(Date.now() - (delayed ? ageMs : 0));

  // Auto-register unknown tags so every tap shows up even before it's named.
  await sb('or_tags?on_conflict=rfid_uid', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ rfid_uid: rfidUid, name: `Tag ${rfidUid}` }),
  });
  const [tag] = await sb<TagRow[]>(`or_tags?rfid_uid=eq.${rfidUid}&select=id,rfid_uid,name`);
  const [scan] = await sb<{ id: number; created_at: string }[]>('or_scans?select=id,created_at', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ tag_id: tag.id, created_at: scannedAt.toISOString() }),
  });

  return Response.json({ scanId: scan.id, rfidUid, name: tag.name, time: scan.created_at, delayed });
}
