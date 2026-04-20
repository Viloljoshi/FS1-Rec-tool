export type AppRole = 'analyst' | 'manager' | 'auditor';

export const ROLES: readonly AppRole[] = ['analyst', 'manager', 'auditor'] as const;

export interface UserWithRole {
  id: string;
  email: string;
  role: AppRole;
  display_name: string | null;
}

export function canViewDashboard(role: AppRole): boolean {
  return role === 'manager' || role === 'auditor';
}

export function canRunEvals(role: AppRole): boolean {
  return role === 'manager' || role === 'auditor';
}

export function canMutateExceptions(role: AppRole): boolean {
  return role === 'analyst' || role === 'manager';
}

export function landingPath(role: AppRole): string {
  if (role === 'manager') return '/dashboard';
  if (role === 'auditor') return '/audit';
  return '/workspace';
}
