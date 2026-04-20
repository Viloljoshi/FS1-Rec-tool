'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Play, Loader2, CheckCircle2, ArrowRight } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface Cycle {
  id: string;
  feed_a_id: string;
  feed_b_id: string;
  date_from: string;
  date_to: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  counts: Record<string, number> | null;
}

interface Feed {
  id: string;
  name: string;
  kind: string;
  version: number;
  retired_at: string | null;
}

export function MatchingClient({ cycles, feeds }: { cycles: Cycle[]; feeds: Feed[] }) {
  const router = useRouter();
  const [feedA, setFeedA] = useState<string>(feeds.find((f) => f.name === 'Internal Blotter')?.id ?? '');
  const [feedB, setFeedB] = useState<string>(feeds.find((f) => f.name === 'Broker B — J.P. Morgan')?.id ?? '');
  const [dateFrom, setDateFrom] = useState('2026-04-01');
  const [dateTo, setDateTo] = useState('2026-04-30');
  const [running, setRunning] = useState(false);

  const feedById = new Map(feeds.map((f) => [f.id, f]));

  const run = async () => {
    if (!feedA || !feedB) {
      toast.error('Select both feeds');
      return;
    }
    if (feedA === feedB) {
      toast.error('Feeds must differ');
      return;
    }
    setRunning(true);
    try {
      const res = await fetch('/api/matching/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feed_a_id: feedA,
          feed_b_id: feedB,
          date_from: dateFrom,
          date_to: dateTo,
          restrict_by_counterparty_entity: true
        })
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'run failed');
      const data = await res.json();
      toast.success(`Matching cycle complete · ${data.match_count} matches · ${data.exception_count} exceptions`);
      router.push(`/workspace?cycle=${data.cycle_id}`);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run a new matching cycle</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Side A (source of truth)</Label>
              <Select value={feedA} onValueChange={setFeedA}>
                <SelectTrigger><SelectValue placeholder="Feed A" /></SelectTrigger>
                <SelectContent>
                  {feeds.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name} <span className="text-slate-400 ml-1">v{f.version}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Side B (external feed)</Label>
              <Select value={feedB} onValueChange={setFeedB}>
                <SelectTrigger><SelectValue placeholder="Feed B" /></SelectTrigger>
                <SelectContent>
                  {feeds.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name} <span className="text-slate-400 ml-1">v{f.version}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={run} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              Run Matching Cycle
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cycle history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-slate-100">
            {cycles.map((c) => {
              const fa = feedById.get(c.feed_a_id);
              const fb = feedById.get(c.feed_b_id);
              return (
                <li key={c.id} className="px-6 py-3 flex items-center gap-4 hover:bg-slate-50 transition">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{fa?.name ?? c.feed_a_id.slice(0, 8)}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                      <span className="font-medium text-sm">{fb?.name ?? c.feed_b_id.slice(0, 8)}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {c.status === 'COMPLETE' && <CheckCircle2 className="h-2.5 w-2.5 mr-0.5 text-emerald-600" />}
                        {c.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5">
                      {format(new Date(c.started_at), 'yyyy-MM-dd HH:mm')}
                      <span className="ml-2">· {formatDistanceToNow(new Date(c.started_at), { addSuffix: true })}</span>
                    </div>
                  </div>
                  {c.counts && (
                    <div className="flex gap-3 text-[11px] font-mono tabular-nums">
                      <div><span className="text-slate-400">H</span> {c.counts.HIGH ?? 0}</div>
                      <div><span className="text-slate-400">M</span> {c.counts.MEDIUM ?? 0}</div>
                      <div><span className="text-slate-400">L</span> {c.counts.LOW ?? 0}</div>
                      <div><span className="text-slate-400">X</span> {c.counts.EXCEPTIONS ?? 0}</div>
                    </div>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/workspace?cycle=${c.id}`}>Open</Link>
                  </Button>
                </li>
              );
            })}
            {cycles.length === 0 && (
              <li className="px-6 py-8 text-center text-sm text-slate-400">
                No matching cycles yet. Run one above.
              </li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
