'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2, Upload, Sparkles, CheckCircle2, Play, HelpCircle, ExternalLink } from 'lucide-react';
import { CANONICAL_FIELDS } from '@/lib/canonical/schema';
import { AiAssistedBadge } from '@/components/shared/AiAssistedBadge';

interface FeedRow {
  id: string;
  name: string;
  kind: string;
  version: number;
  created_at: string;
  retired_at: string | null;
}

interface Mapping {
  source_field: string;
  canonical_field: (typeof CANONICAL_FIELDS)[number] | null;
  confidence: number;
  reasoning: string;
}

export function OnboardingClient({ existingFeeds }: { existingFeeds: FeedRow[] }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [feedName, setFeedName] = useState('');
  const [kind, setKind] = useState<'BROKER' | 'CUSTODIAN' | 'INTERNAL' | 'OTHER'>('BROKER');
  const [headers, setHeaders] = useState<string[]>([]);
  const [samples, setSamples] = useState<Array<Record<string, string>>>([]);
  const [allRows, setAllRows] = useState<Array<Record<string, string>>>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [inferring, setInferring] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ cycle_id: string | null; rows_ingested: number } | null>(null);
  const [validation, setValidation] = useState<{
    rowCount: number;
    sample: Array<Record<string, string>>;
  } | null>(null);

  const onFile = useCallback(async (file: File) => {
    // Drop papaparse's __parsed_extra (from ragged rows) + coerce all values to strings
    const sanitize = (rows: Array<Record<string, unknown>>): Array<Record<string, string>> =>
      rows.map((r) => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) {
          if (k === '__parsed_extra') continue;
          if (v === null || v === undefined) out[k] = '';
          else if (Array.isArray(v)) out[k] = v.join(',');
          else out[k] = String(v);
        }
        return out;
      });

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'csv') {
      Papa.parse<Record<string, unknown>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          if (res.data.length === 0) {
            toast.error('No rows parsed');
            return;
          }
          const rows = sanitize(res.data);
          const cols = res.meta.fields ?? Object.keys(rows[0] ?? {});
          setHeaders(cols);
          setAllRows(rows);
          setSamples(rows.slice(0, 10));
          setValidation({ rowCount: rows.length, sample: rows.slice(0, 5) });
          setStep(2);
          if (!feedName) setFeedName(file.name.replace(/\.[^/.]+$/, ''));
        }
      });
    } else if (ext === 'xlsx' || ext === 'xls') {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]!]!;
      const rawXlsx = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      if (rawXlsx.length === 0) {
        toast.error('No rows parsed');
        return;
      }
      const rows = sanitize(rawXlsx);
      const cols = Object.keys(rows[0] ?? {});
      setHeaders(cols);
      setAllRows(rows);
      setSamples(rows.slice(0, 10));
      setValidation({ rowCount: rows.length, sample: rows.slice(0, 5) });
      setStep(2);
      if (!feedName) setFeedName(file.name.replace(/\.[^/.]+$/, ''));
    } else {
      toast.error('Upload a .csv, .xlsx, or .xls file');
    }
  }, [feedName]);

  const infer = async () => {
    setInferring(true);
    try {
      const res = await fetch('/api/ai/infer-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers, samples })
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as {
        mappings: Array<{
          source_field: string;
          canonical_field: string | null;
          confidence: number;
          reasoning: string;
        }>;
      };
      // Build a full mapping for every header; fall back to null when AI didn't return it
      const byField = new Map(json.mappings.map((m) => [m.source_field, m]));
      const full: Mapping[] = headers.map((h) => {
        const m = byField.get(h);
        const cf = m?.canonical_field;
        const canonical = cf && (CANONICAL_FIELDS as readonly string[]).includes(cf)
          ? (cf as Mapping['canonical_field'])
          : null;
        return {
          source_field: h,
          canonical_field: canonical,
          confidence: m?.confidence ?? 0,
          reasoning: m?.reasoning ?? ''
        };
      });
      setMappings(full);
      setStep(3);
      toast.success(`AI proposed ${full.filter((f) => f.canonical_field).length} of ${full.length} mappings`);
    } catch (err) {
      toast.error(`Inference failed: ${String(err)}`);
    } finally {
      setInferring(false);
    }
  };

  const saveAndRun = async () => {
    setProcessing(true);
    try {
      const payload = {
        name: feedName.trim(),
        kind,
        mappings: mappings
          .filter((m) => m.canonical_field !== null)
          .map((m) => ({
            source_field: m.source_field,
            canonical_field: m.canonical_field!,
            confidence: m.confidence,
            ai_reasoning: m.reasoning
          })),
        rows: allRows
      };
      const res = await fetch('/api/feeds/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast.success(
        `Ingested ${data.rows_ingested} trades · ${data.cycle_id ? 'matching cycle started' : 'matching skipped'}`
      );
      setResult({ cycle_id: data.cycle_id, rows_ingested: data.rows_ingested });
      setStep(4);
      if (data.cycle_id) {
        setTimeout(() => router.push(`/workspace?cycle=${data.cycle_id}`), 1500);
      }
    } catch (err) {
      toast.error(`Process failed: ${String(err)}`);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_360px] gap-6">
      <div className="space-y-4">
        <Stepper step={step} />

        {step === 1 && (
          <UploadStep onFile={onFile} feedName={feedName} setFeedName={setFeedName} kind={kind} setKind={setKind} />
        )}

        {step >= 2 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                File preview
                <Badge variant="outline" className="font-mono text-[10px]">
                  {validation?.rowCount ?? 0} rows · {headers.length} columns
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      {headers.slice(0, 8).map((h) => (
                        <th key={h} className="text-left px-2 py-1.5 font-mono text-slate-600 border-r border-slate-200 last:border-r-0">
                          {h}
                        </th>
                      ))}
                      {headers.length > 8 && <th className="px-2 py-1.5 text-slate-400">+{headers.length - 8}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {samples.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        {headers.slice(0, 8).map((h) => (
                          <td key={h} className="px-2 py-1 font-mono text-slate-700 border-r border-slate-100 last:border-r-0">
                            {r[h] ?? ''}
                          </td>
                        ))}
                        {headers.length > 8 && <td className="px-2 text-slate-300">…</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {step === 2 && (
                <Button onClick={infer} disabled={inferring} className="mt-4">
                  {inferring ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Infer canonical mapping with AI
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {step >= 3 && mappings.length > 0 && (
          <MappingEditor mappings={mappings} onChange={setMappings} />
        )}

        {step >= 3 && step < 4 && (
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setStep(2)} disabled={processing}>
              Back
            </Button>
            <Button
              onClick={saveAndRun}
              disabled={processing || !feedName.trim() || mappings.filter((m) => m.canonical_field).length === 0}
            >
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Ingesting {allRows.length} trades, running matching cycle…
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Save &amp; Run Matching Cycle
                </>
              )}
            </Button>
          </div>
        )}

        {step === 4 && result && (
          <Card className="border-emerald-200 bg-emerald-50/50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <h3 className="font-medium text-emerald-900">Done</h3>
                  <p className="text-sm text-emerald-700">
                    Ingested <span className="font-mono">{result.rows_ingested}</span> trades into a new versioned feed
                    profile. The matching engine has run against the Internal blotter.
                  </p>
                  {result.cycle_id && (
                    <Button size="sm" onClick={() => router.push(`/workspace?cycle=${result.cycle_id}`)}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Open Exception Management →
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Existing feed profiles</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100">
              {existingFeeds.map((f) => (
                <li key={`${f.id}-${f.version}`} className="px-4 py-2 text-xs flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">{f.name}</div>
                    <div className="text-slate-500">
                      {f.kind.toLowerCase()} · v{f.version}
                      {f.retired_at ? ' · retired' : ''}
                    </div>
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                    v{f.version}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  const steps = ['Upload', 'Infer', 'Map', 'Save'];
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const n = i + 1;
        const active = step === n;
        const done = step > n;
        return (
          <div key={s} className="flex items-center">
            <div
              className={`h-6 w-6 rounded-full grid place-items-center text-xs font-mono ${
                done
                  ? 'bg-emerald-500 text-white'
                  : active
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-200 text-slate-500'
              }`}
            >
              {n}
            </div>
            <span className={`ml-2 text-xs ${active ? 'text-slate-900 font-medium' : 'text-slate-500'}`}>{s}</span>
            {n < 4 && <div className="h-px w-8 bg-slate-200 mx-3" />}
          </div>
        );
      })}
    </div>
  );
}

function UploadStep(props: {
  onFile: (f: File) => void;
  feedName: string;
  setFeedName: (v: string) => void;
  kind: 'BROKER' | 'CUSTODIAN' | 'INTERNAL' | 'OTHER';
  setKind: (v: 'BROKER' | 'CUSTODIAN' | 'INTERNAL' | 'OTHER') => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Upload a sample file</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="feed-name">Feed name</Label>
            <Input id="feed-name" value={props.feedName} onChange={(e) => props.setFeedName(e.target.value)} placeholder="e.g., Broker C — Jefferies" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="feed-kind">Kind</Label>
            <Select value={props.kind} onValueChange={(v) => props.setKind(v as typeof props.kind)}>
              <SelectTrigger id="feed-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BROKER">Broker</SelectItem>
                <SelectItem value="CUSTODIAN">Custodian</SelectItem>
                <SelectItem value="INTERNAL">Internal</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <label
          htmlFor="file-upload"
          className="relative block rounded-lg border-2 border-dashed border-slate-300 p-10 text-center hover:border-slate-400 transition cursor-pointer"
        >
          <Upload className="h-6 w-6 mx-auto text-slate-400" />
          <p className="mt-2 text-sm font-medium text-slate-700">Drag and drop or click to upload</p>
          <p className="mt-1 text-xs text-slate-500">CSV, XLSX · up to 10 MB</p>
          <input
            id="file-upload"
            type="file"
            accept=".csv,.xlsx,.xls"
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) props.onFile(f);
            }}
          />
        </label>
      </CardContent>
    </Card>
  );
}

function MappingEditor({ mappings, onChange }: { mappings: Mapping[]; onChange: (m: Mapping[]) => void }) {
  const update = (i: number, patch: Partial<Mapping>) => {
    onChange(mappings.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          Field mappings
          <AiAssistedBadge />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="border border-slate-200 rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium text-slate-600">Source field</th>
                <th className="text-left px-2 py-1.5 font-medium text-slate-600">Canonical field</th>
                <th className="text-left px-2 py-1.5 font-medium text-slate-600 w-20">Confidence</th>
                <th className="text-left px-2 py-1.5 font-medium text-slate-600 w-8">Why?</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m, i) => (
                <tr key={m.source_field} className="border-t border-slate-100">
                  <td className="px-2 py-1.5 font-mono text-slate-700">{m.source_field}</td>
                  <td className="px-2 py-1">
                    <Select
                      value={m.canonical_field ?? '__none__'}
                      onValueChange={(v) =>
                        update(i, { canonical_field: v === '__none__' ? null : (v as Mapping['canonical_field']) })
                      }
                    >
                      <SelectTrigger className="h-7 text-xs font-mono">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— ignore —</SelectItem>
                        {CANONICAL_FIELDS.map((f) => (
                          <SelectItem key={f} value={f}>
                            {f}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    <ConfidenceChip value={m.confidence} />
                  </td>
                  <td className="px-2 py-1.5">
                    {m.reasoning && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="text-slate-400 hover:text-slate-700">
                            <HelpCircle className="h-3.5 w-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent side="left" className="max-w-xs text-xs">
                          <div className="font-medium mb-1">AI reasoning</div>
                          <div className="text-slate-600">{m.reasoning}</div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-xs text-slate-500">
          {mappings.filter((m) => m.canonical_field).length} of {mappings.length} fields mapped. Unmapped fields will be ignored at ingestion.
        </div>
      </CardContent>
    </Card>
  );
}

function ConfidenceChip({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.9 ? 'bg-emerald-100 text-emerald-700' : value >= 0.7 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums ${color}`}>
      {pct}%
    </span>
  );
}
