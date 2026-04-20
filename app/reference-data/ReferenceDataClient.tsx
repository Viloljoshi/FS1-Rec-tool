'use client';

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Network, Building2, Users, Database, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Entity {
  id: string;
  canonical_name: string;
  lei: string | null;
  sec_crd: string | null;
  country: string | null;
}

interface Cluster {
  entity: Entity;
  aliases: string[];
  subsidiaries: Entity[];
}

export function ReferenceDataClient({ initial }: { initial: Entity[] }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Entity[]>(initial);
  const [selected, setSelected] = useState<Entity | null>(initial[0] ?? null);
  const [cluster, setCluster] = useState<Cluster | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const run = async () => {
      if (!query.trim()) {
        setResults(initial);
        return;
      }
      const res = await fetch(`/api/kg/search?q=${encodeURIComponent(query)}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.results ?? []);
      }
    };
    const t = setTimeout(run, 200);
    return () => clearTimeout(t);
  }, [query, initial]);

  useEffect(() => {
    if (!selected) {
      setCluster(null);
      return;
    }
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/kg/cluster/${selected.id}`);
        if (res.ok) {
          const data = await res.json();
          setCluster(data);
        } else {
          setCluster(null);
        }
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [selected]);

  const graphPreview = useMemo(() => {
    if (!cluster) return null;
    return {
      center: cluster.entity,
      aliases: cluster.aliases,
      subsidiaries: cluster.subsidiaries
    };
  }, [cluster]);

  const examples = ['Goldman', 'JPM', 'Jane', 'Barclays', 'Morgan Stanley', 'Virtu'];

  return (
    <div className="grid grid-cols-[320px_1fr] gap-6">
      <div className="space-y-3">
        <div className="rounded border border-violet-200 bg-violet-50/40 p-3 text-[11px] text-slate-700 space-y-1.5">
          <div className="font-semibold text-violet-900 flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5" /> What is this?
          </div>
          <p>
            The counterparty & security master as a Neo4j graph. Every alias, subsidiary, LEI, and SEC
            CRD is a first-class edge. The matching engine calls this graph at scoring time to resolve
            variations like <span className="font-mono">&ldquo;GS &amp; Co&rdquo;</span> →{' '}
            <span className="font-mono">Goldman Sachs &amp; Co. LLC</span>.
          </p>
          <p>
            <span className="font-semibold">How to use:</span> search by any fragment of a canonical
            name. Click a result to see its full alias cluster, corporate relationships, and the exact
            graph neighborhood the reconciler walks.
          </p>
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search entity (e.g. JPM, Goldman)"
        />
        <div className="flex flex-wrap gap-1">
          {examples.map((ex) => (
            <button
              key={ex}
              onClick={() => setQuery(ex)}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-100 hover:border-slate-300"
            >
              {ex}
            </button>
          ))}
        </div>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4" />
              Results ({results.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100 max-h-[60vh] overflow-auto">
              {results.map((e) => (
                <li
                  key={e.id}
                  onClick={() => setSelected(e)}
                  className={cn(
                    'cursor-pointer px-3 py-2 text-xs',
                    selected?.id === e.id ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'
                  )}
                >
                  <div className="font-medium">{e.canonical_name}</div>
                  <div className={cn('font-mono text-[10px] mt-0.5', selected?.id === e.id ? 'text-slate-300' : 'text-slate-500')}>
                    {e.sec_crd ? `CRD ${e.sec_crd}` : e.lei ?? 'no identifier'} · {e.country ?? '—'}
                  </div>
                </li>
              ))}
              {results.length === 0 && (
                <li className="px-3 py-6 text-xs text-slate-400 text-center">No matches</li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {loading && <p className="text-xs text-slate-500">Querying Neo4j…</p>}
        {cluster && graphPreview && (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  {cluster.entity.canonical_name}
                  <Badge variant="outline" className="text-[10px] font-mono ml-auto">
                    {cluster.entity.sec_crd ? `CRD ${cluster.entity.sec_crd}` : 'no CRD'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <div className="text-slate-500 uppercase tracking-wider text-[10px]">LEI</div>
                    <div className="font-mono mt-0.5">{cluster.entity.lei ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 uppercase tracking-wider text-[10px]">SEC CRD</div>
                    <div className="font-mono mt-0.5">{cluster.entity.sec_crd ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 uppercase tracking-wider text-[10px]">Country</div>
                    <div className="font-mono mt-0.5">{cluster.entity.country ?? '—'}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Aliases ({cluster.aliases.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {cluster.aliases.map((a) => (
                      <Badge key={a} variant="outline" className="font-mono text-[10px]">
                        {a}
                      </Badge>
                    ))}
                    {cluster.aliases.length === 0 && (
                      <p className="text-xs text-slate-400">No alias variants recorded.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Network className="h-4 w-4" />
                    Subsidiary / Parent ({cluster.subsidiaries.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-xs space-y-1">
                    {cluster.subsidiaries.map((s) => (
                      <li key={s.id} className="flex items-center gap-1.5">
                        <ExternalLink className="h-3 w-3 text-slate-400" />
                        <span className="font-mono">{s.canonical_name}</span>
                      </li>
                    ))}
                    {cluster.subsidiaries.length === 0 && (
                      <p className="text-slate-400">No recorded relationships.</p>
                    )}
                  </ul>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Graph preview</CardTitle>
              </CardHeader>
              <CardContent>
                <SvgGraph center={graphPreview.center} aliases={graphPreview.aliases} subsidiaries={graphPreview.subsidiaries} />
                <p className="text-[11px] text-slate-500 mt-2">
                  Rendered from a live Cypher query against Neo4j AuraDB. The matching engine resolves
                  <span className="font-mono"> counterparty_canonical_id </span> via the same graph.
                </p>
              </CardContent>
            </Card>
          </>
        )}
        {!cluster && !loading && (
          <Card>
            <CardContent className="py-12 text-center text-slate-500 text-sm space-y-3">
              <div className="flex justify-center">
                <Network className="h-10 w-10 text-slate-300" />
              </div>
              <div className="font-medium">Pick an entity to explore its graph</div>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Each counterparty has alias variants (e.g. legal vs. trading-desk shorthand) and optional
                parent/subsidiary relationships. The reconciler uses this graph whenever a source feed
                shows a counterparty string that doesn&rsquo;t exactly match the canonical name.
              </p>
              <div className="text-[11px] text-slate-400">
                Tip: try an abbreviation like <span className="font-mono">JPM</span> — the graph will
                find the canonical <span className="font-mono">J.P. Morgan Securities LLC</span>.
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function SvgGraph({ center, aliases, subsidiaries }: { center: Entity; aliases: string[]; subsidiaries: Entity[] }) {
  const width = 700;
  const height = 320;
  const cx = width / 2;
  const cy = height / 2;

  const aliasCount = Math.min(aliases.length, 8);
  const subCount = Math.min(subsidiaries.length, 4);

  const aliasNodes = aliases.slice(0, 8).map((a, i) => {
    const angle = (-Math.PI / 2) + (Math.PI * i) / Math.max(aliasCount - 1, 1);
    return {
      x: cx + Math.cos(angle + Math.PI) * 220,
      y: cy + Math.sin(angle + Math.PI) * 120,
      label: a
    };
  });
  const subNodes = subsidiaries.slice(0, 4).map((s, i) => {
    const angle = (-Math.PI / 2) + (Math.PI * i) / Math.max(subCount - 1, 1);
    return {
      x: cx + Math.cos(angle) * 220,
      y: cy + Math.sin(angle) * 120,
      label: s.canonical_name
    };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full border border-slate-200 rounded bg-slate-50">
      {aliasNodes.map((n, i) => (
        <line key={`al-${i}`} x1={cx} y1={cy} x2={n.x} y2={n.y} stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 3" />
      ))}
      {subNodes.map((n, i) => (
        <line key={`sb-${i}`} x1={cx} y1={cy} x2={n.x} y2={n.y} stroke="#a78bfa" strokeWidth={1.5} />
      ))}
      {/* center */}
      <circle cx={cx} cy={cy} r={34} fill="#0f172a" />
      <text x={cx} y={cy + 4} textAnchor="middle" fill="white" fontSize={10} fontFamily="JetBrains Mono">
        {truncate(center.canonical_name, 18)}
      </text>
      {/* aliases */}
      {aliasNodes.map((n, i) => (
        <g key={`an-${i}`}>
          <circle cx={n.x} cy={n.y} r={14} fill="#e2e8f0" stroke="#94a3b8" />
          <text x={n.x} y={n.y + 24} textAnchor="middle" fill="#475569" fontSize={9} fontFamily="JetBrains Mono">
            {truncate(n.label, 16)}
          </text>
        </g>
      ))}
      {/* subs */}
      {subNodes.map((n, i) => (
        <g key={`sn-${i}`}>
          <circle cx={n.x} cy={n.y} r={16} fill="#ddd6fe" stroke="#a78bfa" />
          <text x={n.x} y={n.y + 26} textAnchor="middle" fill="#6b21a8" fontSize={9} fontFamily="JetBrains Mono">
            {truncate(n.label, 18)}
          </text>
        </g>
      ))}
      {/* legend */}
      <g transform={`translate(12, 14)`}>
        <circle cx={6} cy={6} r={5} fill="#0f172a" />
        <text x={18} y={10} fontSize={10} fill="#475569">canonical entity</text>
        <circle cx={6} cy={24} r={5} fill="#e2e8f0" stroke="#94a3b8" />
        <text x={18} y={28} fontSize={10} fill="#475569">alias</text>
        <circle cx={6} cy={42} r={5} fill="#ddd6fe" stroke="#a78bfa" />
        <text x={18} y={46} fontSize={10} fill="#475569">subsidiary / parent</text>
      </g>
    </svg>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Eliminate unused import warnings from modules only used in types
void Separator;
