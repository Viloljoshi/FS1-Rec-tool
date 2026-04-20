'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { CommandPalette } from './CommandPalette';
import { LogOut, User, Activity, Command } from 'lucide-react';
import type { AppRole } from '@/lib/rbac/roles';
import { canRunEvals } from '@/lib/rbac/roles';
import { toast } from 'sonner';

interface TopBarProps {
  email: string;
  role: AppRole;
  displayName: string | null;
}

const ROLE_COLOR: Record<AppRole, string> = {
  analyst: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  manager: 'bg-violet-50 text-violet-700 border-violet-200',
  auditor: 'bg-slate-100 text-slate-700 border-slate-300'
};

export function TopBar({ email, role, displayName }: TopBarProps) {
  const router = useRouter();
  const [cmdOpen, setCmdOpen] = useState(false);

  const signOut = async () => {
    const sb = supabaseBrowser();
    await sb.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const runEvals = async () => {
    toast.promise(
      fetch('/api/eval/run', { method: 'POST' }).then((r) => {
        if (!r.ok) throw new Error('eval run failed');
        return r.json();
      }),
      {
        loading: 'Running evaluation against gold set...',
        success: (d) => `Evals complete — F1=${d.f1?.toFixed(3) ?? '—'}`,
        error: 'Eval run failed'
      }
    );
  };

  return (
    <>
      <header className="h-12 border-b border-slate-200 bg-white flex items-center px-4 gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="h-6 w-6 rounded bg-slate-900 grid place-items-center text-white font-mono text-[11px]">
            R
          </div>
          <span className="font-semibold text-sm text-slate-900">ReconAI</span>
        </Link>

        <div className="flex-1 flex justify-center">
          <button
            onClick={() => setCmdOpen(true)}
            className="flex items-center gap-2 text-xs text-slate-500 border border-slate-200 rounded-md bg-slate-50 hover:bg-slate-100 transition px-3 py-1.5 w-80"
          >
            <Command className="h-3 w-3" />
            <span className="flex-1 text-left">Search exceptions, navigate…</span>
            <span className="kbd">⌘K</span>
          </button>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {canRunEvals(role) && (
            <Button size="sm" variant="outline" onClick={runEvals}>
              <Activity className="h-3.5 w-3.5 mr-1.5" />
              Run Evals
            </Button>
          )}

          <Badge variant="outline" className={`${ROLE_COLOR[role]} text-[10px] uppercase tracking-wider font-mono`}>
            {role}
          </Badge>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <div className="h-7 w-7 rounded-full bg-slate-200 text-slate-700 grid place-items-center text-[11px] font-medium">
                  {(displayName ?? email)[0]?.toUpperCase() ?? '?'}
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="text-xs font-normal text-slate-500">Signed in as</div>
                <div className="text-sm font-medium">{email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User className="h-4 w-4 mr-2" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} role={role} />
    </>
  );
}
