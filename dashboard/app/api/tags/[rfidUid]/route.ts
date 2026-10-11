import type { NextRequest } from 'next/server';
import { sb, toTag, type TagRow } from '@/lib/supabase';
import { isAdmin, unauthorized } from '@/lib/auth';

// Rename a tag (creates it if it doesn't exist yet). The dashboard is public,
// so renames need the admin passcode.
export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/tags/[rfidUid]'>) {
  if (!isAdmin(req)) return unauthorized();
  const { rfidUid } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 40) {
    return Response.json({ error: 'name is required (max 40 chars)' }, { status: 400 });
  }
  const [row] = await sb<TagRow[]>('or_tags?on_conflict=rfid_uid&select=id,rfid_uid,name,active', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ rfid_uid: rfidUid, name }),
  });
  return Response.json(toTag(row));
}
