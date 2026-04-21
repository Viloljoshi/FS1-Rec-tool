'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { AppRole } from '@/lib/rbac/roles';
import {
  LayoutDashboard,
  Upload,
  Play,
  ListChecks,
  Network,
  ShieldCheck,
  Map,
  ArrowLeftRight,
  Workflow,
  ShieldCheck as ShieldCheckIcon
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: AppRole[];
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    title: 'Operate',
    items: [
      { href: '/reconcile',      label: 'Reconcile (2-party)', icon: ArrowLeftRight,  roles: ['analyst', 'manager'] },
      { href: '/workspace',      label: 'Exception Mgmt',      icon: ListChecks,      roles: ['analyst', 'manager', 'auditor'] },
      { href: '/matching',       label: 'Matching Cycles',     icon: Play,            roles: ['analyst', 'manager', 'auditor'] },
      { href: '/onboarding',     label: 'Feed Onboarding',     icon: Upload,          roles: ['analyst', 'manager'] }
    ]
  },
  {
    title: 'Configure',
    items: [
      { href: '/pipeline',       label: 'Pipeline',            icon: Workflow,        roles: ['analyst', 'manager', 'auditor'] },
      { href: '/reference-data', label: 'Reference Data',      icon: Network,         roles: ['analyst', 'manager', 'auditor'] },
      { href: '/governance',     label: 'Governance',          icon: ShieldCheckIcon, roles: ['analyst', 'manager', 'auditor'] }
    ]
  },
  {
    title: 'Monitor',
    items: [
      { href: '/dashboard',      label: 'Dashboard',           icon: LayoutDashboard, roles: ['manager', 'auditor'] },
      { href: '/audit',          label: 'Audit',               icon: ShieldCheck,     roles: ['analyst', 'manager', 'auditor'] }
    ]
  },
  {
    title: 'Roadmap',
    items: [
      { href: '/roadmap',        label: 'Product Roadmap',     icon: Map,             roles: ['analyst', 'manager', 'auditor'] }
    ]
  }
];

export function Sidebar({ role }: { role: AppRole }) {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-slate-200 bg-white flex flex-col">
      <nav className="flex-1 overflow-y-auto p-2 space-y-3">
        {SECTIONS.map((section) => {
          const visible = section.items.filter((i) => i.roles.includes(role));
          if (visible.length === 0) return null;
          return (
            <div key={section.title}>
              <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-slate-400 font-mono">
                {section.title}
              </div>
              <div className="space-y-0.5">
                {visible.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + '/');
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2 rounded px-2.5 py-1.5 text-sm transition',
                        active
                          ? 'bg-slate-900 text-white font-medium'
                          : 'text-slate-700 hover:bg-slate-100'
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-slate-200 p-3 shrink-0">
        <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Shortcuts</div>
        <div className="mt-1.5 text-[11px] text-slate-500 space-y-0.5">
          <div><span className="kbd">⌘K</span> commands</div>
          <div><span className="kbd">A</span> / <span className="kbd">R</span> / <span className="kbd">E</span> accept / reject / escalate</div>
          <div><span className="kbd">J</span> / <span className="kbd">K</span> next / prev</div>
        </div>
      </div>
    </aside>
  );
}
