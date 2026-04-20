'use client';

import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { BandChip } from '@/components/shared/BandChip';
import { MoneyCell, QtyCell } from '@/components/shared/Cells';

export interface QueueRow {
  id: string;
  cycle_id: string;
  band: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNMATCHED';
  exception_class: string;
  symbol: string;
  counterparty: string;
  direction: 'BUY' | 'SELL';
  quantity: number;
  amount: number;
  posterior?: number;
  opened_at: string;
  cycle_label: string;
}

interface Props {
  rows: QueueRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function QueueTable({ rows, selectedId, onSelect }: Props) {
  return (
    <div className="h-full overflow-auto">
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => {
          const active = r.id === selectedId;
          return (
            <li
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={cn(
                'cursor-pointer px-3 py-2 text-xs',
                active ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn('font-mono font-semibold', active ? 'text-white' : 'text-slate-900')}>{r.symbol}</span>
                  <span className={cn('font-mono', active ? 'text-slate-300' : 'text-slate-500')}>{r.direction}</span>
                </div>
                {r.band === 'UNMATCHED' ? (
                  <span className={cn('inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                    active ? 'border-slate-600 text-slate-200' : 'border-slate-300 text-slate-600'
                  )}>
                    unmatched
                  </span>
                ) : (
                  <BandChip band={r.band as 'HIGH' | 'MEDIUM' | 'LOW'} posterior={r.posterior} />
                )}
              </div>
              <div className={cn('mt-1 flex items-center justify-between gap-2', active ? 'text-slate-300' : 'text-slate-600')}>
                <span className="truncate font-mono max-w-[60%]">{r.counterparty}</span>
                <span className="font-mono tabular-nums">
                  <QtyCell value={r.quantity} className={active ? 'text-slate-200' : ''} />
                </span>
              </div>
              <div className={cn('mt-0.5 flex items-center justify-between gap-2', active ? 'text-slate-400' : 'text-slate-500')}>
                <span className="text-[10px] font-mono uppercase">{r.exception_class.replace(/_/g, ' ')}</span>
                <span className="text-[10px] font-mono">
                  {formatDistanceToNow(new Date(r.opened_at), { addSuffix: false })}
                </span>
              </div>
              <div className={cn('mt-0.5 flex items-center justify-between gap-2 text-[10px] font-mono', active ? 'text-slate-500' : 'text-slate-400')}>
                <span>{r.cycle_label}</span>
                <MoneyCell value={r.amount} className={active ? 'text-slate-300' : 'text-slate-500'} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
