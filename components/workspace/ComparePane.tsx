'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BandChip } from '@/components/shared/BandChip';
import { AiAssistedBadge } from '@/components/shared/AiAssistedBadge';
import { MoneyCell, QtyCell, CopyableId, AgeCell } from '@/components/shared/Cells';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sparkles, FileText, BarChart3, Activity, Info } from 'lucide-react';
import type { Exception } from '@/app/workspace/WorkspaceClient';

const CANONICAL_FIELDS_ORDERED: Array<keyof NonNullable<Exception['trade_a']>> = [
  'source_ref',
  'trade_date',
  'settlement_date',
  'direction',
  'symbol',
  'isin',
  'cusip',
  'quantity',
  'price',
  'currency',
  'counterparty',
  'account'
];

interface ComparePaneProps {
  exception: Exception;
  feedNameA?: string;
  feedNameB?: string;
}

interface CachedTriage {
  summary?: string;
  likely_cause?: string;
  recommended_action?: string;
  suggested_action?: string;
  reason?: string;
  confidence?: number;
  source?: 'TEMPLATE' | 'RULE' | 'AI';
  also_failing?: string[];
}

function safeParse<T = unknown>(s: string): T | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function fieldRowClass(raw: number | undefined): string {
  if (raw === undefined) return '';
  if (raw >= 0.95) return 'bg-emerald-50/50';
  if (raw >= 0.7) return 'bg-amber-50/50';
  return 'bg-rose-50/50';
}

export function ComparePane({ exception, feedNameA, feedNameB }: ComparePaneProps): React.ReactElement {
  const { trade_a: a, trade_b: b, match_result: mr } = exception;
  const fieldScoreMap = useMemo(
    () => new Map((mr?.field_scores ?? []).map((f) => [f.field, f])),
    [mr?.field_scores]
  );

  const [explanation, setExplanation] = useState<CachedTriage | null>(
    exception.explanation_cached ? safeParse(exception.explanation_cached) : null
  );
  const [loadingExplain, setLoadingExplain] = useState(false);

  useEffect(() => {
    setExplanation(exception.explanation_cached ? safeParse(exception.explanation_cached) : null);
  }, [exception.id, exception.explanation_cached]);

  const loadExplain = async () => {
    if (explanation?.summary || loadingExplain) return;
    setLoadingExplain(true);
    try {
      const res = await fetch('/api/ai/explain-break', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exception_id: exception.id })
      });
      if (res.ok) {
        const data = await res.json();
        setExplanation(data.explanation);
      }
    } finally {
      setLoadingExplain(false);
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-slate-900 font-mono">
            {a?.symbol ?? b?.symbol} · {a?.direction ?? b?.direction}
          </h2>
          {exception.band ? (
            <BandChip band={exception.band} posterior={mr?.posterior} />
          ) : (
            <Badge variant="outline" className="text-[10px] uppercase">Unmatched</Badge>
          )}
          <Badge variant="outline" className="text-[10px] uppercase font-mono">
            {exception.exception_class.replace(/_/g, ' ')}
          </Badge>
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
            <span>opened</span>
            <AgeCell since={exception.opened_at} />
          </div>
        </div>

        {mr && (
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 uppercase tracking-wider">
                      Posterior probability
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="h-3 w-3 text-slate-400 hover:text-slate-600" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          Fellegi-Sunter posterior. Sum of log<sub>2</sub>(m/u) agreement weights across fields,
                          sigmoid-transformed. Band threshold: HIGH ≥ 0.95, MEDIUM 0.70–0.95, LOW &lt; 0.70.
                          Integrity vetoes may demote below this raw value.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <span className="font-mono tabular-nums text-sm font-semibold">{mr.posterior.toFixed(3)}</span>
                  </div>
                  <Progress value={mr.posterior * 100} className="h-2" />
                </div>
                {mr.deterministic_hit && (
                  <Tooltip>
                    <TooltipTrigger>
                      <Badge variant="outline" className="text-[10px] uppercase bg-emerald-50 border-emerald-200 text-emerald-700">
                        deterministic
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      SHA-256 composite key matched exactly (primary ID · date · qty · price · side · account).
                      No probabilistic scoring needed — auto-HIGH.
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="compare">
          <TabsList className="grid grid-cols-4 w-full max-w-xl gap-1">
            <TabsTrigger value="compare" className="min-w-0 px-2 text-[11px] sm:text-xs">
              <FileText className="h-3.5 w-3.5 mr-1 sm:mr-1.5 shrink-0" />
              <span className="truncate">Compare</span>
            </TabsTrigger>
            <TabsTrigger value="scores" className="min-w-0 px-2 text-[11px] sm:text-xs">
              <BarChart3 className="h-3.5 w-3.5 mr-1 sm:mr-1.5 shrink-0" />
              <span className="truncate">Scores</span>
            </TabsTrigger>
            <TabsTrigger value="ai" className="min-w-0 px-2 text-[11px] sm:text-xs">
              <Sparkles className="h-3.5 w-3.5 mr-1 sm:mr-1.5 shrink-0" />
              <span className="truncate">AI triage</span>
            </TabsTrigger>
            <TabsTrigger value="activity" className="min-w-0 px-2 text-[11px] sm:text-xs">
              <Activity className="h-3.5 w-3.5 mr-1 sm:mr-1.5 shrink-0" />
              <span className="truncate">Activity</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="compare" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <TradeCard title={feedNameA ?? 'Side A'} subtitle="source of truth" trade={a} />
              <TradeCard title={feedNameB ?? 'Side B'} subtitle="counterparty view" trade={b} />
            </div>
          </TabsContent>

          <TabsContent value="scores" className="space-y-3 pt-4">
            {a && b && mr ? (
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-medium text-slate-600 w-32">Field</th>
                        <th className="text-left px-3 py-1.5 font-medium text-slate-600">{feedNameA ?? 'Side A'}</th>
                        <th className="text-left px-3 py-1.5 font-medium text-slate-600">{feedNameB ?? 'Side B'}</th>
                        <th className="text-right px-3 py-1.5 font-medium text-slate-600 w-16">
                          <Tooltip>
                            <TooltipTrigger>Score</TooltipTrigger>
                            <TooltipContent className="text-xs max-w-[240px]">
                              Raw similarity in [0, 1]. 1 = exact agreement. 0 = disagreement.
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right px-3 py-1.5 font-medium text-slate-600 w-16">
                          <Tooltip>
                            <TooltipTrigger>Weight</TooltipTrigger>
                            <TooltipContent className="text-xs max-w-[240px]">
                              Fellegi-Sunter weight = log<sub>2</sub>(m/u), derived from the active matching rules.
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="text-right px-3 py-1.5 font-medium text-slate-600 w-20">
                          <Tooltip>
                            <TooltipTrigger>Contribution</TooltipTrigger>
                            <TooltipContent className="text-xs max-w-[240px]">
                              Score × Weight. How much this field pushed the posterior up or down.
                            </TooltipContent>
                          </Tooltip>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {CANONICAL_FIELDS_ORDERED.map((f) => {
                        const av = String(a[f] ?? '—');
                        const bv = String(b[f] ?? '—');
                        const score = fieldScoreMap.get(f as string);
                        const rowColor = fieldRowClass(score?.raw_score);
                        return (
                          <tr key={f as string} className={cn('border-t border-slate-100', rowColor)}>
                            <td className="px-3 py-1.5 font-mono text-slate-600">{f as string}</td>
                            <td className="px-3 py-1.5 font-mono">{av}</td>
                            <td className="px-3 py-1.5 font-mono">{bv}</td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                              {score ? score.raw_score.toFixed(2) : '—'}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                              {score ? score.weight.toFixed(2) : '—'}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                              {score ? score.contribution.toFixed(2) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-6 text-center text-sm text-slate-400">
                  Score breakdown is only available for 2-sided exceptions.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="ai" className="space-y-3 pt-4">
            {mr?.llm_verdict && (
              <Card className="border-violet-200 bg-violet-50/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                    LLM tiebreak verdict
                    <AiAssistedBadge />
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 pb-3">
                  <div className="text-xs text-slate-800">
                    <span className="font-medium">{mr.llm_verdict.verdict.replace(/_/g, ' ')}</span>
                    <span className="ml-2 font-mono text-slate-500">(confidence {mr.llm_verdict.confidence.toFixed(2)})</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{mr.llm_verdict.reasoning}</p>
                  {mr.llm_verdict.decisive_fields.length > 0 && (
                    <div className="mt-2 flex gap-1.5 flex-wrap">
                      {mr.llm_verdict.decisive_fields.map((f) => (
                        <Badge key={f} variant="outline" className="text-[10px] font-mono bg-white">
                          {f}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center gap-2 space-y-0">
                <CardTitle className="text-sm">Exception triage</CardTitle>
                {explanation?.source && (
                  <Badge variant="outline" className="text-[9px] font-mono uppercase">
                    source: {explanation.source}
                  </Badge>
                )}
                {explanation?.source === 'AI' && <AiAssistedBadge />}
                {!explanation?.summary && !loadingExplain && (
                  <button onClick={loadExplain} className="ml-auto text-xs text-violet-600 hover:underline">
                    Generate
                  </button>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                {loadingExplain && <p className="text-xs text-slate-500">Generating...</p>}
                {explanation?.summary ? (
                  <div className="space-y-2">
                    <p className="text-sm text-slate-800">{explanation.summary}</p>
                    <div className="flex gap-3 text-xs flex-wrap">
                      {explanation.likely_cause && (
                        <div>
                          <span className="text-slate-500">Likely cause:</span>{' '}
                          <span className="font-mono">{explanation.likely_cause}</span>
                        </div>
                      )}
                      {(explanation.recommended_action ?? explanation.suggested_action) && (
                        <div>
                          <span className="text-slate-500">Recommended:</span>{' '}
                          <span className="font-mono">
                            {explanation.recommended_action ?? explanation.suggested_action}
                          </span>
                        </div>
                      )}
                      {typeof explanation.confidence === 'number' && (
                        <div>
                          <span className="text-slate-500">Confidence:</span>{' '}
                          <span className="font-mono tabular-nums">{(explanation.confidence * 100).toFixed(0)}%</span>
                        </div>
                      )}
                    </div>
                    {Array.isArray(explanation.also_failing) && explanation.also_failing.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span className="text-slate-500 uppercase tracking-wider">Also failing:</span>
                        {explanation.also_failing.map((cls) => (
                          <span
                            key={cls}
                            className="font-mono px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700"
                            title="Additional field-level failure on this exception. Primary class is shown in the chip above — these are stacked issues the analyst should be aware of."
                          >
                            {cls}
                          </span>
                        ))}
                      </div>
                    )}
                    {explanation.reason && (
                      <p className="text-xs text-slate-500 italic border-l-2 border-slate-200 pl-2">
                        {explanation.reason}
                      </p>
                    )}
                  </div>
                ) : (
                  !loadingExplain && (
                    <p className="text-xs text-slate-400 italic">
                      No triage yet. Click <span className="font-mono">Generate</span>.
                    </p>
                  )
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity" className="space-y-3 pt-4">
            <ActivityTimeline exceptionId={exception.id} />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

interface AuditEvent {
  id: string;
  ts: string;
  action: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: { id: string | null; email: string | null; role: string | null };
}

function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): Array<{ field: string; before: unknown; after: unknown }> {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ field: k, before: a, after: b });
    }
  }
  return changes;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function ActivityTimeline({ exceptionId }: { exceptionId: string }): React.ReactElement {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/exceptions/${exceptionId}/audit`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) setError(body.message ?? body.error ?? `HTTP ${res.status}`);
          return;
        }
        const body = await res.json();
        if (!cancelled) setEvents(body.events ?? []);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [exceptionId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-4 text-xs text-slate-500">Loading activity…</CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="py-4 text-xs text-rose-600">Failed to load activity: {error}</CardContent>
      </Card>
    );
  }
  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="py-4 text-xs text-slate-500">
          No activity yet. Resolution actions, notes, and AI triage events will appear here.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Activity timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {events.map((e) => {
          const changes = diffFields(e.before, e.after);
          return (
            <div key={e.id} className="border-l-2 border-slate-200 pl-3 py-1">
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {e.action}
                </Badge>
                <span className="text-slate-500">
                  {new Date(e.ts).toLocaleString(undefined, {
                    dateStyle: 'short',
                    timeStyle: 'medium'
                  })}
                </span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-700">{e.actor.email ?? e.actor.id?.slice(0, 8) ?? 'system'}</span>
                {e.actor.role && (
                  <Badge variant="secondary" className="text-[9px] uppercase">
                    {e.actor.role}
                  </Badge>
                )}
              </div>
              {e.reason && (
                <div className="mt-1 text-xs italic text-slate-600">“{e.reason}”</div>
              )}
              {changes.length > 0 && (
                <div className="mt-1.5 text-[11px] space-y-0.5">
                  {changes.map((c) => (
                    <div key={c.field} className="flex gap-1.5 font-mono">
                      <span className="text-slate-500 min-w-[80px]">{c.field}:</span>
                      <span className="line-through text-rose-600">{formatCell(c.before)}</span>
                      <span className="text-slate-400">→</span>
                      <span className="text-emerald-700 font-semibold">{formatCell(c.after)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

interface TradeCardProps {
  title: string;
  subtitle?: string;
  trade: Exception['trade_a'];
}

function TradeCard({ title, subtitle, trade }: TradeCardProps): React.ReactElement {
  if (!trade) {
    return (
      <Card className="border-dashed border-slate-300 bg-slate-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-slate-600 font-medium">
            <span className="block truncate">{title}</span>
            {subtitle && <span className="text-[10px] text-slate-400 uppercase tracking-wider font-normal">{subtitle}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">Missing — no match candidate on this side.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-slate-700 font-medium flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate">{title}</div>
            {subtitle && <div className="text-[10px] text-slate-400 uppercase tracking-wider font-normal">{subtitle}</div>}
          </div>
          <CopyableId value={trade.source_ref} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm pt-0">
        <div className="flex justify-between font-mono"><span className="text-slate-500">symbol</span><span>{trade.symbol}</span></div>
        <div className="flex justify-between font-mono"><span className="text-slate-500">trade date</span><span>{trade.trade_date}</span></div>
        <div className="flex justify-between font-mono"><span className="text-slate-500">settle</span><span>{trade.settlement_date}</span></div>
        <div className="flex justify-between font-mono"><span className="text-slate-500">direction</span><span>{trade.direction}</span></div>
        <div className="flex justify-between"><span className="text-slate-500 font-mono">qty</span><QtyCell value={trade.quantity} /></div>
        <div className="flex justify-between"><span className="text-slate-500 font-mono">price</span><MoneyCell value={trade.price} currency={trade.currency} /></div>
        <div className="flex justify-between font-mono"><span className="text-slate-500">cpty</span><span className="truncate max-w-[60%]">{trade.counterparty}</span></div>
        <div className="flex justify-between font-mono"><span className="text-slate-500">account</span><span>{trade.account}</span></div>
      </CardContent>
    </Card>
  );
}
