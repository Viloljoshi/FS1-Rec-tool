import 'server-only';
import { supabaseServer } from '@/lib/supabase/server';
import type { AppRole, UserWithRole } from './roles';

export async function getCurrentUser(): Promise<UserWithRole | null> {
  const supabase = await supabaseServer();
  // `auth.getUser()` throws `AuthApiError: Invalid Refresh Token` when the
  // refresh token is stale. Middleware already clears the cookies; here
  // we just return null so Server Components render the unauthed path
  // instead of 500'ing.
  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    userId = data.user.id;
  } catch {
    return null;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, role, display_name')
    .eq('id', userId)
    .single();

  if (!profile) return null;
  return profile as UserWithRole;
}

export async function requireRole(...allowed: AppRole[]): Promise<UserWithRole> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('UNAUTHENTICATED');
  }
  if (!allowed.includes(user.role)) {
    throw new Error(`FORBIDDEN: need one of ${allowed.join(', ')}, have ${user.role}`);
  }
  return user;
}
