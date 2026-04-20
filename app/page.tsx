import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/rbac/server';
import { landingPath } from '@/lib/rbac/roles';

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  redirect(landingPath(user.role));
}
