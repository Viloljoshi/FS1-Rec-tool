'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';

const LABEL_MAP: Record<string, string> = {
  reconcile: 'Reconcile',
  workspace: 'Exception Management',
  matching: 'Matching Cycles',
  onboarding: 'Feed Onboarding',
  pipeline: 'Pipeline',
  'reference-data': 'Reference Data',
  governance: 'Governance',
  dashboard: 'Dashboard',
  audit: 'Audit',
  cash: 'Cash',
  evals: 'Evals'
};

function labelFor(segment: string): string {
  return LABEL_MAP[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function Breadcrumbs(): React.ReactElement | null {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  if (segments[0] === 'login') return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="h-9 px-5 border-b border-slate-200 bg-slate-50/40 flex items-center gap-1 text-[11px] text-slate-500"
    >
      <Link href="/" className="flex items-center gap-1 hover:text-slate-900 transition">
        <Home className="h-3 w-3" />
      </Link>
      {segments.map((seg, i) => {
        const href = '/' + segments.slice(0, i + 1).join('/');
        const last = i === segments.length - 1;
        return (
          <span key={href} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-slate-300" />
            {last ? (
              <span className="text-slate-900 font-medium">{labelFor(seg)}</span>
            ) : (
              <Link href={href} className="hover:text-slate-900 transition">
                {labelFor(seg)}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
