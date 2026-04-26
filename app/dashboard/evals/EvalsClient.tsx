'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { FlaskConical, CheckCircle2, XCircle, TrendingUp, Play, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface PerBand {
  n: number;
  f1: number;
  recall: number;
  precision: number;
}

interface EvalRun {
  id: string;
  gold_set_version: string;
  precision_score: string;
  recall_score: string;
  f1_score: string;
  per_band: { HIGH: PerBand; MEDIUM: PerBand; LOW: PerBand };
  per_class: Record<string, { n: number; f1: number; recall: number; precision: number }>;
  confusion: { tp: number; fp: number; tn: number; fn: number };
  model_version: string;
  matching_rules_version: number;
  created_at: string;
}

function f1Color(f1: number) {
  if (f1 >= 0.9) return 'text-emerald-600';
  if (f1 >= 0.75) return 'text-amber-600';
  return 'text-red-500';
}

function BandRow({ label, band, color }: { label: string; band: PerBand; color: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className={cn('w-2 h-2 rounded-full shrink-0', color)} />
      <span className="text-sm text-slate-700 w-16 font-mono">{label}</span>
      <span className="text-xs text-slate-500 w-6 text-right">{band.n}</span>
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-violet-400 rounded-full" style={{ width: `${band.f1 * 100}%` }} />
      </div>
      <span className={cn('text-sm font-semibold w-10 text-right tabular-nums', f1Color(band.f1))}>
        {band.f1 > 0 ? band.f1.toFixed(2) : '—'}
      </span>
    </div>
  );
}

export function EvalsClient({ initialRuns }: { initialRuns: EvalRun[] }) {
  const [runs, setRuns] = useState<EvalRun[]>(initialRuns);
  const [selected, setSelected] = useState<EvalRun | null>(initialRuns[0] ?? null);
  const [running, setRunning] = useState(false);

  const runEvals = async () => {
    setRunning(true);
    try {
      await fetch('/api/eval/run', { method: 'POST' });
      const res = await fetch('/api/eval/runs');
      if (res.ok) {
        const data = await res.json();
        const list: EvalRun[] = data.runs ?? [];
        setRuns(list);
        if (list.length > 0) setSelected(list[0] ?? null);
      }
    } finally {
      setRunning(false);
    }
  };

  const latest = selected ?? runs[0] ?? null;

  return (
    <div className="px-6 xl:px-8 py-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <Link href="/dashboard" className="hover:text-slate-700">Dashboard</Link>
            <ChevronRight className="h-3 w-3" />
            <span>Evals</span>
          </div>
          <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-violet-600" />
            Evaluation Harness
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            30-pair gold set · precision / recall / F1 per confidence band
          </p>
        </div>
        <Button onClick={runEvals} disabled={running} size="sm" className="gap-2">
          <Play className="h-3.5 w-3.5" />
          {running ? 'Running…' : 'Run Evals'}
        </Button>
      </div>

      {latest && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="border-slate-200">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-slate-500 uppercase tracking-wide">Overall F1</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className={cn('text-4xl font-bold tabular-nums', f1Color(parseFloat(latest.f1_score)))}>
                {parseFloat(latest.f1_score).toFixed(3)}
              </div>
              <div className="text-xs text-slate-400 mt-1">target ≥ 0.85</div>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-slate-500 uppercase tracking-wide">Precision</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className={cn('text-4xl font-bold tabular-nums', f1Color(parseFloat(latest.precision_score)))}>
                {parseFloat(latest.precision_score).toFixed(3)}
              </div>
              <div className="text-xs text-slate-400 mt-1">TP / (TP + FP)</div>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-slate-500 uppercase tracking-wide">Recall</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className={cn('text-4xl font-bold tabular-nums', f1Color(parseFloat(latest.recall_score)))}>
                {parseFloat(latest.recall_score).toFixed(3)}
              </div>
              <div className="text-xs text-slate-400 mt-1">TP / (TP + FN)</div>
            </CardContent>
          </Card>
        </div>
      )}

      {latest && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border-slate-200">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm font-semibold text-slate-700">F1 by Confidence Band</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <BandRow label="HIGH" band={latest.per_band.HIGH} color="bg-emerald-500" />
              <BandRow label="MEDIUM" band={latest.per_band.MEDIUM} color="bg-amber-400" />
              <BandRow label="LOW" band={latest.per_band.LOW} color="bg-red-400" />
              <Separator className="my-3" />
              <p className="text-xs text-slate-400">n = gold pairs in band · bar = F1 score</p>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-sm font-semibold text-slate-700">Confusion Matrix</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="grid grid-cols-2 gap-2 max-w-xs mx-auto">
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-center">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 mx-auto mb-1" />
                  <div className="text-2xl font-bold text-emerald-700">{latest.confusion.tp}</div>
                  <div className="text-xs text-emerald-600 font-medium">True Positive</div>
                </div>
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-center">
                  <XCircle className="h-4 w-4 text-red-400 mx-auto mb-1" />
                  <div className="text-2xl font-bold text-red-500">{latest.confusion.fp}</div>
                  <div className="text-xs text-red-500 font-medium">False Positive</div>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-center">
                  <XCircle className="h-4 w-4 text-slate-400 mx-auto mb-1" />
                  <div className="text-2xl font-bold text-slate-600">{latest.confusion.fn}</div>
                  <div className="text-xs text-slate-500 font-medium">False Negative</div>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-center">
                  <CheckCircle2 className="h-4 w-4 text-slate-400 mx-auto mb-1" />
                  <div className="text-2xl font-bold text-slate-600">{latest.confusion.tn}</div>
                  <div className="text-xs text-slate-500 font-medium">True Negative</div>
                </div>
              </div>
              <p className="text-xs text-slate-400 text-center mt-3">
                model: {latest.model_version} · rules v{latest.matching_rules_version}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {latest && (
        <Card className="border-slate-200">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700">F1 by Exception Class</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Object.entries(latest.per_class).map(([cls, val]) => (
                <div key={cls} className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-3 py-2">
                  <div>
                    <div className="text-xs font-mono text-slate-600">{cls}</div>
                    <div className="text-xs text-slate-400">n={val.n}</div>
                  </div>
                  <div className={cn('text-base font-bold tabular-nums', f1Color(val.f1))}>
                    {val.f1 > 0 ? val.f1.toFixed(2) : '—'}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200">
        <CardHeader className="px-4 pt-4 pb-2">
          <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Run History
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {runs.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-slate-400">
              No eval runs yet. Click <strong>Run Evals</strong> to start.
            </div>
          )}
          {runs.map((run, i) => (
            <button
              key={run.id}
              onClick={() => setSelected(run)}
              className={cn(
                'w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-slate-50 transition-colors border-t border-slate-100',
                selected?.id === run.id && 'bg-violet-50'
              )}
            >
              <div className="shrink-0 w-12">
                {i === 0 && <Badge variant="secondary" className="text-xs">latest</Badge>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-500 font-mono">{new Date(run.created_at).toLocaleString()}</div>
                <div className="text-xs text-slate-400">gold: {run.gold_set_version} · model: {run.model_version}</div>
              </div>
              <div className="flex gap-4 text-right tabular-nums shrink-0">
                <div><div className="text-xs text-slate-400">P</div><div className="text-sm font-semibold text-slate-700">{parseFloat(run.precision_score).toFixed(2)}</div></div>
                <div><div className="text-xs text-slate-400">R</div><div className="text-sm font-semibold text-slate-700">{parseFloat(run.recall_score).toFixed(2)}</div></div>
                <div><div className="text-xs text-slate-400">F1</div><div className={cn('text-sm font-bold', f1Color(parseFloat(run.f1_score)))}>{parseFloat(run.f1_score).toFixed(2)}</div></div>
              </div>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
