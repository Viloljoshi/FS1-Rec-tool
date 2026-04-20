'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, Download, Eye, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import Link from 'next/link';

interface Event {
  id: string;
  actor: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  created_at: string;
}

interface Profile {
  id: string;
  email: string;
  role: string;
}

export function AuditClient({ events, profiles }: { events: Event[]; profiles: Profile[] }) {
  const [search, setSearch] = useState('');
  const [actorFilter, setActorFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');

  const emailById = useMemo(() => new Map(profiles.map((p) => [p.id, p.email])), [profiles]);
  const roleById = useMemo(() => new Map(profiles.map((p) => [p.id, p.role])), [profiles]);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (actorFilter !== 'all' && e.actor !== actorFilter) return false;
      if (actionFilter !== 'all' && e.action !== actionFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        const hay = [e.action, e.entity_type, e.entity_id, e.reason ?? '', emailById.get(e.actor ?? '') ?? '']
          .join(' ')
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [events, search, actorFilter, actionFilter, emailById]);

  const actions = Array.from(new Set(events.map((e) => e.action))).sort();

  const exportCsv = () => {
    const header = ['created_at', 'actor', 'action', 'entity_type', 'entity_id', 'reason'].join(',');
    const lines = filtered.map((e) =>
      [
        e.created_at,
        emailById.get(e.actor ?? '') ?? e.actor ?? '',
        e.action,
        e.entity_type,
        e.entity_id,
        (e.reason ?? '').replace(/"/g, '""')
      ]
        .map((s) => (typeof s === 'string' && s.includes(',') ? `"${s}"` : s))
        .join(',')
    );
    const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search action, entity, reason..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select value={actorFilter} onValueChange={setActorFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Actor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actors</SelectItem>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.email} · {p.role}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Action" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {actions.map((a) => (
              <SelectItem key={a} value={a} className="font-mono text-xs">{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportCsv} className="ml-auto">
          <Download className="h-4 w-4 mr-1.5" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-600 w-44">Timestamp</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600 w-48">Actor</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600 w-56">Action</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Entity</th>
                <th className="text-left px-4 py-2 font-medium text-slate-600">Reason</th>
                <th className="px-4 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-slate-600">
                    {format(new Date(e.created_at), 'yyyy-MM-dd HH:mm:ss')}
                  </td>
                  <td className="px-4 py-2 font-mono text-slate-700">
                    {emailById.get(e.actor ?? '') ?? e.actor?.slice(0, 8) ?? 'system'}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant="outline" className="font-mono text-[10px]">{e.action}</Badge>
                  </td>
                  <td className="px-4 py-2 font-mono text-slate-600">
                    <span className="text-slate-500">{e.entity_type}</span>
                    <span className="ml-1">{e.entity_id.slice(0, 8)}…</span>
                  </td>
                  <td className="px-4 py-2 text-slate-700 truncate max-w-xs">{e.reason ?? '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <Sheet>
                      <SheetTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 px-2">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </SheetTrigger>
                      <SheetContent side="right" className="w-[540px] sm:w-[640px] overflow-auto">
                        <AuditDetailDrawer
                          event={e}
                          actorEmail={emailById.get(e.actor ?? '') ?? null}
                          actorRole={roleById.get(e.actor ?? '') ?? null}
                        />
                      </SheetContent>
                    </Sheet>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No events match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-[11px] text-slate-400 font-mono">
        {filtered.length} of {events.length} events · append-only · RLS-enforced
      </p>
    </div>
  );
}

interface AuditDetailDrawerProps {
  event: Event;
  actorEmail: string | null;
  actorRole: string | null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function computeDiff(
  before: unknown,
  after: unknown
): Array<{ field: string; before: unknown; after: unknown }> {
  if (!before && !after) return [];
  if (typeof before !== 'object' || typeof after !== 'object') return [];
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const k of keys) {
    if (!deepEqual(b[k], a[k])) {
      out.push({ field: k, before: b[k] ?? null, after: a[k] ?? null });
    }
  }
  return out;
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function entityLink(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case 'exception':
      return `/workspace?exception=${entityId}`;
    case 'matching_cycle':
      return `/workspace?cycle=${entityId}`;
    case 'feed_profile':
      return `/onboarding?feed=${entityId}`;
    case 'matching_rules':
      return `/pipeline`;
    default:
      return null;
  }
}

function AuditDetailDrawer({ event, actorEmail, actorRole }: AuditDetailDrawerProps): React.ReactElement {
  const diff = computeDiff(event.before, event.after);
  const href = entityLink(event.entity_type, event.entity_id);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-slate-500" />
          {event.action}
        </SheetTitle>
      </SheetHeader>
      <div className="mt-4 space-y-4 text-xs">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
          <div>
            <div className="text-slate-500 uppercase tracking-wider text-[10px]">Event ID</div>
            <div className="font-mono text-slate-700 break-all">{event.id}</div>
          </div>
          <div>
            <div className="text-slate-500 uppercase tracking-wider text-[10px]">Timestamp</div>
            <div className="font-mono text-slate-700">
              {format(new Date(event.created_at), 'yyyy-MM-dd HH:mm:ss')}
            </div>
          </div>
          <div>
            <div className="text-slate-500 uppercase tracking-wider text-[10px]">Actor</div>
            <div className="font-mono text-slate-700">{actorEmail ?? event.actor?.slice(0, 12) ?? 'system'}</div>
            {actorRole && (
              <Badge variant="secondary" className="mt-0.5 text-[9px] uppercase">
                {actorRole}
              </Badge>
            )}
          </div>
          <div>
            <div className="text-slate-500 uppercase tracking-wider text-[10px]">Entity</div>
            <div className="font-mono text-slate-700 break-all">
              {event.entity_type}/{event.entity_id.slice(0, 8)}…
            </div>
            {href && (
              <Link
                href={href}
                className="inline-flex items-center gap-1 mt-0.5 text-[10px] text-violet-700 hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                open in workspace
              </Link>
            )}
          </div>
        </div>

        {event.reason && (
          <div>
            <div className="text-slate-500 uppercase tracking-wider text-[10px]">Reason / note</div>
            <div className="mt-0.5 italic text-slate-700 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
              “{event.reason}”
            </div>
          </div>
        )}

        {diff.length > 0 ? (
          <div>
            <div className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">
              Changes ({diff.length} field{diff.length === 1 ? '' : 's'})
            </div>
            <div className="border border-slate-200 rounded divide-y divide-slate-100">
              {diff.map((d) => (
                <div key={d.field} className="grid grid-cols-[120px_1fr] gap-2 px-2 py-1.5 text-[11px]">
                  <div className="font-mono text-slate-500">{d.field}</div>
                  <div className="font-mono space-x-1">
                    <span className="line-through text-rose-600">{renderValue(d.before)}</span>
                    <span className="text-slate-400">→</span>
                    <span className="text-emerald-700 font-semibold">{renderValue(d.after)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-slate-500 text-[11px]">No field-level changes (additive event).</div>
        )}

        <details className="text-[10px] text-slate-500">
          <summary className="cursor-pointer hover:text-slate-700">Show raw before / after JSON</summary>
          <div className="mt-2 space-y-2">
            <div>
              <div className="uppercase tracking-wider text-[9px]">Before</div>
              <pre className="bg-slate-900 text-slate-100 p-2 rounded overflow-auto text-[9px] leading-tight">
                {JSON.stringify(event.before, null, 2) ?? 'null'}
              </pre>
            </div>
            <div>
              <div className="uppercase tracking-wider text-[9px]">After</div>
              <pre className="bg-slate-900 text-slate-100 p-2 rounded overflow-auto text-[9px] leading-tight">
                {JSON.stringify(event.after, null, 2) ?? 'null'}
              </pre>
            </div>
          </div>
        </details>

        <div className="text-slate-500 mt-4 border-t pt-3 text-[11px]">
          This row cannot be modified. <span className="font-mono">audit_events</span> has no UPDATE
          or DELETE policy — any attempt at the database layer is rejected.
        </div>
      </div>
    </>
  );
}
