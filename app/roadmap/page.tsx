import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Circle, Clock, ArrowRight, Map } from 'lucide-react';

type Status = 'shipped' | 'in_progress' | 'planned';

interface RoadmapItem {
  title: string;
  description: string;
  status: Status;
  adr?: string;
  rationale?: string;
}

interface Phase {
  phase: string;
  heading: string;
  blurb: string;
  items: RoadmapItem[];
}

const PHASES: Phase[] = [
  {
    phase: 'Phase 0',
    heading: 'MVP — Equities cash settlement',
    blurb: 'Two-party reconciliation with full audit + AI leverage. Shipped.',
    items: [
      {
        title: 'Canonical trade schema + feed profile versioning',
        description: 'Zod at every boundary. Field mappings versioned; profiles never mutated.',
        status: 'shipped'
      },
      {
        title: 'Seven-stage matching engine',
        description:
          'normalize → deterministic hash → blocking → field similarity ensemble → Fellegi-Sunter posterior → Hungarian 1:1 → LLM tiebreak on MEDIUM band.',
        status: 'shipped',
        adr: 'docs/MATCHING_ENGINE.md'
      },
      {
        title: 'Exception Management workspace',
        description:
          'Queue + Compare pane + scoring breakdown + AI explanation. Keyboard-first (A / R / E / J / K). RLS-gated by role.',
        status: 'shipped'
      },
      {
        title: 'Neo4j entity graph for counterparty & security master',
        description: 'Alias resolution, subsidiary traversal, ISIN/CUSIP cross-reference. One graph query per unique cpty per cycle, cached.',
        status: 'shipped',
        adr: 'ADR-009'
      },
      {
        title: 'Eval harness (hand-labelled gold set)',
        description: '33 pairs · precision / recall / F1 per band + per class · Run Evals button on /dashboard.',
        status: 'shipped'
      },
      {
        title: 'Append-only audit log + versioned configs',
        description: 'Every state change writes audit_events. feed_profiles / field_mappings / matching_rules are insert-only; new versions created, never mutated.',
        status: 'shipped'
      },
      {
        title: 'AI is bounded to 6 seams',
        description: 'schema inference · cpty embedding · MEDIUM-band tiebreak · exception explanation · next-best-action · pipeline suggester.',
        status: 'shipped',
        adr: 'ADR-012 / ADR-012b'
      }
    ]
  },
  {
    phase: 'Phase 1',
    heading: 'Per-asset-class pipelines — just shipped',
    blurb: 'Pipeline profiles. Tolerances, bands, blocking keys, stage enablement, match types, LLM tiebreak band — all flow DB → engine.',
    items: [
      {
        title: 'Pipelines: Equities / FX / Fixed Income seeded',
        description:
          'Each with its own matching_rules row: blocking keys, tolerances, bands, enabled stages. FI blocks on ISIN; FX skips hash; equities is the default.',
        status: 'shipped',
        adr: 'ADR-012b',
        rationale:
          'Same 7 stages are a universal backbone; what varies per asset class is the configuration of each stage, not whether each exists.'
      },
      {
        title: 'AI Pipeline Suggester (6th seam)',
        description:
          'Given a feed mapping + asset-class hint + sample rows, GPT proposes tolerances + bands + blocking keys + enabled stages + match types with per-field rationale and warnings.',
        status: 'shipped',
        rationale:
          'AI proposes a first-draft config; analyst reviews + publishes through the existing versioned-rules flow. AI never tunes m/u priors — those stay human-owned for safety.'
      },
      {
        title: '"Create new pipeline" UI',
        description: 'Managers can add a new pipeline + seed its matching_rules row in one call. Manager-role-only, audit-logged.',
        status: 'shipped'
      }
    ]
  },
  {
    phase: 'Phase 2',
    heading: 'Allocation + netting (1:N / N:M) — next',
    blurb: 'Full many-to-many matching. Currently config stamps intent; engine still emits 1:1.',
    items: [
      {
        title: '1:N allocation breaks via pre-aggregation',
        description:
          'Group side-B by (symbol, trade_date, direction, account) before matching; synthesize virtual aggregated trade with summed qty + weighted-avg price. Run Hungarian 1:1 on the aggregated view. Persist child legs via a new match_legs table.',
        status: 'planned',
        rationale:
          'Hungarian is 1:1 by mathematical definition. Pre-aggregation keeps the proven matcher and adds allocation support with zero changes to the existing 1:1 flow.'
      },
      {
        title: 'N:M netting (custodian cash bucketing)',
        description: 'N internal trades ↔ M custodian net movements. Bipartite b-matching on a cost matrix with coverage constraints.',
        status: 'planned'
      },
      {
        title: 'ComparePane UI: parent + legs',
        description: 'Render A-vs-[B,B\u2032,B\u2033] with a summary header and per-leg rows. Analyst actions apply at the parent level, audit captures every leg.',
        status: 'planned'
      }
    ]
  },
  {
    phase: 'Phase 3',
    heading: 'Ingestion expansion',
    blurb: 'Beyond CSV / XLSX.',
    items: [
      {
        title: 'PDF statement ingestion via Docling',
        description: 'Broker confirms + custodian statements. Structured extraction with human-in-the-loop for low-confidence pages.',
        status: 'planned',
        rationale:
          'Docling interface stubbed in MVP, not wired. Most cost is on the ingestion side; the matching engine is format-agnostic.'
      },
      {
        title: 'SWIFT MT message parser',
        description: 'MT54x / MT94x settlement + statement messages. Block-level parse → canonical_trade.',
        status: 'planned'
      },
      {
        title: 'FIX drop-copy ingestion',
        description: 'Real-time drop-copy feed for T+0 monitoring.',
        status: 'planned'
      }
    ]
  },
  {
    phase: 'Phase 4',
    heading: 'Corporate actions + positions',
    blurb: 'Moving up the stack.',
    items: [
      {
        title: 'Position reconciliation (EOD vs custodian)',
        description: 'Same canonical pattern, different schema. Positions table + effective-dated matching.',
        status: 'planned'
      },
      {
        title: 'Corporate actions ingestion + impact propagation',
        description:
          'Splits / dividends / mergers automatically update the canonical trade set and re-reconcile affected exceptions.',
        status: 'planned'
      },
      {
        title: 'Cash reconciliation',
        description:
          'Same canonical pattern, different schema (cash transactions instead of trades). Reuses the same 7-stage engine, same Neo4j entity graph, different tolerance profile on timing + amount.',
        status: 'planned'
      }
    ]
  },
  {
    phase: 'Phase 5',
    heading: 'Auto-learning + scale',
    blurb: 'Close the eval-driven loop.',
    items: [
      {
        title: 'Rule draft auto-promotion',
        description:
          'Today: rule drafts appear as suggestions on /pipeline. Next: manager approves → auto-promote to a new matching_rules version with an eval delta chart. Block promotion if precision/recall regresses.',
        status: 'planned'
      },
      {
        title: 'LSH / MinHash blocking for 10M+ trades',
        description: 'Current blocking handles ~100k pairs well; above that, the O(n²) within-block cost dominates. Locality-sensitive hashing makes it sub-linear.',
        status: 'planned'
      },
      {
        title: 'Multi-party reconciliation (3+ parties)',
        description: 'Beyond internal vs broker: internal + broker + custodian triangle. N-way matching is a simplicial assignment problem.',
        status: 'planned'
      }
    ]
  }
];

const STATUS_MAP: Record<Status, { icon: typeof CheckCircle2; label: string; cls: string }> = {
  shipped: {
    icon: CheckCircle2,
    label: 'Shipped',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  },
  in_progress: {
    icon: Clock,
    label: 'In progress',
    cls: 'bg-amber-50 text-amber-700 border-amber-200'
  },
  planned: {
    icon: Circle,
    label: 'Planned',
    cls: 'bg-slate-50 text-slate-600 border-slate-200'
  }
};

export default function RoadmapPage(): React.ReactElement {
  return (
    <AppShell>
      <div className="w-full px-6 xl:px-8 2xl:px-10 py-6 max-w-5xl space-y-6">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400 font-mono">
            <Map className="h-3 w-3" />
            Product Roadmap
          </div>
          <h1 className="text-xl font-semibold text-slate-900 mt-1">Where this is going</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-3xl">
            The 7-stage matching engine is a universal backbone. Each phase below extends its reach — new
            asset classes, new input formats, new match cardinalities — without rewriting what&apos;s
            underneath.
          </p>
        </div>

        <div className="space-y-5">
          {PHASES.map((p) => (
            <Card key={p.phase} className="border-slate-200">
              <CardHeader className="pb-3">
                <div className="flex items-baseline gap-3">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-mono">
                    {p.phase}
                  </span>
                  <CardTitle className="text-base">{p.heading}</CardTitle>
                </div>
                <p className="text-sm text-slate-500 mt-1">{p.blurb}</p>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-3">
                  {p.items.map((item) => {
                    const s = STATUS_MAP[item.status];
                    const StatusIcon = s.icon;
                    return (
                      <div
                        key={item.title}
                        className="flex items-start gap-3 rounded-md border border-slate-200 p-3 bg-white"
                      >
                        <StatusIcon
                          className={`h-4 w-4 shrink-0 mt-0.5 ${
                            item.status === 'shipped'
                              ? 'text-emerald-600'
                              : item.status === 'in_progress'
                                ? 'text-amber-600'
                                : 'text-slate-300'
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="font-medium text-sm text-slate-900">{item.title}</div>
                            <Badge variant="outline" className={`text-[10px] font-mono ${s.cls}`}>
                              {s.label}
                            </Badge>
                            {item.adr && (
                              <span className="text-[10px] font-mono text-slate-400">{item.adr}</span>
                            )}
                          </div>
                          <p className="text-[12px] text-slate-600 mt-1 leading-relaxed">
                            {item.description}
                          </p>
                          {item.rationale && (
                            <p className="text-[11px] text-slate-500 mt-1.5 italic leading-relaxed">
                              Why: {item.rationale}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-slate-50 border-slate-200">
          <CardContent className="pt-5">
            <div className="flex items-start gap-3">
              <ArrowRight className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
              <div className="text-sm text-slate-600">
                <span className="font-medium text-slate-900">Operating principle:</span> every phase adds
                reach without breaking the audit model or the versioned-config contract.{' '}
                <span className="font-mono text-xs bg-white border border-slate-200 px-1.5 py-0.5 rounded">
                  docs/DECISIONS_LOG.md
                </span>{' '}
                is the append-only record of every material architectural choice with its rationale + the
                alternatives rejected.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
