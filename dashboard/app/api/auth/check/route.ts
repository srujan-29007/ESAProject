import { isAdmin, unauthorized } from '@/lib/auth';

// Lets the dashboard check an admin passcode before saving it.
export async function POST(req: Request) {
  return isAdmin(req) ? Response.json({ ok: true }) : unauthorized();
}
