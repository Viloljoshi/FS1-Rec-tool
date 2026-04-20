import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/rbac/server';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Breadcrumbs } from './Breadcrumbs';

interface AppShellProps {
  children: React.ReactNode;
}

export async function AppShell({ children }: AppShellProps) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      <TopBar email={user.email} role={user.role} displayName={user.display_name} />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar role={user.role} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Breadcrumbs />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </div>
  );
}
