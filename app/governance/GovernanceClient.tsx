'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { GUARDRAILS, type Guardrail } from '@/lib/governance/rules';
import {
  ShieldCheck,
  Lock,
  Database,
  Cpu,
  Users,
  FileLock2,
  CheckCircle2,
  Info
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface RuleRow {
  id: string;
  name: string;
  version: number;
  active: boolean;
  weights: unknown;
  tolerances: unknown;
  created_at: string;
}

interface AiCallRow {
  call_type: string;
  model: string;
  fallback_used: boolean;
  created_at: string;
}

interface AuditRow {
  action: string;
  created_at: string;
}

interface Props {
  rules: RuleRow[];
  aiCalls: AiCallRow[];
  auditStats: AuditRow[];
}

const CATEGORY_ICON = {
  AI: Cpu,
  MATCHING: ShieldCheck,
  AUDIT: FileLock2,
  RBAC: Users,
  DATA: Database
} as const;

const CATEGORY_TONE: Record<Guardrail['category'], string> = {
  AI: 'border-violet-200 bg-violet-50/40 text-violet-700',
  MATCHING: 'border-slate-200 bg-white text-slate-700',
  AUDIT: 'border-emerald-200 bg-emerald-50/40 text-emerald-700',
  RBAC: 'border-blue-200 bg-blue-50/40 text-blue-700',
  DATA: 'border-amber-200 bg-amber-50/40 text-amber-700'
};

export function GovernanceClient({ rules, aiCalls, auditStats }: Props) {
  const active = rules.find((r) => r.active && r.name === 'default');
  const [filter, setFilter] = useState<'all' | Guardrail['category']>('all');

  const visibleGuardrails = useMemo(
    () => (filter === 'all' ? GUARDRAILS : GUARDRAILS.filter((g) => g.category === filter)),
    [filter]
  );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        {/* Posture header */}
        <Card className="border-emerald-200 bg-emerald-50/20">
          <CardContent className="py-4 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-emerald-600 grid place-items-center">
                <ShieldCheck className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-emerald-700 font-medium">Active posture</div>
                <div className="text-sm text-slate-800 mt-0.5">
                  Ruleset <span className="font-mono font-medium">{active ? `${active.name} v${active.version}` : '—'}</span>
                  {' · '}
                  <span className="font-mono">{GUARDRAILS.filter((g) => g.enforcedAt === 'CODE').length} code-enforced</span>
                  {' · '}
                  <span className="font-mono">{GUARDRAILS.filter((g) => g.enforcedAt === 'DATABASE').length} DB-enforced</span>
                  {' · '}
                  <span className="font-mono">{GUARDRAILS.filter((g) => g.enforcedAt === 'CONFIG').length} configurable</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 ml-auto text-xs text-slate-600">
              <span>{auditStats.length}+ audited state changes</span>
              <span>·</span>
              <span>{aiCalls.length}+ AI calls tracked</span>
              <span>·</span>
              <span>
                Last rule change{' '}
                <span className="font-mono">
                  {active ? formatDistanceToNow(new Date(active.created_at), { addSuffix: true }) : '—'}
                </span>
              </span>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="guardrails">
          <TabsList className="grid grid-cols-2 w-full max-w-md">
            <TabsTrigger value="guardrails">Guardrails</TabsTrigger>
            <TabsTrigger value="rules">Rule Versions</TabsTrigger>
          </TabsList>

          {/* Guardrails */}
          <TabsContent value="guardrails" className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              {(['all', 'AI', 'MATCHING', 'AUDIT', 'RBAC', 'DATA'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'text-[11px] px-2.5 py-1 rounded border transition font-mono uppercase tracking-wider',
                    filter === f ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 hover:bg-slate-50'
                  )}
                >
                  {f === 'all' ? 'All' : f}
                </button>
              ))}
              <span className="text-[11px] text-slate-400 ml-auto font-mono">
                {visibleGuardrails.length} / {GUARDRAILS.length} shown
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {visibleGuardrails.map((g) => {
                const Icon = CATEGORY_ICON[g.category];
                return (
                  <Card key={g.id} className={cn('border', CATEGORY_TONE[g.category])}>
                    <CardContent className="py-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5" />
                          <span className="text-sm font-medium text-slate-900">{g.name}</span>
                        </div>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-3 w-3 text-slate-400 hover:text-slate-600" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">{g.rationale}</TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="text-xs text-slate-700 font-mono">{g.currentValue}</div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                        <Badge variant="outline" className="text-[9px] bg-white">
                          <Lock className="h-2.5 w-2.5 mr-0.5" />
                          {g.enforcedAt}
                        </Badge>
                        {g.canEdit ? (
                          <Badge variant="outline" className="text-[9px] bg-white">
                            editable · {g.editableBy}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] bg-white border-slate-300 text-slate-500">
                            immutable via UI
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* Rule Versions */}
          <TabsContent value="rules" className="space-y-3">
            <p className="text-xs text-slate-500 max-w-3xl">
              Every configuration change to matching rules creates a new version. Old versions stay queryable for
              reproducibility of past matching cycles. Only <code className="font-mono bg-slate-100 px-1 rounded">manager</code>{' '}
              can activate a new version.
            </p>
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-slate-600">Name</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-600">Version</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-600">Active</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-600">Created</th>
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
                              <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> ACTIVE
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
                    {rules.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                          No rule versions yet. Seed runs <code className="font-mono">pnpm seed:all</code>.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </div>
    </TooltipProvider>
  );
}
