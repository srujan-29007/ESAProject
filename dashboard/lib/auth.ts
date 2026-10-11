// The dashboard is public; changes (renames, starting/ending surgeries) need
// the admin passcode in an `x-admin-passcode` header.
export const isAdmin = (req: Request) =>
  !!process.env.OR_ADMIN_PASSCODE && req.headers.get('x-admin-passcode') === process.env.OR_ADMIN_PASSCODE;

export const unauthorized = () => Response.json({ error: 'Wrong passcode' }, { status: 401 });
