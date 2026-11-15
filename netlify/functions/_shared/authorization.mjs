import { getPublicClient, getServiceClient } from './supabase.mjs';
import { HttpError, unwrap } from './http.mjs';

const roleRank = { viewer: 1, editor: 2, admin: 3 };

export function bearerToken(event) {
  const value = event.headers?.authorization || event.headers?.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1] || null;
}

export async function currentUser(event, required = false, minimumRole = 'viewer') {
  const token = bearerToken(event);
  if (!token) {
    if (required) throw new HttpError(401, 'Administrator sign-in is required.');
    return null;
  }

  const { data: authData, error: authError } = await getPublicClient().auth.getUser(token);
  if (authError || !authData.user) {
    if (required) throw new HttpError(401, 'Your sign-in has expired. Sign in again.');
    return null;
  }

  const profile = unwrap(await getServiceClient()
    .from('admin_users')
    .select('id,auth_user_id,full_name,username,email,role,active,created_at')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle());

  if (!profile || !profile.active) {
    throw new HttpError(403, 'This administrator account is awaiting approval or has been disabled.');
  }
  if ((roleRank[profile.role] || 0) < (roleRank[minimumRole] || 2)) {
    throw new HttpError(403, 'This administrator role cannot perform that operation.');
  }

  return {
    id: profile.id,
    auth_id: profile.auth_user_id,
    full_name: profile.full_name,
    username: profile.username,
    email: profile.email || authData.user.email,
    role: profile.role,
    active: profile.active,
    created_at: profile.created_at
  };
}
