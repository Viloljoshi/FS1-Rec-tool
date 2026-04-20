'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { AiAssistedBadge } from '@/components/shared/AiAssistedBadge';
import { BarChart, Bar, LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { differenceInHours, formatDistanceToNow } from 'date-fns';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  Sparkles,
  Activity,
  RefreshCw,
  Info,
  DollarSign,
  Layers,
  TrendingUp,
  FileWarning
} from 'lucide-react';

interface InfoTipProps {
  children: React.ReactNode;
}

function InfoTip({ children }: InfoTipProps): React.ReactElement {
  return (
    <UITooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="More info"
          className="inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
        >
          <Info className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        className="max-w-[280px] bg-slate-900 text-slate-50 px-3 py-2 text-[11px] leading-relaxed"
      >
        {children}
      </TooltipContent>
    </UITooltip>
  );
}

interface CycleRow {
  id: string;
  feed_a_id: string;
  feed_b_id: string;
  counts: Record<string, number> | null;
  started_at: string;
}

interface EvalRow {
  id: string;
  precision_score: number;
  recall_score: number;
  f1_score: number;
  created_at: string;
  model_version: string;
  matching_rules_version: number;
  per_band: Record<string, { precision: number; recall: number; f1: number; n: number }> | null;
  confusion: { tp: number; fp: number; tn: number; fn: number } | null;
}

interface ExceptionRow {
  id: string;
  status: string;
  opened_at: string;
  updated_at: string;
  exception_class: string | null;
  band: string | null;
  trade_a_id: string | null;
  trade_b_id: string | null;
  match_result_id: string | null;
  cycle_id: string;
}

interface ActionRow {
  id: string;
  action: string;
  created_at: string;
  exception_id: string;
}

interface MatchResultRow {
  id: string;
  band: string | null;
  llm_verdict: { verdict: string; confidence: number } | null;
}

interface TradeRow {
  trade_id: string;
  source_id: string;
}

interface AiCallRow {
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

interface AuditEventRow {
  entity_id: string;
  action: string;
  created_at: string;
}

interface Props {
  cycles: Array<CycleRow & { finished_at?: string | null }>;
  matchesCount: number;
  exceptions: ExceptionRow[];
  actions: ActionRow[];
  evals: EvalRow[];
  feeds: Array<{ id: string; name: string }>;
  matchResults: MatchResultRow[];
  trades: TradeRow[];
  aiCalls: AiCallRow[];
  auditEvents: AuditEventRow[];
}

export function DashboardClient({
  cycles,
  matchesCount,
  exceptions,
  actions,
  evals,
  feeds,
  matchResults,
  trades,
  aiCalls,
  auditEvents
}: Props): React.ReactElement {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [narrativeLoading, setNarrativeLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/dashboard-narrative', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setNarrative(data.narrative ?? null);
        }
      } finally {
        if (!cancelled) setNarrativeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const regenerateNarrative = async () => {
    setNarrativeLoading(true);
    try {
      const res = await fetch('/api/ai/dashboard-narrative', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setNarrative(data.narrative ?? null);
      }
    } finally {
      setNarrativeLoading(false);
    }
  };

  const feedNameById = useMemo(() => new Map(feeds.map((f) => [f.id, f.name])), [feeds]);

  const totalMatches = cycles.reduce((a, c) => a + (c.counts?.MATCHES ?? 0), 0) || matchesCount || 1;
  const totalHigh = cycles.reduce((a, c) => a + (c.counts?.HIGH ?? 0), 0);
  const autoMatchRate = totalHigh / Math.max(totalMatches, 1);

  const openExceptions = exceptions.filter((e) => e.status === 'OPEN');
  const resolvedExceptions = exceptions.filter((e) => e.status !== 'OPEN');
  const unresolvedRate = exceptions.length > 0 ? openExceptions.length / exceptions.length : 0;

  const ages = openExceptions.map((e) => differenceInHours(new Date(), new Date(e.opened_at)));
  ages.sort((a, b) => a - b);
  const medianAgeHrs = ages.length ? ages[Math.floor(ages.length / 2)] ?? 0 : 0;

  // Resolution rate = proportion of resolution_actions that moved an exception
  // to a terminal state (ACCEPT, REJECT, or ESCALATE). NOTE and ASSIGN are
  // additive — they don't close the exception — so they don't count.
  const resolvedActions = actions.filter(
    (a) => a.action === 'ACCEPT' || a.action === 'REJECT' || a.action === 'ESCALATE'
  ).length;
  const aiTotal = actions.length || 1;
  const resolutionRate = resolvedActions / aiTotal;

  const latestEval = evals[0];

  // Exception aging buckets
  const buckets = [
    { label: '0–1d', min: 0, max: 24 },
    { label: '1–3d', min: 24, max: 72 },
    { label: '3–7d', min: 72, max: 168 },
    { label: '7d+', min: 168, max: Infinity }
  ];
  const agingData = buckets.map((b) => ({
    bucket: b.label,
    count: ages.filter((a) => a >= b.min && a < b.max).length
  }));

  // Match rate by cycle (chronological)
  const rateByCycle = [...cycles]
    .reverse()
    .map((c, i) => ({
      label: `#${i + 1}`,
      name: `${feedNameById.get(c.feed_b_id)?.slice(0, 18) ?? c.feed_b_id.slice(0, 8)}`,
      rate: c.counts
        ? (c.counts.HIGH ?? 0) / Math.max(c.counts.MATCHES ?? 1, 1)
        : 0
    }));

  // ─── New metrics ────────────────────────────────────────────────────────

  // 1. Exception class breakdown (OPEN items only — what ops needs to fix now)
  const classBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of openExceptions) {
      const k = e.exception_class ?? 'UNKNOWN';
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([cls, n]) => ({ cls, n }))
      .sort((a, b) => b.n - a.n);
  }, [openExceptions]);

  // 2. AI tiebreak agreement rate. Definition: of MEDIUM-band match_results
  //    that have an LLM verdict AND a downstream resolution action, how often
  //    did the analyst's action align with the model's verdict?
  //    LIKELY_MATCH + ACCEPT => agree
  //    LIKELY_NO_MATCH + REJECT => agree
  //    anything else => disagree
  //    UNCERTAIN verdicts excluded (neither agrees nor disagrees).
  const aiAgreement = useMemo(() => {
    const mrById = new Map(matchResults.map((m) => [m.id, m]));
    const exceptionActionByExId = new Map<string, string>();
    // first touched action per exception (the decisive one)
    const sorted = [...actions].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    for (const a of sorted) {
      if (!exceptionActionByExId.has(a.exception_id)) {
        exceptionActionByExId.set(a.exception_id, a.action);
      }
    }
    let agree = 0;
    let disagree = 0;
    let abstain = 0;
    for (const ex of exceptions) {
      if (ex.band !== 'MEDIUM' || !ex.match_result_id) continue;
      const mr = mrById.get(ex.match_result_id);
      if (!mr?.llm_verdict) continue;
      const verdict = mr.llm_verdict.verdict;
      const analystAction = exceptionActionByExId.get(ex.id);
      if (!analystAction) continue;
      if (verdict === 'UNCERTAIN') {
        abstain++;
        continue;
      }
      const verdictSaysMatch = verdict === 'LIKELY_MATCH';
      const analystSaysMatch = analystAction === 'ACCEPT';
      const analystSaysNoMatch = analystAction === 'REJECT';
      if (verdictSaysMatch && analystSaysMatch) agree++;
      else if (!verdictSaysMatch && analystSaysNoMatch) agree++;
      else if (verdictSaysMatch || analystSaysMatch || analystSaysNoMatch) disagree++;
    }
    const denom = agree + disagree;
    return {
      rate: denom > 0 ? agree / denom : null,
      agree,
      disagree,
      abstain,
      denom
    };
  }, [exceptions, actions, matchResults]);

  // 3. Per-feed exception rate. Which feed is producing the most open
  //    exceptions? Looks at both sides of each exception pair.
  const perFeedExceptions = useMemo(() => {
    const tradeToFeed = new Map(trades.map((t) => [t.trade_id, t.source_id]));
    const counts: Record<string, number> = {};
    for (const e of openExceptions) {
      const feedIds = new Set<string>();
      if (e.trade_a_id) {
        const fa = tradeToFeed.get(e.trade_a_id);
        if (fa) feedIds.add(fa);
      }
      if (e.trade_b_id) {
        const fb = tradeToFeed.get(e.trade_b_id);
        if (fb) feedIds.add(fb);
      }
      for (const id of feedIds) {
        counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([id, n]) => ({ feedId: id, feedName: feedNameById.get(id) ?? id.slice(0, 8), n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 6);
  }, [openExceptions, trades, feedNameById]);

  // 4. Avg resolution time (closed items only — throughput not survivor bias).
  //    For each resolved exception, find the first resolution action and
  //    subtract from opened_at.
  const resolutionTime = useMemo(() => {
    const firstActionByEx = new Map<string, string>();
    const sorted = [...actions].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    for (const a of sorted) {
      if (a.action !== 'ACCEPT' && a.action !== 'REJECT' && a.action !== 'ESCALATE') continue;
      if (!firstActionByEx.has(a.exception_id)) firstActionByEx.set(a.exception_id, a.created_at);
    }
    const durations: number[] = [];
    for (const e of exceptions) {
      if (e.status === 'OPEN') continue;
      const closedAt = firstActionByEx.get(e.id);
      if (!closedAt) continue;
      const hrs = differenceInHours(new Date(closedAt), new Date(e.opened_at));
      if (hrs >= 0) durations.push(hrs);
    }
    durations.sort((a, b) => a - b);
    const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const median = durations.length ? durations[Math.floor(durations.length / 2)] ?? 0 : 0;
    return { avg, median, count: durations.length, durations };
  }, [exceptions, actions]);

  // 5. Cost per resolved exception. Rough blended-token pricing — kept as
  //    approximations because ai_calls doesn't persist a price column yet.
  //    Reasoning-model inference: ~$3/M in, ~$12/M out (blended $8/M).
  //    Embedding model: ~$0.02/M.
  //    These rates are editable in one place below.
  const cost = useMemo(() => {
    const PRICE_PER_M_REASONING = 8; // USD per 1M blended tokens
    const PRICE_PER_M_EMBED = 0.02;
    let usd = 0;
    for (const c of aiCalls) {
      const tot = (c.input_tokens ?? 0) + (c.output_tokens ?? 0);
      if (c.model?.toLowerCase().includes('embed')) {
        usd += (tot / 1_000_000) * PRICE_PER_M_EMBED;
      } else {
        usd += (tot / 1_000_000) * PRICE_PER_M_REASONING;
      }
    }
    const resolvedCount = exceptions.filter((e) => e.status !== 'OPEN').length || 1;
    return {
      totalUsd: usd,
      perResolved: usd / resolvedCount,
      calls: aiCalls.length
    };
  }, [aiCalls, exceptions]);

  // 6. SLA adherence — % of closed exceptions resolved within 2h.
  const SLA_HOURS = 2;
  const slaAdherence = useMemo(() => {
    if (resolutionTime.durations.length === 0) {
      return { rate: null as number | null, within: 0, total: 0 };
    }
    const within = resolutionTime.durations.filter((d) => d <= SLA_HOURS).length;
    return {
      rate: within / resolutionTime.durations.length,
      within,
      total: resolutionTime.durations.length
    };
  }, [resolutionTime]);

  // 7. Escalation funnel — of items ever ESCALATED, how many eventually
  //    landed in RESOLVED state vs still sitting in ESCALATED or re-opened.
  //    Source of truth: audit_events (exception entity) since the status
  //    column only holds the current state.
  const escalationFunnel = useMemo(() => {
    const escalatedIds = new Set<string>();
    const resolvedIds = new Set<string>();
    for (const evt of auditEvents) {
      const a = evt.action;
      if (a === 'EXCEPTION_ESCALATE') escalatedIds.add(evt.entity_id);
      if (a === 'EXCEPTION_ACCEPT' || a === 'EXCEPTION_REJECT') resolvedIds.add(evt.entity_id);
    }
    let eventuallyClosed = 0;
    for (const id of escalatedIds) if (resolvedIds.has(id)) eventuallyClosed++;
    const stuck = escalatedIds.size - eventuallyClosed;
    return {
      escalated: escalatedIds.size,
      eventuallyClosed,
      stuck,
      closedRate: escalatedIds.size > 0 ? eventuallyClosed / escalatedIds.size : null
    };
  }, [auditEvents]);

  // 8. Cycle throughput — cycles/day (last 7 days) + avg duration seconds.
  const cycleThroughput = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const recent = cycles.filter(
      (c) => new Date(c.started_at).getTime() >= sevenDaysAgo
    );
    const daily = recent.length / 7;
    const durations: number[] = [];
    for (const c of recent) {
      if (!c.finished_at) continue;
      const ms = new Date(c.finished_at).getTime() - new Date(c.started_at).getTime();
      if (ms >= 0) durations.push(ms / 1000);
    }
    const avgDurationSec = durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
    return {
      daily,
      avgDurationSec,
      total7d: recent.length
    };
  }, [cycles]);

  const formatHours = (h: number): string =>
    h >= 24 ? `${(h / 24).toFixed(1)}d` : h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(h * 60)}m`;

  const formatSeconds = (s: number): string =>
    s >= 60 ? `${(s / 60).toFixed(1)}m` : `${s.toFixed(1)}s`;

  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={50}>
      <div className="space-y-8">
        {/* AI narrative banner */}
        <Card className="border-violet-200 bg-violet-50/30">
          <CardContent className="py-4 flex items-start gap-3">
            <div className="h-9 w-9 shrink-0 rounded-full bg-violet-600 grid place-items-center">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs uppercase tracking-wider text-violet-700 font-medium">
                  AI Analysis
                </span>
                <AiAssistedBadge />
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 px-2"
                  onClick={regenerateNarrative}
                  disabled={narrativeLoading}
                >
                  <RefreshCw className={`h-3 w-3 ${narrativeLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              {narrativeLoading ? (
                <div className="mt-2 space-y-1.5">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-11/12" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ) : narrative ? (
                <p className="text-sm text-slate-800 mt-1 leading-relaxed">{narrative}</p>
              ) : (
                <p className="text-xs text-slate-500 mt-1 italic">
                  AI narrative unavailable. Deterministic KPIs below are always live.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Section 1 — Matching quality ── */}
        <section className="space-y-3">
          <SectionHeader
            label="Matching quality"
            hint="How good is the engine today? These four numbers answer whether the machine earns its keep and whether the AI actually helps."
          />
          <div className="grid grid-cols-4 gap-3">
            <KpiTile
              label="Auto-match rate"
              value={`${(autoMatchRate * 100).toFixed(1)}%`}
              tone="emerald"
              icon={<CheckCircle2 className="h-4 w-4" />}
              sub={`${totalHigh} / ${totalMatches} HIGH`}
              hint="Share of match_results that landed in the HIGH band (posterior ≥ 0.95) and auto-resolved without human review. Higher = more analyst leverage."
            />
            <KpiTile
              label="Evals F1"
              value={latestEval ? latestEval.f1_score.toFixed(3) : '—'}
              tone="indigo"
              icon={<Activity className="h-4 w-4" />}
              sub={
                latestEval
                  ? `P=${latestEval.precision_score.toFixed(2)} R=${latestEval.recall_score.toFixed(2)}`
                  : 'Click Run Evals →'
              }
              hint="Latest F1 on the 30-pair gold set. Precision = how often our matches were real; recall = how often real matches were caught. Ship-gate signal."
            />
            <KpiTile
              label="AI agreement rate"
              value={aiAgreement.rate != null ? `${(aiAgreement.rate * 100).toFixed(0)}%` : '—'}
              tone="violet"
              icon={<Sparkles className="h-4 w-4" />}
              sub={
                aiAgreement.denom > 0
                  ? `${aiAgreement.agree} agree / ${aiAgreement.denom} decided`
                  : 'No decided verdicts yet'
              }
              hint="Of MEDIUM-band exceptions where the AI gave LIKELY_MATCH or LIKELY_NO_MATCH, how often did the analyst's first action agree? Below 80% signals a trust problem and the tiebreak prompt needs retuning."
            />
            <KpiTile
              label="Cost per exception"
              value={`$${cost.perResolved.toFixed(3)}`}
              tone="indigo"
              icon={<DollarSign className="h-4 w-4" />}
              sub={`$${cost.totalUsd.toFixed(2)} · ${cost.calls} AI calls`}
              hint="Total AI spend (blended ~$8/M reasoning, $0.02/M embedding tokens) ÷ resolved exceptions. Compare against fully-loaded analyst cost (~$45/hr × avg-time-to-resolution) to quantify the leverage."
            />
          </div>
        </section>

        {/* ── Section 2 — Exception flow ── */}
        <section className="space-y-3">
          <SectionHeader
            label="Exception flow"
            hint="How fast do breaks move through the queue, and are we meeting SLA? Unlike Section 1 (quality), this section measures throughput — the operations manager's scorecard."
          />
          <div className="grid grid-cols-4 gap-3">
            <KpiTile
              label="Unresolved exceptions"
              value={`${(unresolvedRate * 100).toFixed(0)}%`}
              tone="amber"
              icon={<AlertCircle className="h-4 w-4" />}
              sub={`${openExceptions.length} open · ${resolvedExceptions.length} resolved`}
              hint="Share of exceptions still in OPEN status across all cycles. Drops as analysts clear the queue; rises when a noisy cycle lands."
            />
            <KpiTile
              label="Median exception age"
              value={
                medianAgeHrs >= 24
                  ? `${(medianAgeHrs / 24).toFixed(1)}d`
                  : `${medianAgeHrs.toFixed(0)}h`
              }
              tone="slate"
              icon={<Clock className="h-4 w-4" />}
              sub={`${openExceptions.length} open items`}
              hint="Median age of currently-open exceptions. ⚠ Survivor-biased — resolving the oldest items makes this drop, which looks like speed but is just triage order. Pair with “avg time to resolution” for the honest story."
            />
            <KpiTile
              label="Avg time to resolution"
              value={resolutionTime.count > 0 ? formatHours(resolutionTime.avg) : '—'}
              tone="emerald"
              icon={<Clock className="h-4 w-4" />}
              sub={
                resolutionTime.count > 0
                  ? `median ${formatHours(resolutionTime.median)} · n=${resolutionTime.count}`
                  : 'No closed items yet'
              }
              hint="Average time from opened_at to the first closing action on exceptions that actually got resolved. Unlike median-age-open, this measures real throughput — no survivor bias."
            />
            <KpiTile
              label={`SLA adherence (≤${SLA_HOURS}h)`}
              value={
                slaAdherence.rate != null
                  ? `${(slaAdherence.rate * 100).toFixed(0)}%`
                  : '—'
              }
              tone={
                slaAdherence.rate == null
                  ? 'slate'
                  : slaAdherence.rate >= 0.9
                    ? 'emerald'
                    : 'amber'
              }
              icon={<CheckCircle2 className="h-4 w-4" />}
              sub={
                slaAdherence.total > 0
                  ? `${slaAdherence.within} / ${slaAdherence.total} within SLA`
                  : 'No closed items yet'
              }
              hint={`Fraction of resolved exceptions closed within the ${SLA_HOURS}-hour target. Regulated cash-equity desks have break-resolution SLAs in the single-digit hours — this is the board-level number.`}
            />
          </div>
        </section>

        {/* ── Section 3 — Ops throughput ── */}
        <section className="space-y-3">
          <SectionHeader
            label="Ops throughput"
            hint="Capacity and follow-through. Are cycles running often enough, are escalations actually closing out, and what's the shape of today's queue?"
          />
          <div className="grid grid-cols-4 gap-3">
            <KpiTile
              label="Resolution rate"
              value={`${(resolutionRate * 100).toFixed(0)}%`}
              tone="violet"
              icon={<Sparkles className="h-4 w-4" />}
              sub={`${resolvedActions} resolved / ${aiTotal} actions`}
              hint="(ACCEPT + REJECT + ESCALATE) ÷ total analyst actions. NOTE and ASSIGN are additive and excluded — they don't close an exception."
            />
            <KpiTile
              label="Escalation closed-rate"
              value={
                escalationFunnel.closedRate != null
                  ? `${(escalationFunnel.closedRate * 100).toFixed(0)}%`
                  : '—'
              }
              tone={
                escalationFunnel.closedRate == null
                  ? 'slate'
                  : escalationFunnel.closedRate >= 0.8
                    ? 'emerald'
                    : 'amber'
              }
              icon={<TrendingUp className="h-4 w-4" />}
              sub={
                escalationFunnel.escalated > 0
                  ? `${escalationFunnel.eventuallyClosed} closed · ${escalationFunnel.stuck} stuck`
                  : 'No escalations yet'
              }
              hint="Of every exception ever ESCALATED (read from the append-only audit trail), what fraction eventually received an ACCEPT or REJECT? A stuck count above 10% means manager handoff is broken."
            />
            <KpiTile
              label="Cycle throughput (7d)"
              value={cycleThroughput.daily.toFixed(1)}
              tone="slate"
              icon={<Layers className="h-4 w-4" />}
              sub={
                cycleThroughput.total7d > 0
                  ? `${cycleThroughput.total7d} cycles · avg ${formatSeconds(cycleThroughput.avgDurationSec)}`
                  : 'No cycles in last 7 days'
              }
              hint="Matching cycles started per day, averaged across the last 7 days. The sub shows average duration (finished_at − started_at). Rising daily + flat duration = ops capacity holding under load."
            />
            <KpiTile
              label="Exception classes open"
              value={classBreakdown.length.toString()}
              tone="rose"
              icon={<FileWarning className="h-4 w-4" />}
              sub={
                classBreakdown.length > 0
                  ? `${classBreakdown[0]?.cls} leads with ${classBreakdown[0]?.n}`
                  : 'No open exceptions'
              }
              hint="Distinct exception classes with at least one open item. See the breakdown chart below — a WRONG_QTY spike means a broker's pricing feed drifted; a CPY_ALIAS spike means the KG needs seeding."
            />
          </div>
        </section>

        {/* ── Charts — distribution ── */}
        <section className="space-y-3">
          <SectionHeader
            label="Distribution"
            hint="Where the open workload is concentrated — by age, by class, by source feed, and how the engine has performed across recent cycles."
          />
          <div className="grid grid-cols-2 gap-4">
            <ChartCard
              title="Exception aging"
              hint="Currently-open exceptions bucketed by age in hours. Items in the 7d+ bucket are a red flag — either the queue is understaffed or those items need a different workflow (escalate, batch close)."
            >
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={agingData}>
                  <XAxis dataKey="bucket" fontSize={11} stroke="#64748b" />
                  <YAxis fontSize={11} stroke="#64748b" />
                  <Tooltip />
                  <Bar dataKey="count" fill="#0f172a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard
              title="Match rate by recent cycle"
              hint="HIGH-band rate across the last N cycles (chronological). A sudden dip is the first signal that a feed's format changed or a counterparty identifier drifted — investigate before it becomes an SLA miss."
            >
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={rateByCycle}>
                  <XAxis dataKey="label" fontSize={11} stroke="#64748b" />
                  <YAxis fontSize={11} stroke="#64748b" domain={[0, 1]} />
                  <Tooltip formatter={(v: number) => (v * 100).toFixed(0) + '%'} />
                  <Line
                    type="monotone"
                    dataKey="rate"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <ChartCard
              title="Open exceptions by class"
              hint="What's breaking, right now. WRONG_QTY = disagreement on share count; WRONG_PRICE = material price disagreement (money break, always escalate); CPY_ALIAS = counterparty name didn't resolve; TIMING = trade/settle date drift; ROUNDING = sub-cent price drift (display artifact, safe to accept); MISSING_ONE_SIDE = trade on one side has no counterpart. Different classes need different fixes — don't triage them the same way."
            >
              {classBreakdown.length === 0 ? (
                <div className="text-xs text-slate-400 py-8 text-center">No open exceptions.</div>
              ) : (
                <div className="space-y-1.5">
                  {classBreakdown.map((row) => {
                    const max = classBreakdown[0]?.n ?? 1;
                    const pct = (row.n / max) * 100;
                    return (
                      <div
                        key={row.cls}
                        className="grid grid-cols-[140px_1fr_40px] items-center gap-2 text-xs"
                      >
                        <div className="font-mono text-slate-700 truncate">{row.cls}</div>
                        <div className="bg-slate-100 rounded h-4 relative overflow-hidden">
                          <div
                            className="bg-amber-400 h-full rounded"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="font-mono tabular-nums text-right text-slate-900">
                          {row.n}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ChartCard>
            <ChartCard
              title="Open exceptions by feed"
              hint="Which feed is producing the most open exceptions? A feed that sits at the top several days running is a firefighting directive — call their integration team. Each exception can touch both sides so numbers can exceed total open count."
            >
              {perFeedExceptions.length === 0 ? (
                <div className="text-xs text-slate-400 py-8 text-center">No open exceptions.</div>
              ) : (
                <div className="space-y-1.5">
                  {perFeedExceptions.map((row) => {
                    const max = perFeedExceptions[0]?.n ?? 1;
                    const pct = (row.n / max) * 100;
                    return (
                      <div
                        key={row.feedId}
                        className="grid grid-cols-[160px_1fr_40px] items-center gap-2 text-xs"
                      >
                        <div className="text-slate-700 truncate">{row.feedName}</div>
                        <div className="bg-slate-100 rounded h-4 relative overflow-hidden">
                          <div
                            className="bg-rose-400 h-full rounded"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="font-mono tabular-nums text-right text-slate-900">
                          {row.n}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ChartCard>
          </div>
        </section>

        {/* ── Evals history ── */}
        <section className="space-y-3">
          <SectionHeader
            label="Evals history"
            hint="Every Run Evals execution. Shows regression on the 30-pair gold set across rule versions. If precision or recall dips after a rules publish, the new ruleset is worse — roll back."
          />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                Evals history
                <Badge variant="outline" className="text-[10px] font-mono">
                  gold set · 30 pairs
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Timestamp</th>
                    <th className="text-left px-4 py-2 font-medium text-slate-600">Rules v</th>
                    <th className="text-right px-4 py-2 font-medium text-slate-600">P</th>
                    <th className="text-right px-4 py-2 font-medium text-slate-600">R</th>
                    <th className="text-right px-4 py-2 font-medium text-slate-600">F1</th>
                    <th className="text-right px-4 py-2 font-medium text-slate-600">
                      TP/FP/TN/FN
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {evals.map((e) => (
                    <tr key={e.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-slate-600">
                        {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                      </td>
                      <td className="px-4 py-2 font-mono">v{e.matching_rules_version}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {e.precision_score.toFixed(3)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {e.recall_score.toFixed(3)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold">
                        {e.f1_score.toFixed(3)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-500">
                        {e.confusion
                          ? `${e.confusion.tp}/${e.confusion.fp}/${e.confusion.tn}/${e.confusion.fn}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                  {evals.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                        No eval runs yet. Click{' '}
                        <span className="font-mono">Run Evals</span> in the top bar.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </section>
      </div>
    </TooltipProvider>
  );
}

interface SectionHeaderProps {
  label: string;
  hint: string;
}

function SectionHeader({ label, hint }: SectionHeaderProps): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
        {label}
      </h2>
      <InfoTip>{hint}</InfoTip>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );
}

interface ChartCardProps {
  title: string;
  hint: string;
  children: React.ReactNode;
}

function ChartCard({ title, hint, children }: ChartCardProps): React.ReactElement {
  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5 text-slate-800">
          <span>{title}</span>
          <InfoTip>{hint}</InfoTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">{children}</CardContent>
    </Card>
  );
}

type TileTone = 'emerald' | 'amber' | 'slate' | 'violet' | 'indigo' | 'rose';

interface KpiTileProps {
  label: string;
  value: string;
  sub: string;
  tone: TileTone;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  hint?: React.ReactNode;
}

const TILE_ACCENT: Record<TileTone, string> = {
  emerald: 'text-emerald-600',
  amber: 'text-amber-600',
  slate: 'text-slate-500',
  violet: 'text-violet-600',
  indigo: 'text-indigo-600',
  rose: 'text-rose-600'
};

function KpiTile({ label, value, sub, tone, icon, badge, hint }: KpiTileProps): React.ReactElement {
  return (
    <Card className="border-slate-200 bg-white hover:shadow-sm transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium flex items-center gap-1.5">
            <span>{label}</span>
            {hint && <InfoTip>{hint}</InfoTip>}
          </div>
          <div className={TILE_ACCENT[tone]}>{icon}</div>
        </div>
        <div className="mt-3 text-[1.5rem] leading-none font-mono tabular-nums text-slate-900 font-semibold">
          {value}
        </div>
        <div className="text-[11px] text-slate-500 mt-1.5 font-mono truncate" title={sub}>
          {sub}
        </div>
        {badge && <div className="mt-2">{badge}</div>}
      </CardContent>
    </Card>
  );
}
