'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AiAssistedBadge } from '@/components/shared/AiAssistedBadge';
import { Sparkles, X, Download } from 'lucide-react';
import { differenceInDays } from 'date-fns';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useHotkeys } from 'react-hotkeys-hook';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { ComparePane } from '@/components/workspace/ComparePane';
import { ActionPanel } from '@/components/workspace/ActionPanel';
import { QueueTable, type QueueRow } from '@/components/workspace/QueueTable';
import type { TradeRow } from './page';
import { AlertCircle, Inbox } from 'lucide-react';

export interface Exception {
  id: string;
  cycle_id: string;
  band: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  status: string;
  exception_class: string;
  assignee: string | null;
  explanation_cached: string | null;
  opened_at: string;
  updated_at: string;
  match_result: {
    id: string;
    posterior: number;
    band: 'HIGH' | 'MEDIUM' | 'LOW';
    field_scores: Array<{ field: string; raw_score: number; weight: number; contribution: number }>;
    deterministic_hit: boolean;
    llm_verdict: { verdict: string; confidence: number; reasoning: string; decisive_fields: string[] } | null;
  } | null;
  trade_a: TradeRow | null;
  trade_b: TradeRow | null;
}

type StatusFilter = 'OPEN' | 'ESCALATED' | 'RESOLVED' | 'ALL';

interface Props {
  initialExceptions: Exception[];
  cycles: Array<{ id: string; started_at: string; counts: Record<string, number> | null; feed_a_id: string; feed_b_id: string; pipeline_id?: string | null }>;
  feeds: Array<{ id: string; name: string; version: number }>;
  statusFilter: StatusFilter;
  statusBreakdown: Record<string, Record<string, number>>;
  pipelines: Array<{ id: string; name: string; asset_class: string }>;
}

export function WorkspaceClient({ initialExceptions, cycles, feeds, statusFilter, statusBreakdown, pipelines }: Props): React.ReactElement {
  const pipelineNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pipelines) m.set(p.id, p.name);
    return m;
  }, [pipelines]);
  const router = useRouter();
  const params = useSearchParams();
  const [items, setItems] = useState<Exception[]>(initialExceptions);
  const [selectedId, setSelectedId] = useState<string | null>(initialExceptions[0]?.id ?? null);
  const [bandFilter, setBandFilter] = useState<string>(params.get('band') ?? 'all');
  const [cycleFilter, setCycleFilter] = useState<string>(params.get('cycle') ?? 'all');

  useEffect(() => {
    setItems(initialExceptions);
  }, [initialExceptions]);

  const updateStatus = useCallback(
    (next: StatusFilter) => {
      const q = new URLSearchParams(params.toString());
      if (next === 'OPEN') q.delete('status');
      else q.set('status', next);
      router.push(`/workspace${q.toString() ? `?${q.toString()}` : ''}`);
    },
    [params, router]
  );
  const [search, setSearch] = useState(params.get('q') ?? '');
  const classFilter = params.get('class');
  const cpyFilter = params.get('cpy');
  const symbolFilter = params.get('symbol');
  const amountMin = params.get('min') ? Number(params.get('min')) : null;
  const amountMax = params.get('max') ? Number(params.get('max')) : null;
  const ageMaxDays = params.get('age_max') ? Number(params.get('age_max')) : null;
  const ageMinDays = params.get('age_min') ? Number(params.get('age_min')) : null;
  const aiQuery = params.get('q');

  const activeAiFilters =
    !!classFilter || !!cpyFilter || !!symbolFilter || amountMin != null ||
    amountMax != null || ageMaxDays != null || ageMinDays != null ||
    (params.get('band') && params.get('band') !== 'all');

  const feedNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of feeds) m.set(f.id, f.name);
    return m;
  }, [feeds]);

  const filtered = useMemo(() => {
    const now = new Date();
    return items.filter((e) => {
      if (bandFilter !== 'all' && (e.band ?? 'UNMATCHED') !== bandFilter) return false;
      if (cycleFilter !== 'all' && e.cycle_id !== cycleFilter) return false;
      if (classFilter && e.exception_class !== classFilter) return false;

      const cpy = e.trade_a?.counterparty ?? e.trade_b?.counterparty ?? '';
      if (cpyFilter && !cpy.toLowerCase().includes(cpyFilter.toLowerCase())) return false;

      const sym = e.trade_a?.symbol ?? e.trade_b?.symbol ?? '';
      if (symbolFilter && sym.toUpperCase() !== symbolFilter.toUpperCase()) return false;

      const qty = Number(e.trade_a?.quantity ?? e.trade_b?.quantity ?? 0);
      const price = Number(e.trade_a?.price ?? e.trade_b?.price ?? 0);
      const amount = qty * price;
      if (amountMin != null && amount < amountMin) return false;
      if (amountMax != null && amount > amountMax) return false;

      const ageDays = differenceInDays(now, new Date(e.opened_at));
      if (ageMinDays != null && ageDays < ageMinDays) return false;
      if (ageMaxDays != null && ageDays > ageMaxDays) return false;

      if (search) {
        const s = search.toLowerCase();
        const hay = [
          e.exception_class,
          e.trade_a?.symbol,
          e.trade_b?.symbol,
          e.trade_a?.counterparty,
          e.trade_b?.counterparty,
          e.trade_a?.source_ref,
          e.trade_b?.source_ref
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [items, bandFilter, cycleFilter, search, classFilter, cpyFilter, symbolFilter, amountMin, amountMax, ageMinDays, ageMaxDays]);

  const rows: QueueRow[] = useMemo(
    () =>
      filtered.map((e) => ({
        id: e.id,
        cycle_id: e.cycle_id,
        band: (e.band ?? 'UNMATCHED') as QueueRow['band'],
        exception_class: e.exception_class,
        symbol: e.trade_a?.symbol ?? e.trade_b?.symbol ?? '—',
        counterparty: e.trade_a?.counterparty ?? e.trade_b?.counterparty ?? '—',
        direction: (e.trade_a?.direction ?? e.trade_b?.direction ?? 'BUY') as 'BUY' | 'SELL',
        quantity: Number(e.trade_a?.quantity ?? e.trade_b?.quantity ?? 0),
        amount: Number(e.trade_a?.price ?? e.trade_b?.price ?? 0) * Number(e.trade_a?.quantity ?? e.trade_b?.quantity ?? 0),
        posterior: e.match_result?.posterior,
        opened_at: e.opened_at,
        cycle_label: feedNameById.get(cycles.find((c) => c.id === e.cycle_id)?.feed_b_id ?? '') ?? ''
      })),
    [filtered, feedNameById, cycles]
  );

  const selected = useMemo(() => filtered.find((e) => e.id === selectedId) ?? filtered[0] ?? null, [filtered, selectedId]);
  useEffect(() => {
    if (!selected && filtered[0]) setSelectedId(filtered[0].id);
  }, [filtered, selected]);

  const goNext = useCallback(() => {
    if (!selected) return;
    const idx = filtered.findIndex((e) => e.id === selected.id);
    const next = filtered[(idx + 1) % filtered.length];
    if (next) setSelectedId(next.id);
  }, [filtered, selected]);

  const goPrev = useCallback(() => {
    if (!selected) return;
    const idx = filtered.findIndex((e) => e.id === selected.id);
    const prev = filtered[(idx - 1 + filtered.length) % filtered.length];
    if (prev) setSelectedId(prev.id);
  }, [filtered, selected]);

  const doAction = useCallback(
    async (action: 'ACCEPT' | 'REJECT' | 'ESCALATE' | 'NOTE' | 'ASSIGN', reason?: string) => {
      if (!selected) return;
      // Client-side guard: block non-additive actions on terminal records so the
      // server-side 409 is a defense-in-depth, not the first line of defense.
      const terminal = selected.status === 'RESOLVED' || selected.status === 'ESCALATED';
      const additive = action === 'NOTE' || action === 'ASSIGN';
      if (terminal && !additive) {
        toast.info(`Exception is already ${selected.status}. No change made.`);
        return;
      }
      const res = await fetch(`/api/exceptions/${selected.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason })
      });
      if (res.status === 409) {
        const body = await res.json();
        toast.info(body.message ?? 'already in that state');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.message ?? body.error ?? 'action failed');
        return;
      }
      toast.success(`${action.toLowerCase()} — exception ${selected.id.slice(0, 8)}`);
      // Remove from open list
      setItems((items) => items.filter((e) => e.id !== selected.id));
      router.refresh();
    },
    [selected, router]
  );

  const isSelectedTerminal = selected?.status === 'RESOLVED' || selected?.status === 'ESCALATED';

  // CSV export of the currently-filtered exception queue. Mirrors what the
  // analyst sees so the emailed break report matches the UI 1:1.
  const exportCsv = useCallback((): void => {
    const csvEscape = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      // Neutralize spreadsheet formula-injection — a cell starting with
      // `=`, `+`, `-`, `@`, tab, or CR will execute in Excel/Sheets.
      // Prefixing with a single apostrophe is the OWASP-recommended mitigation.
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const now = new Date();
    const header = [
      'exception_id', 'cycle_id', 'pipeline', 'opened_at', 'age_hours',
      'status', 'band', 'exception_class', 'also_failing',
      'symbol', 'direction', 'quantity', 'price', 'amount_usd', 'currency',
      'counterparty_a', 'counterparty_b', 'account_a', 'account_b',
      'trade_date_a', 'trade_date_b', 'settlement_date_a', 'settlement_date_b',
      'source_ref_a', 'source_ref_b',
      'posterior', 'deterministic_hit',
      'ai_verdict', 'ai_confidence',
      'assignee', 'triage_source', 'triage_summary', 'suggested_action'
    ].join(',');

    const lines = filtered.map((e) => {
      let triage: Record<string, unknown> = {};
      try {
        if (e.explanation_cached) triage = JSON.parse(e.explanation_cached) as Record<string, unknown>;
      } catch { /* keep empty */ }
      const qty = Number(e.trade_a?.quantity ?? e.trade_b?.quantity ?? 0);
      const price = Number(e.trade_a?.price ?? e.trade_b?.price ?? 0);
      const pipelineName = pipelineNameById.get(
        cycles.find((c) => c.id === e.cycle_id)?.pipeline_id ?? ''
      ) ?? '';
      const ageHours = (now.getTime() - new Date(e.opened_at).getTime()) / 3_600_000;
      return [
        e.id, e.cycle_id, pipelineName, e.opened_at, ageHours.toFixed(1),
        e.status, e.band ?? '', e.exception_class,
        Array.isArray(triage.also_failing) ? (triage.also_failing as string[]).join('|') : '',
        e.trade_a?.symbol ?? e.trade_b?.symbol ?? '',
        e.trade_a?.direction ?? e.trade_b?.direction ?? '',
        qty, price, (qty * price).toFixed(2),
        e.trade_a?.currency ?? e.trade_b?.currency ?? '',
        e.trade_a?.counterparty ?? '', e.trade_b?.counterparty ?? '',
        e.trade_a?.account ?? '', e.trade_b?.account ?? '',
        e.trade_a?.trade_date ?? '', e.trade_b?.trade_date ?? '',
        e.trade_a?.settlement_date ?? '', e.trade_b?.settlement_date ?? '',
        e.trade_a?.source_ref ?? '', e.trade_b?.source_ref ?? '',
        e.match_result?.posterior?.toFixed(4) ?? '',
        e.match_result?.deterministic_hit ?? '',
        e.match_result?.llm_verdict?.verdict ?? '',
        e.match_result?.llm_verdict?.confidence?.toFixed(2) ?? '',
        e.assignee ?? '',
        triage.source ?? '',
        triage.summary ?? '',
        triage.suggested_action ?? triage.recommended_action ?? ''
      ].map(csvEscape).join(',');
    });

    const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const statusTag = statusFilter === 'ALL' ? 'all' : statusFilter.toLowerCase();
    a.download = `break-report-${statusTag}-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Exported ${filtered.length} exception${filtered.length === 1 ? '' : 's'}`);
  }, [filtered, cycles, pipelineNameById, statusFilter]);

  useHotkeys('j', goNext, { enableOnFormTags: false });
  useHotkeys('k', goPrev, { enableOnFormTags: false });
  useHotkeys('a', () => !isSelectedTerminal && doAction('ACCEPT'), { enableOnFormTags: false });
  useHotkeys('r', () => !isSelectedTerminal && doAction('REJECT', 'rejected via keyboard shortcut'), { enableOnFormTags: false });
  useHotkeys('e', () => !isSelectedTerminal && doAction('ESCALATE', 'escalated via keyboard shortcut'), { enableOnFormTags: false });
  useHotkeys('/', (e) => {
    e.preventDefault();
    document.getElementById('workspace-search')?.focus();
  });

  return (
    <PanelGroup
      direction="horizontal"
      autoSaveId="workspace-layout"
      className="h-full min-w-0"
    >
      {/* Queue pane */}
      <Panel defaultSize={24} minSize={16} maxSize={40} className="bg-white flex flex-col border-r border-slate-200">
        <div className="p-3 space-y-2 border-b border-slate-200">
          {activeAiFilters && aiQuery && (
            <div className="rounded border border-violet-200 bg-violet-50/40 px-2 py-1.5 flex items-start gap-1.5">
              <Sparkles className="h-3 w-3 text-violet-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0 text-[10px]">
                <div className="flex items-center gap-1.5">
                  <AiAssistedBadge />
                  <span className="text-violet-700 font-medium">NL filters applied</span>
                </div>
                <div className="text-slate-700 font-mono truncate mt-0.5" title={aiQuery}>
                  &ldquo;{aiQuery}&rdquo;
                </div>
              </div>
              <button
                onClick={() => router.push('/workspace')}
                className="shrink-0 text-slate-400 hover:text-slate-900"
                aria-label="Clear AI filters"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <Input
            id="workspace-search"
            placeholder="Search symbol / CPY / ID  (/)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs"
          />
          <div className="flex gap-2">
            <Select value={statusFilter} onValueChange={(v) => updateStatus(v as StatusFilter)}>
              <SelectTrigger className="h-7 text-xs flex-1" aria-label="Status filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="ESCALATED">Escalated</SelectItem>
                <SelectItem value="RESOLVED">Resolved</SelectItem>
                <SelectItem value="ALL">All statuses</SelectItem>
              </SelectContent>
            </Select>
            <Select value={bandFilter} onValueChange={setBandFilter}>
              <SelectTrigger className="h-7 text-xs flex-1" aria-label="Band filter">
                <SelectValue placeholder="Band" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All bands</SelectItem>
                <SelectItem value="HIGH">HIGH</SelectItem>
                <SelectItem value="MEDIUM">MEDIUM</SelectItem>
                <SelectItem value="LOW">LOW</SelectItem>
                <SelectItem value="UNMATCHED">Unmatched</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Select value={cycleFilter} onValueChange={setCycleFilter}>
            <SelectTrigger className="h-7 text-xs w-full" aria-label="Cycle filter">
              <SelectValue placeholder="Cycle" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cycles</SelectItem>
              {cycles.map((c) => {
                const pipeName = c.pipeline_id ? pipelineNameById.get(c.pipeline_id) : null;
                return (
                  <SelectItem key={c.id} value={c.id} className="text-xs font-mono">
                    {new Date(c.started_at).toISOString().slice(0, 10)} · {feedNameById.get(c.feed_b_id)?.slice(0, 16) ?? c.id.slice(0, 6)}
                    {pipeName && <span className="ml-1.5 text-slate-400">[{pipeName}]</span>}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <div className="text-[11px] text-slate-500 flex items-center justify-between gap-2">
            <span>
              {filtered.length} {statusFilter === 'ALL' ? 'total' : statusFilter.toLowerCase()}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={exportCsv}
                disabled={filtered.length === 0}
                title="Download the currently-filtered exceptions as CSV. Mirrors what's in the queue — use this as your end-of-day break report."
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                aria-label="Export queue to CSV"
              >
                <Download className="h-3 w-3" />
                CSV
              </button>
              <span className="text-slate-400">
                <span className="kbd">J/K</span> nav · <span className="kbd">/</span> search
              </span>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {filtered.length === 0 ? (
            <EmptyInbox
              statusFilter={statusFilter}
              cycleFilter={cycleFilter}
              cycles={cycles}
              feedNameById={feedNameById}
              statusBreakdown={statusBreakdown}
              onSwitchStatus={updateStatus}
              onSwitchCycle={setCycleFilter}
            />
          ) : (
            <QueueTable rows={rows} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>
      </Panel>
      <PanelResizeHandle className="w-[3px] bg-slate-100 hover:bg-violet-400 transition-colors" aria-label="Resize queue" />

      {/* Compare pane */}
      <Panel defaultSize={52} minSize={30} className="bg-slate-50 overflow-auto">
        {selected ? (
          <ComparePane
            exception={selected}
            feedNameA={selected.trade_a ? feedNameById.get(selected.trade_a.source_id) : undefined}
            feedNameB={selected.trade_b ? feedNameById.get(selected.trade_b.source_id) : undefined}
          />
        ) : (
          <div className="h-full grid place-items-center text-slate-400 text-xs">
            <div className="text-center">
              <AlertCircle className="h-8 w-8 mx-auto mb-2" />
              Select an exception from the queue
            </div>
          </div>
        )}
      </Panel>
      <PanelResizeHandle className="w-[3px] bg-slate-100 hover:bg-violet-400 transition-colors" aria-label="Resize detail" />

      {/* Action pane */}
      <Panel defaultSize={24} minSize={18} maxSize={40} className="bg-white border-l border-slate-200">
        {selected ? <ActionPanel exception={selected} onAction={doAction} /> : null}
      </Panel>
    </PanelGroup>
  );
}

interface EmptyInboxProps {
  statusFilter: StatusFilter;
  cycleFilter: string;
  cycles: Array<{ id: string; started_at: string; counts: Record<string, number> | null; feed_a_id: string; feed_b_id: string }>;
  feedNameById: Map<string, string>;
  statusBreakdown: Record<string, Record<string, number>>;
  onSwitchStatus: (s: StatusFilter) => void;
  onSwitchCycle: (cycleId: string) => void;
}

function EmptyInbox({
  statusFilter,
  cycleFilter,
  cycles,
  feedNameById,
  statusBreakdown,
  onSwitchStatus,
  onSwitchCycle
}: EmptyInboxProps): React.ReactElement {
  const selectedCycle = cycleFilter !== 'all' ? cycles.find((c) => c.id === cycleFilter) : null;

  const cycleCounts = selectedCycle
    ? statusBreakdown[selectedCycle.id] ?? {}
    : Object.values(statusBreakdown).reduce<Record<string, number>>((acc, row) => {
        for (const [k, v] of Object.entries(row)) acc[k] = (acc[k] ?? 0) + v;
        return acc;
      }, {});

  const statuses: StatusFilter[] = ['OPEN', 'ESCALATED', 'RESOLVED'];
  const hasOtherStatus = statuses.some(
    (s) => s !== statusFilter && (cycleCounts[s] ?? 0) > 0
  );

  const cyclesWithOpen = cycles
    .map((c) => ({ c, open: statusBreakdown[c.id]?.OPEN ?? 0 }))
    .filter((x) => x.open > 0)
    .slice(0, 3);

  return (
    <div className="p-5 text-xs">
      <div className="text-center">
        <Inbox className="h-7 w-7 mx-auto mb-2 text-slate-300" />
        <div className="text-slate-500 font-medium mb-1">
          No{' '}
          {statusFilter === 'ALL' ? 'exceptions' : `${statusFilter.toLowerCase()} exceptions`}{' '}
          in {selectedCycle ? 'this cycle' : 'any cycle'}
        </div>
        {selectedCycle && (
          <div className="text-[10px] text-slate-400 font-mono mb-3">
            {feedNameById.get(selectedCycle.feed_b_id) ?? selectedCycle.id.slice(0, 8)}
          </div>
        )}
      </div>

      {hasOtherStatus && (
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">
            This cycle has
          </div>
          <div className="space-y-1">
            {statuses.map((s) => {
              const n = cycleCounts[s] ?? 0;
              if (n === 0 || s === statusFilter) return null;
              return (
                <button
                  key={s}
                  onClick={() => onSwitchStatus(s)}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-white border border-transparent hover:border-slate-200 transition"
                >
                  <span className="text-slate-700 font-medium">{s.toLowerCase()}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-slate-900">{n}</span>
                    <span className="text-[10px] text-violet-600">view →</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!hasOtherStatus && cyclesWithOpen.length > 0 && (
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">
            Other cycles with open items
          </div>
          <div className="space-y-1">
            {cyclesWithOpen.map(({ c, open }) => (
              <button
                key={c.id}
                onClick={() => {
                  if (statusFilter !== 'OPEN') onSwitchStatus('OPEN');
                  onSwitchCycle(c.id);
                }}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-white border border-transparent hover:border-slate-200 transition"
              >
                <span className="font-mono text-slate-700 truncate">
                  {new Date(c.started_at).toISOString().slice(0, 10)} ·{' '}
                  {feedNameById.get(c.feed_b_id)?.slice(0, 20) ?? c.id.slice(0, 6)}
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <span className="font-mono text-slate-900">{open}</span>
                  <span className="text-[10px] text-violet-600">→</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!hasOtherStatus && cyclesWithOpen.length === 0 && (
        <div className="mt-3 text-slate-400 text-center text-[11px]">
          No exceptions anywhere. Run a matching cycle from /matching.
        </div>
      )}
    </div>
  );
}
