'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AiAssistedBadge } from '@/components/shared/AiAssistedBadge';
import { Sparkles, Lightbulb, ArrowUpRight, CheckCircle2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { RuleDraft } from '@/lib/ai/prompts/rule-drafts';

interface Props {
  canRun: boolean;
}

const KNOB_LABELS: Record<RuleDraft['recommended_config_change']['knob'], string> = {
  band_high_threshold: 'HIGH band threshold',
  band_medium_threshold: 'MEDIUM band floor',
  price_tolerance: 'Price tolerance',
  quantity_tolerance: 'Quantity tolerance',
  date_delta: 'Date delta',
  counterparty_alias_add: 'Add counterparty alias',
  none: 'No config change'
};

const DIRECTION_COLOR: Record<RuleDraft['recommended_config_change']['direction'], string> = {
  raise: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  lower: 'bg-amber-50 text-amber-700 border-amber-200',
  add: 'bg-violet-50 text-violet-700 border-violet-200',
  none: 'bg-slate-50 text-slate-500 border-slate-200'
};

export function RuleDraftsCard({ canRun }: Props): React.ReactElement {
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<RuleDraft[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [patternsObserved, setPatternsObserved] = useState<number | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/rule-drafts', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'rule-drafts call failed');
      const data = await res.json();
      setDrafts(data.drafts ?? []);
      setSummary(data.summary ?? null);
      setPatternsObserved(data.patterns_observed ?? 0);
      toast.success(
        (data.drafts?.length ?? 0) > 0
          ? `${data.drafts.length} rule draft${data.drafts.length === 1 ? '' : 's'} proposed`
          : 'No proposals — not enough analyst data yet'
      );
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-violet-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-violet-600" />
          AI-proposed rule changes
          <AiAssistedBadge />
          {patternsObserved !== null && (
            <Badge variant="outline" className="text-[10px] ml-1">
              {patternsObserved} pattern{patternsObserved === 1 ? '' : 's'} observed
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7"
            onClick={run}
            disabled={loading || !canRun}
          >
            <Sparkles className="h-3 w-3 mr-1.5" />
            {loading ? 'Analyzing…' : drafts ? 'Re-analyze' : 'Analyze resolution patterns'}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-500">
          An AI model scans the last 30 days of <span className="font-mono">resolution_actions</span> for patterns where
          analysts agree &gt;80% of the time. Only high-confidence, non-risk-critical knobs are proposed; no rule auto-publishes — manager still clicks Apply.
        </p>

        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {!loading && summary && (
          <p className="text-xs text-slate-600 italic border-l-2 border-violet-200 pl-2">{summary}</p>
        )}

        {!loading && drafts && drafts.length === 0 && (
          <div className="rounded border border-dashed border-slate-200 bg-slate-50/40 p-4 text-center text-xs text-slate-500">
            <Info className="h-4 w-4 mx-auto mb-1 text-slate-400" />
            No rule drafts proposed. This is expected early — the AI needs ≥5 analyst adjudications per pattern with strong agreement before it suggests anything.
          </div>
        )}

        {!loading && drafts && drafts.length > 0 && (
          <div className="space-y-2">
            {drafts.map((d, i) => (
              <DraftCard key={i} draft={d} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DraftCard({ draft }: { draft: RuleDraft }): React.ReactElement {
  return (
    <Card className="border-slate-200">
      <CardContent className="py-3 space-y-2">
        <div className="flex items-start gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] font-mono">
            {draft.exception_class}
          </Badge>
          <Badge variant="outline" className={cn('text-[10px]', DIRECTION_COLOR[draft.recommended_config_change.direction])}>
            {draft.recommended_config_change.direction.toUpperCase()} · {KNOB_LABELS[draft.recommended_config_change.knob]}
          </Badge>
          <span className="text-[10px] text-slate-500 font-mono ml-auto tabular-nums">
            conf {draft.confidence.toFixed(2)} · n={draft.observed_count} · accept {(draft.analyst_accept_rate * 100).toFixed(0)}%
          </span>
        </div>

        <p className="text-sm text-slate-800 font-medium">{draft.proposal}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="rounded border border-slate-200 bg-slate-50/30 p-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Pattern</div>
            <div className="mt-0.5 text-slate-700">{draft.pattern}</div>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50/30 p-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Expected impact</div>
            <div className="mt-0.5 text-slate-700">{draft.expected_impact}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            disabled
            title="Manual apply on the Expert Mode card below — preserves manager-approval posture"
          >
            <ArrowUpRight className="h-3 w-3 mr-1" />
            Review in Expert Mode
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled>
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Dismiss
          </Button>
          {draft.recommended_config_change.detail && (
            <span className="text-[10px] text-slate-400 font-mono ml-auto">
              {draft.recommended_config_change.detail}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
