'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { AiAssistedBadge } from '@/components/shared/AiAssistedBadge';
import {
  LayoutDashboard,
  Upload,
  Play,
  ListChecks,
  Network,
  ShieldCheck,
  Activity,
  ArrowLeftRight,
  Sparkles,
  Loader2
} from 'lucide-react';
import type { AppRole } from '@/lib/rbac/roles';
import { useHotkeys } from 'react-hotkeys-hook';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  role: AppRole;
}

export function CommandPalette({ open, onOpenChange, role }: Props): React.ReactElement {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  useHotkeys('meta+k, ctrl+k', (e) => {
    e.preventDefault();
    onOpenChange(!open);
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) setInput('');
  }, [open]);

  const go = (path: string) => {
    router.push(path);
    onOpenChange(false);
  };

  const runAiSearch = async () => {
    const q = input.trim();
    if (!q || q.length < 3) {
      toast.error('Enter a search query (min 3 chars)');
      return;
    }
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'search failed');
      const data = await res.json();
      const sp = new URLSearchParams();
      const f = data.filters ?? {};
      if (f.band) sp.set('band', f.band);
      if (f.exception_class) sp.set('class', f.exception_class);
      if (f.counterparty_contains) sp.set('cpy', f.counterparty_contains);
      if (f.symbol) sp.set('symbol', f.symbol);
      if (f.amount_min != null) sp.set('min', String(f.amount_min));
      if (f.amount_max != null) sp.set('max', String(f.amount_max));
      if (f.age_days_min != null) sp.set('age_min', String(f.age_days_min));
      if (f.age_days_max != null) sp.set('age_max', String(f.age_days_max));
      if (f.status) sp.set('status', f.status);
      if (f.sort) sp.set('sort', f.sort);
      sp.set('q', q);
      toast.success(data.explanation ?? 'Filters applied');
      router.push(`/workspace?${sp.toString()}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setAiLoading(false);
    }
  };

  const isNlQuery = input.trim().length >= 6 && /\s/.test(input);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search · navigate · or ask in plain English ( e.g. 'wrong qty JPM over 1M this week' )"
        value={input}
        onValueChange={setInput}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && isNlQuery) {
            e.preventDefault();
            void runAiSearch();
          }
        }}
      />
      <CommandList>
        {isNlQuery && (
          <CommandGroup heading="Ask in plain English">
            <CommandItem onSelect={runAiSearch} className="flex items-center gap-2">
              {aiLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin text-violet-600" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2 text-violet-600" />
              )}
              <span className="flex-1 truncate">
                Parse &ldquo;<span className="font-mono">{input}</span>&rdquo; and open matching exceptions
              </span>
              <AiAssistedBadge />
              <Badge variant="outline" className="text-[9px]">↵ enter</Badge>
            </CommandItem>
          </CommandGroup>
        )}
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {(role === 'analyst' || role === 'manager') && (
            <CommandItem onSelect={() => go('/reconcile')}>
              <ArrowLeftRight className="h-4 w-4 mr-2" />
              Run 2-Party Reconciliation
            </CommandItem>
          )}
          <CommandItem onSelect={() => go('/workspace')}>
            <ListChecks className="h-4 w-4 mr-2" />
            Exception Management
          </CommandItem>
          <CommandItem onSelect={() => go('/matching')}>
            <Play className="h-4 w-4 mr-2" />
            Matching Cycles
          </CommandItem>
          {(role === 'analyst' || role === 'manager') && (
            <CommandItem onSelect={() => go('/onboarding')}>
              <Upload className="h-4 w-4 mr-2" />
              Feed Onboarding
            </CommandItem>
          )}
          <CommandItem onSelect={() => go('/reference-data')}>
            <Network className="h-4 w-4 mr-2" />
            Reference Data (Entity Graph)
          </CommandItem>
          <CommandItem onSelect={() => go('/pipeline')}>
            <Play className="h-4 w-4 mr-2" />
            Pipeline
          </CommandItem>
          <CommandItem onSelect={() => go('/governance')}>
            <ShieldCheck className="h-4 w-4 mr-2" />
            Governance
          </CommandItem>
          {(role === 'manager' || role === 'auditor') && (
            <CommandItem onSelect={() => go('/dashboard')}>
              <LayoutDashboard className="h-4 w-4 mr-2" />
              Dashboard
            </CommandItem>
          )}
          <CommandItem onSelect={() => go('/audit')}>
            <ShieldCheck className="h-4 w-4 mr-2" />
            Audit Log
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        {(role === 'manager' || role === 'auditor') && (
          <CommandGroup heading="Actions">
            <CommandItem
              onSelect={() => {
                fetch('/api/eval/run', { method: 'POST' });
                onOpenChange(false);
              }}
            >
              <Activity className="h-4 w-4 mr-2" />
              Run Evaluation
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
