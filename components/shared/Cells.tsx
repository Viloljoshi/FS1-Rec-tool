'use client';

import { cn } from '@/lib/utils';
import { formatDistanceToNow, format } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';

export function MoneyCell({ value, currency = 'USD', className }: { value: string | number; currency?: string; className?: string }) {
  const n = typeof value === 'string' ? Number(value) : value;
  return (
    <span
      className={cn('font-mono tabular-nums text-sm', className)}
      data-numeric
    >
      {new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n)}
    </span>
  );
}

export function QtyCell({ value, className }: { value: string | number; className?: string }) {
  const n = typeof value === 'string' ? Number(value) : value;
  return (
    <span className={cn('font-mono tabular-nums text-sm', className)} data-numeric>
      {new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n)}
    </span>
  );
}

export function AgeCell({ since }: { since: string | Date }) {
  const d = typeof since === 'string' ? new Date(since) : since;
  const rel = formatDistanceToNow(d, { addSuffix: true });
  const abs = format(d, 'yyyy-MM-dd HH:mm');
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs text-slate-600 font-mono">{rel}</span>
        </TooltipTrigger>
        <TooltipContent className="text-xs font-mono">{abs}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function CopyableId({ value, short = 8 }: { value: string; short?: number }) {
  const display = value.length > short ? `${value.slice(0, short)}…` : value;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value);
        toast.success('Copied', { description: value });
      }}
      className="inline-flex items-center gap-1 font-mono text-xs text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded px-1 py-0.5 transition"
    >
      {display}
      <Copy className="h-3 w-3 opacity-40" />
    </button>
  );
}
