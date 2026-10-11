import { sb, toTag, type TagRow } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// All known tags, in registration order (the dashboard's chart colors follow it).
// `active: false` = retired: kept for history but not in the tray / inventory.
export async function GET() {
  const rows = await sb<TagRow[]>('or_tags?select=id,rfid_uid,name,active&order=id');
  return Response.json(rows.map(toTag));
}
