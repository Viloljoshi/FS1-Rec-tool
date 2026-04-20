'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AiAssistedBadge } from '@/components/shared/AiAssistedBadge';
import { PIPELINE_STAGES, metricsFromCycle, type PipelineStage } from '@/lib/pipeline/stages';
import { cn } from '@/lib/utils';
import { ArrowRight, CheckCircle2, Cpu, Clock, Sparkles, Info } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ExpertMode } from '@/components/pipeline/ExpertMode';
import { RuleDraftsCard } from '@/components/pipeline/RuleDraftsCard';
import { useRouter } from 'next/navigation';

interface RuleRow {
  id: string;
  name: string;
  version: number;
  active: boolean;
  weights: unknown;
  tolerances: unknown;
  created_at: string;
}

interface CycleRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  counts: Record<string, number> | null;
  feed_a_id: string;
  feed_b_id: string;
  matching_rules_version: number | null;
}

interface Feed {
  id: string;
  name: string;
  version: number;
}

interface PipelineOption {
  id: string;
  name: string;
  asset_class: string;
  description: string | null;
  active: boolean;
}

interface Props {
  rules: RuleRow[];
  latestCycle: CycleRow | null;
  feeds: Feed[];
  canEdit?: boolean;
  pipelines: PipelineOption[];
  activePipelineId: string | null;
}

const TONE_CLASSES: Record<PipelineStage['tone'], { border: string; bg: string; text: string; dot: string }> = {
  slate: { border: 'border-slate-200', bg: 'bg-white', text: 'text-slate-700', dot: 'bg-slate-400' },
  emerald: { border: 'border-emerald-200', bg: 'bg-emerald-50/40', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  amber: { border: 'border-amber-200', bg: 'bg-amber-50/40', text: 'text-amber-700', dot: 'bg-amber-500' },
  rose: { border: 'border-rose-200', bg: 'bg-rose-50/40', text: 'text-rose-700', dot: 'bg-rose-500' },
  violet: { border: 'border-violet-200', bg: 'bg-violet-50/60', text: 'text-violet-700', dot: 'bg-violet-500' }
};

export function PipelineClient({
  rules,
  latestCycle,
  feeds,
  canEdit = false,
  pipelines,
  activePipelineId
}: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => PIPELINE_STAGES.find((s) => s.id === selectedId) ?? null, [selectedId]);
  const activePipeline = pipelines.find((p) => p.id === activePipelineId) ?? pipelines[0] ?? null;

  const switchPipeline = (name: string): void => {
    router.push(`/pipeline?pipeline=${encodeURIComponent(name)}`);
  };

  const active = rules.find((r) => r.active && r.name === 'default');
  const metrics = metricsFromCycle(latestCycle?.counts);
  const feedName = (id: string): string => feeds.find((f) => f.id === id)?.name ?? id.slice(0, 8);

  const summary = latestCycle?.counts ?? {};
  const high = summary.HIGH ?? 0;
  const medium = summary.MEDIUM ?? 0;
  const low = summary.LOW ?? 0;
  const totalMatches = summary.MATCHES ?? high + medium + low;
  const autoRate = totalMatches ? high / totalMatches : 0;

  return (
    <div className="space-y-6">
      {pipelines.length > 1 && (
        <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-mono mr-2">
            Pipeline
          </span>
          {pipelines.map((p) => {
            const isActive = p.id === activePipelineId;
            return (
              <button
                key={p.id}
                onClick={() => switchPipeline(p.name)}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-medium transition border',
                  isActive
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                )}
                aria-pressed={isActive}
              >
                <span>{p.name}</span>
                <span
                  className={cn(
                    'ml-2 font-mono text-[10px]',
                    isActive ? 'text-slate-300' : 'text-slate-400'
                  )}
                >
                  {p.asset_class}
                </span>
              </button>
            );
          })}
          {activePipeline?.description && (
            <span className="text-[11px] text-slate-500 ml-3 hidden md:inline">
              {activePipeline.description}
            </span>
          )}
        </div>
      )}
      {/* AI narrative header */}
      <Card className="border-violet-200 bg-violet-50/30">
        <CardContent className="py-4 flex items-start gap-3">
          <div className="h-8 w-8 shrink-0 rounded-full bg-violet-600 grid place-items-center">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider text-violet-700 font-medium">
                Pipeline summary
              </span>
              <AiAssistedBadge />
            </div>
            <p className="text-sm text-slate-800">
              Last matching cycle ran{' '}
              {latestCycle ? (
                <>
                  <span className="font-mono font-medium">{feedName(latestCycle.feed_a_id)}</span>{' '}
                  <ArrowRight className="inline h-3 w-3 mx-0.5 -mt-0.5" />{' '}
                  <span className="font-mono font-medium">{feedName(latestCycle.feed_b_id)}</span>{' '}
                  {formatDistanceToNow(new Date(latestCycle.started_at), { addSuffix: true })}
                </>
              ) : (
                <span className="italic">— no cycles yet</span>
              )}
              . Deterministic + probabilistic stages auto-resolved{' '}
              <span className="font-mono font-semibold text-emerald-700">{(autoRate * 100).toFixed(0)}%</span>{' '}
              of candidates at HIGH confidence ({high} matches). {medium} candidates landed in the MEDIUM band and received an LLM tiebreak; {low} were rejected on integrity-veto (quantity or price beyond tolerance).
            </p>
            <p className="text-xs text-slate-500">
              Active ruleset: <span className="font-mono text-slate-700">{active ? `${active.name} v${active.version}` : 'default v1'}</span>
              {' · '}AI seams running: <span className="font-mono text-slate-700">embedding</span>,{' '}
              <span className="font-mono text-slate-700">tiebreak</span>,{' '}
              <span className="font-mono text-slate-700">explain-break</span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Pipeline canvas */}
      <div className="relative">
        <div className="overflow-x-auto pb-3">
          <div className="flex items-stretch gap-0 min-w-max px-1 pb-1">
            {PIPELINE_STAGES.map((stage, i) => {
              const tone = TONE_CLASSES[stage.tone];
              const sm = metrics[stage.id];
              const isLast = i === PIPELINE_STAGES.length - 1;
              return (
                <div key={stage.id} className="flex items-center">
                  <StageCard
                    stage={stage}
                    tone={tone}
                    metrics={sm}
                    onClick={() => setSelectedId(stage.id)}
                  />
                  {!isLast && <StageArrow />}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Totals footer */}
      <div className="grid grid-cols-5 gap-3">
        {[
          ['Total pairs scored', totalMatches, 'slate'],
          ['HIGH band', high, 'emerald'],
          ['MEDIUM band', medium, 'amber'],
          ['LOW band / vetoed', low, 'rose'],
          ['Auto-match rate', `${(autoRate * 100).toFixed(0)}%`, 'emerald']
        ].map(([label, value, tone]) => (
          <Card key={String(label)} className={cn('border', TONE_CLASSES[tone as keyof typeof TONE_CLASSES].border)}>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{String(label)}</div>
              <div className="text-lg font-mono tabular-nums mt-1 text-slate-900">{String(value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* AI-proposed rule changes — learning loop from analyst adjudications */}
      <RuleDraftsCard canRun={canEdit} />

      {/* Expert mode — preset profiles + threshold editor + publish */}
      <ExpertMode
        active={
          active
            ? {
                version: active.version,
                tolerances: (active.tolerances as {
                  price_rel_tolerance?: number;
                  quantity_rel_tolerance?: number;
                  date_day_delta?: number;
                  bands?: { high_min: number; medium_min: number };
                  llm_tiebreak_band?: 'MEDIUM_ONLY' | 'ALL' | 'NONE';
                  preset?: string;
                }) ?? null
              }
            : null
        }
        canEdit={canEdit}
        onPublished={() => router.refresh()}
      />

      {/* Rule version history */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" />
            Ruleset versions
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-1.5 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-1.5 font-medium text-slate-600">Version</th>
                <th className="text-left px-4 py-1.5 font-medium text-slate-600">Active</th>
                <th className="text-left px-4 py-1.5 font-medium text-slate-600">Created</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={`${r.id}-${r.version}`} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-mono">{r.name}</td>
                  <td className="px-4 py-2 font-mono">v{r.version}</td>
                  <td className="px-4 py-2">
                    {r.active ? (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                        <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                        ACTIVE
                      </Badge>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500 font-mono">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Stage detail sheet */}
      <Sheet open={!!selected} onOpenChange={(v) => !v && setSelectedId(null)}>
        <SheetContent side="right" className="w-[520px] sm:w-[580px] overflow-auto">
          {selected && <StageDetail stage={selected} metrics={metrics[selected.id]} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StageCard({
  stage,
  tone,
  metrics,
  onClick
}: {
  stage: PipelineStage;
  tone: typeof TONE_CLASSES[keyof typeof TONE_CLASSES];
  metrics: ReturnType<typeof metricsFromCycle>[string] | undefined;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-56 shrink-0 text-left rounded-lg border transition hover:shadow-md active:scale-[0.99]',
        tone.border,
        tone.bg
      )}
    >
      <div className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
            <span className="text-[10px] uppercase tracking-wider font-mono text-slate-400">
              stage {stage.order}
            </span>
          </div>
          {stage.aiDriven && <AiAssistedBadge />}
        </div>
        <div className="mt-1">
          <div className={cn('font-medium text-sm', tone.text)}>{stage.name}</div>
          <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{stage.shortDesc}</div>
        </div>
        <div className="mt-3 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <Cpu className="h-2.5 w-2.5 text-slate-400" />
            <span className="text-slate-500">
              {stage.algorithms.filter((a) => a.enabled).length}/{stage.algorithms.length} algos
            </span>
          </div>
          {metrics && (
            <div className="text-[10px] font-mono text-slate-500 mt-1 tabular-nums">
              in <span className="text-slate-900">{metrics.input_pairs}</span> · out{' '}
              <span className="text-slate-900">{metrics.output_pairs}</span>
              {metrics.matches_produced > 0 && (
                <> · <span className="text-emerald-600">{metrics.matches_produced} match</span></>
              )}
              {metrics.exceptions_produced > 0 && (
                <> · <span className="text-amber-600">{metrics.exceptions_produced} exc</span></>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function StageArrow() {
  return (
    <div className="flex items-center shrink-0 px-2">
      <ArrowRight className="h-4 w-4 text-slate-300" />
    </div>
  );
}

function StageDetail({
  stage,
  metrics
}: {
  stage: PipelineStage;
  metrics: ReturnType<typeof metricsFromCycle>[string] | undefined;
}) {
  const tone = TONE_CLASSES[stage.tone];
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-mono">
            stage {stage.order} /{PIPELINE_STAGES.length}
          </span>
          <span>·</span>
          <span className={tone.text}>{stage.name}</span>
          {stage.aiDriven && <AiAssistedBadge />}
        </SheetTitle>
      </SheetHeader>
      <div className="mt-5 space-y-5 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400 font-mono mb-1">Purpose</div>
          <p className="text-slate-700">{stage.longDesc}</p>
        </div>

        {metrics && (
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400 font-mono mb-2">Last cycle metrics</div>
            <div className="grid grid-cols-4 gap-2">
              <Metric label="In" value={metrics.input_pairs} />
              <Metric label="Out" value={metrics.output_pairs} />
              <Metric label="Matches produced" value={metrics.matches_produced} tone="emerald" />
              <Metric label="Exceptions produced" value={metrics.exceptions_produced} tone="amber" />
            </div>
          </div>
        )}

        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400 font-mono mb-2">Algorithms</div>
          <div className="space-y-1.5">
            {stage.algorithms.map((alg) => (
              <div
                key={alg.id}
                className={cn(
                  'rounded border px-3 py-2 flex items-start gap-3 transition',
                  alg.enabled ? 'border-slate-200 bg-white' : 'border-dashed border-slate-200 bg-slate-50/50'
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 h-3.5 w-3.5 rounded-full border-2 grid place-items-center shrink-0',
                    alg.enabled
                      ? alg.ai
                        ? 'border-violet-500 bg-violet-500'
                        : 'border-emerald-500 bg-emerald-500'
                      : 'border-slate-300 bg-white'
                  )}
                >
                  {alg.enabled && <CheckCircle2 className="h-2 w-2 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-slate-800">{alg.name}</span>
                    {alg.ai && <AiAssistedBadge model={alg.model} />}
                    {alg.roadmap && (
                      <Badge variant="outline" className="text-[9px] uppercase bg-slate-50 border-slate-200 text-slate-500">
                        roadmap
                      </Badge>
                    )}
                    {alg.appliesTo && (
                      <Badge variant="outline" className="text-[9px] font-mono bg-slate-50">
                        {alg.appliesTo}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{alg.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {stage.configKey && (
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-start gap-2 text-[11px] text-slate-600">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              <span>
                Configuration for this stage lives in the active <span className="font-mono">matching_rules</span> row.
                Changes create a new version; the previous remains queryable. Manager role can propose and activate.
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Metric({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'emerald' | 'amber' }) {
  const classes = {
    slate: 'border-slate-200 text-slate-900',
    emerald: 'border-emerald-200 text-emerald-700',
    amber: 'border-amber-200 text-amber-700'
  }[tone];
  return (
    <div className={cn('rounded border bg-white p-2', classes)}>
      <div className="text-[9px] uppercase tracking-wider text-slate-400 font-mono">{label}</div>
      <div className="text-base font-mono tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
