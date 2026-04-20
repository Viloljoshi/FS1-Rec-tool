'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Loader2,
  Upload,
  Sparkles,
  ArrowLeftRight,
  Play,
  Database,
  FileUp,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { CANONICAL_FIELDS, type CanonicalField, missingRequiredFields } from '@/lib/canonical/schema';
import { cn } from '@/lib/utils';

interface ExistingFeed {
  id: string;
  name: string;
  kind: string;
  version: number;
  retired_at: string | null;
}

interface SidePayload {
  kind: 'existing' | 'upload';
  existingFeedId?: string;
  uploadName?: string;
  uploadFeedKind?: 'BROKER' | 'CUSTODIAN' | 'INTERNAL' | 'OTHER';
  headers?: string[];
  samples?: Array<Record<string, string>>;
  rows?: Array<Record<string, string>>;
  mappings?: Array<{ source_field: string; canonical_field: CanonicalField | null; confidence: number; reasoning: string }>;
}

export function ReconcileClient({ existingFeeds }: { existingFeeds: ExistingFeed[] }) {
  const router = useRouter();
  const defaultInternal = existingFeeds.find((f) => f.name === 'Internal Blotter');
  const [sideA, setSideA] = useState<SidePayload>({
    kind: 'existing',
    existingFeedId: defaultInternal?.id ?? ''
  });
  const [sideB, setSideB] = useState<SidePayload>({ kind: 'upload', uploadFeedKind: 'BROKER' });
  const [inferringA, setInferringA] = useState(false);
  const [inferringB, setInferringB] = useState(false);
  const [running, setRunning] = useState(false);
  const [dateFrom, setDateFrom] = useState('2026-04-01');
  const [dateTo, setDateTo] = useState('2026-04-30');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
        <SideCard
          role="YOUR SIDE"
          subtitle="Party A — the source-of-truth view"
          side={sideA}
          setSide={setSideA}
          existingFeeds={existingFeeds}
          inferring={inferringA}
          setInferring={setInferringA}
          accent="slate"
        />

        <div className="flex flex-col items-center justify-center px-2">
          <div className="h-12 w-12 rounded-full bg-slate-900 grid place-items-center">
            <ArrowLeftRight className="h-5 w-5 text-white" />
          </div>
          <span className="text-[10px] uppercase tracking-wider text-slate-400 mt-2 font-mono">recon</span>
        </div>

        <SideCard
          role="COUNTERPARTY SIDE"
          subtitle="Party B — the external feed (broker, custodian)"
          side={sideB}
          setSide={setSideB}
          existingFeeds={existingFeeds}
          inferring={inferringB}
          setInferring={setInferringB}
          accent="violet"
        />
      </div>

      <Card className="border-slate-200">
        <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="text-xs text-slate-500 flex-1 min-w-[240px]">
            One click ingests both feeds (if uploaded), runs the 7-layer matching engine, and lands on the exception workspace.
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-slate-500">From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 text-xs w-40"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-slate-500">To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 text-xs w-40"
              />
            </div>
          </div>
          <Button
            size="lg"
            disabled={running || !ready(sideA) || !ready(sideB) || equalSides(sideA, sideB) || dateFrom > dateTo}
            onClick={async () => {
              setRunning(true);
              try {
                const aId = await ensureFeedId(sideA, 'YOUR SIDE');
                const bId = await ensureFeedId(sideB, 'COUNTERPARTY SIDE');
                if (!aId || !bId) return;
                const res = await fetch('/api/matching/run', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    feed_a_id: aId,
                    feed_b_id: bId,
                    date_from: dateFrom,
                    date_to: dateTo,
                    restrict_by_counterparty_entity: true
                  })
                });
                if (!res.ok) throw new Error((await res.json()).error ?? 'run failed');
                const data = await res.json();
                toast.success(
                  `Cycle complete — ${data.match_count} matches, ${data.exception_count} exceptions`
                );
                router.push(`/workspace?cycle=${data.cycle_id}`);
              } catch (err) {
                toast.error(String(err));
              } finally {
                setRunning(false);
              }
            }}
          >
            {running ? (
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
            ) : (
              <Play className="h-5 w-5 mr-2" />
            )}
            Run Reconciliation
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-slate-50 border-slate-200">
        <CardContent className="py-3 text-xs text-slate-600 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400" />
          <div>
            <strong className="text-slate-700">What happens under the hood:</strong> uploaded files are
            parsed (CSV/XLSX), AI infers the canonical mapping, mappings are versioned and saved, rows are
            canonicalized into <span className="font-mono">trades_canonical</span> with lineage, the
            matching engine runs 7 layers (normalize → hash → blocking → similarity → Fellegi-Sunter →
            Hungarian → LLM tiebreak on MEDIUM band), and every decision is audited. Every AI call is
            logged to <span className="font-mono">ai_calls</span>.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ready(side: SidePayload): boolean {
  if (side.kind === 'existing') return !!side.existingFeedId;
  if (!side.rows || side.rows.length === 0) return false;
  if (!side.uploadName || !side.mappings) return false;
  const mapped = side.mappings.map((m) => m.canonical_field);
  return missingRequiredFields(mapped).length === 0;
}

function missingRequiredFromSide(side: SidePayload): CanonicalField[] {
  if (side.kind === 'existing' || !side.mappings) return [];
  return missingRequiredFields(side.mappings.map((m) => m.canonical_field));
}

function equalSides(a: SidePayload, b: SidePayload): boolean {
  if (a.kind === 'existing' && b.kind === 'existing') return a.existingFeedId === b.existingFeedId;
  return false;
}

async function ensureFeedId(side: SidePayload, label: string): Promise<string | null> {
  if (side.kind === 'existing') return side.existingFeedId ?? null;
  if (!side.rows || !side.uploadName || !side.mappings) {
    toast.error(`${label}: complete the upload before running`);
    return null;
  }
  const res = await fetch('/api/feeds/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: side.uploadName,
      kind: side.uploadFeedKind ?? 'BROKER',
      mappings: side.mappings
        .filter((m) => m.canonical_field !== null)
        .map((m) => ({
          source_field: m.source_field,
          canonical_field: m.canonical_field!,
          confidence: m.confidence,
          ai_reasoning: m.reasoning
        })),
      rows: side.rows
    })
  });
  if (res.status === 401) {
    toast.error('Your session expired. Redirecting to login…');
    setTimeout(() => {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }, 800);
    return null;
  }
  if (!res.ok) {
    toast.error(`${label}: processing failed — ${await res.text()}`);
    return null;
  }
  const json = await res.json();
  const ingested = json.rows_ingested ?? 0;
  const skipped = json.rows_skipped ?? 0;
  if (skipped > 0) {
    const reasons = json.skip_reasons ?? {};
    const reasonSummary = Object.entries(reasons)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    toast.warning(
      `${label}: ingested ${ingested}, skipped ${skipped}${reasonSummary ? ` (${reasonSummary})` : ''}`
    );
  } else if (ingested > 0) {
    toast.success(`${label}: ingested ${ingested} trades`);
  }
  return json.feed_id;
}

interface SideCardProps {
  role: string;
  subtitle: string;
  side: SidePayload;
  setSide: (s: SidePayload) => void;
  existingFeeds: ExistingFeed[];
  inferring: boolean;
  setInferring: (v: boolean) => void;
  accent: 'slate' | 'violet';
}

// Drop papaparse's __parsed_extra key (from ragged rows with extra commas)
// and coerce every value to a plain string for the server-side Zod schema.
function sanitizeRows(rows: Array<Record<string, unknown>>): Array<Record<string, string>> {
  return rows.map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) {
      if (k === '__parsed_extra') continue;
      if (v === null || v === undefined) out[k] = '';
      else if (Array.isArray(v)) out[k] = v.join(',');
      else out[k] = String(v);
    }
    return out;
  });
}

function SideCard({ role, subtitle, side, setSide, existingFeeds, inferring, setInferring, accent }: SideCardProps) {
  const onFile = useCallback(
    async (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'csv') {
        Papa.parse<Record<string, unknown>>(file, {
          header: true,
          skipEmptyLines: true,
          complete: (res) => {
            if (!res.data.length) {
              toast.error('No rows parsed');
              return;
            }
            const rows = sanitizeRows(res.data);
            const cols = res.meta.fields ?? Object.keys(rows[0] ?? {});
            setSide({
              ...side,
              kind: 'upload',
              uploadName: side.uploadName ?? file.name.replace(/\.[^/.]+$/, ''),
              uploadFeedKind: side.uploadFeedKind ?? 'BROKER',
              headers: cols,
              samples: rows.slice(0, 5),
              rows,
              mappings: undefined
            });
          }
        });
      } else if (ext === 'xlsx' || ext === 'xls') {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]!]!;
        const rawXlsx = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
        if (!rawXlsx.length) {
          toast.error('No rows parsed');
          return;
        }
        const rows = sanitizeRows(rawXlsx);
        const cols = Object.keys(rows[0] ?? {});
        setSide({
          ...side,
          kind: 'upload',
          uploadName: side.uploadName ?? file.name.replace(/\.[^/.]+$/, ''),
          uploadFeedKind: side.uploadFeedKind ?? 'BROKER',
          headers: cols,
          samples: rows.slice(0, 5),
          rows,
          mappings: undefined
        });
      } else {
        toast.error('Upload a .csv, .xlsx, or .xls file');
      }
    },
    [side, setSide]
  );

  const infer = async () => {
    if (!side.headers || !side.samples) return;
    setInferring(true);
    try {
      const res = await fetch('/api/ai/infer-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: side.headers, samples: side.samples })
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
      const byField = new Map(json.mappings.map((m) => [m.source_field, m]));
      const full = side.headers.map((h) => {
        const m = byField.get(h);
        const cf = m?.canonical_field;
        const canonical = cf && (CANONICAL_FIELDS as readonly string[]).includes(cf)
          ? (cf as CanonicalField)
          : null;
        return {
          source_field: h,
          canonical_field: canonical,
          confidence: m?.confidence ?? 0,
          reasoning: m?.reasoning ?? ''
        };
      });
      setSide({ ...side, mappings: full });
      toast.success(`Mapped ${full.filter((m) => m.canonical_field).length} of ${full.length} fields`);
    } catch (err) {
      toast.error(`Inference failed: ${String(err)}`);
    } finally {
      setInferring(false);
    }
  };

  const borderAccent = accent === 'violet' ? 'border-violet-200' : 'border-slate-200';
  const dotAccent = accent === 'violet' ? 'bg-violet-500' : 'bg-slate-900';

  return (
    <Card className={cn('flex flex-col', borderAccent)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium flex items-center gap-2 text-slate-700">
          <span className={cn('h-1.5 w-1.5 rounded-full', dotAccent)} />
          <span className="uppercase tracking-wider">{role}</span>
        </CardTitle>
        <p className="text-[11px] text-slate-500">{subtitle}</p>
      </CardHeader>
      <CardContent className="space-y-3 flex-1">
        <div className="flex gap-1">
          <button
            onClick={() => setSide({ ...side, kind: 'existing' })}
            className={cn(
              'flex-1 text-[11px] py-1 rounded border transition',
              side.kind === 'existing' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 hover:bg-slate-50'
            )}
          >
            <Database className="h-3 w-3 mr-1 inline" />
            Pick existing feed
          </button>
          <button
            onClick={() => setSide({ ...side, kind: 'upload' })}
            className={cn(
              'flex-1 text-[11px] py-1 rounded border transition',
              side.kind === 'upload' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 hover:bg-slate-50'
            )}
          >
            <FileUp className="h-3 w-3 mr-1 inline" />
            Upload new file
          </button>
        </div>

        {side.kind === 'existing' && (
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">Feed profile</Label>
            <Select
              value={side.existingFeedId ?? ''}
              onValueChange={(v) => setSide({ ...side, existingFeedId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a feed…" />
              </SelectTrigger>
              <SelectContent>
                {existingFeeds.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name} <span className="text-slate-400 ml-1">v{f.version}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {side.existingFeedId && (
              <p className="text-[10px] text-slate-500 font-mono">
                {existingFeeds.find((f) => f.id === side.existingFeedId)?.kind ?? ''}
              </p>
            )}
          </div>
        )}

        {side.kind === 'upload' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-slate-500">Feed name</Label>
                <Input
                  value={side.uploadName ?? ''}
                  onChange={(e) => setSide({ ...side, uploadName: e.target.value })}
                  placeholder="e.g., Morgan Stanley — Apr 2026"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-slate-500">Kind</Label>
                <Select
                  value={side.uploadFeedKind ?? 'BROKER'}
                  onValueChange={(v) => setSide({ ...side, uploadFeedKind: v as SidePayload['uploadFeedKind'] })}
                >
                  <SelectTrigger className="h-8 text-xs">
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

            <UploadDropzone role={role} onFile={onFile} />

            {side.headers && side.rows && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[11px] text-slate-600">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  <span>{side.rows.length} rows · {side.headers.length} columns</span>
                </div>

                {!side.mappings && (
                  <Button onClick={infer} disabled={inferring} size="sm" className="w-full">
                    {inferring ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                    Infer canonical mapping
                  </Button>
                )}

                {side.mappings && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span
                        className="text-slate-500 inline-flex items-center gap-1"
                        title="How confident the AI is that each source column maps to the correct canonical field. This is schema-mapping quality — NOT trade-match quality. Row-level matching happens after Run Reconciliation."
                      >
                        Mappings
                        <span className="text-slate-400 text-[9px]">ⓘ</span>
                      </span>
                      <Badge variant="outline" className="text-[9px] font-mono">
                        {side.mappings.filter((m) => m.canonical_field).length} / {side.mappings.length}
                      </Badge>
                    </div>
                    <div className="text-[9px] text-slate-400 -mt-0.5">
                      column-mapping confidence · not match rate
                    </div>
                    {(() => {
                      const missing = missingRequiredFromSide(side);
                      if (missing.length === 0) return null;
                      return (
                        <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] text-rose-700">
                          <div className="font-semibold uppercase tracking-wider text-[9px] mb-0.5">
                            Missing required fields
                          </div>
                          <div className="font-mono">{missing.join(', ')}</div>
                          <div className="mt-1 text-rose-600 normal-case">
                            Map these before running reconciliation, or upload a flattened version of the file.
                            Without them every row will skip at canonicalization.
                          </div>
                        </div>
                      );
                    })()}
                    <div className="border border-slate-200 rounded max-h-48 overflow-auto">
                      <table className="w-full text-[10px]">
                        <tbody>
                          {side.mappings.map((m, i) => (
                            <tr key={m.source_field} className="border-b border-slate-100 last:border-b-0">
                              <td className="px-2 py-1 font-mono text-slate-700 truncate max-w-[100px]">{m.source_field}</td>
                              <td className="px-2 py-1">
                                <Select
                                  value={m.canonical_field ?? '__none__'}
                                  onValueChange={(v) => {
                                    const next = [...side.mappings!];
                                    next[i] = { ...next[i]!, canonical_field: v === '__none__' ? null : (v as CanonicalField) };
                                    setSide({ ...side, mappings: next });
                                  }}
                                >
                                  <SelectTrigger className="h-5 text-[10px] font-mono px-1.5">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">— ignore —</SelectItem>
                                    {CANONICAL_FIELDS.map((f) => (
                                      <SelectItem key={f} value={f} className="text-[10px]">{f}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-2 py-1 font-mono text-[9px] w-10 text-right">
                                <span
                                  className={
                                    m.confidence >= 0.95
                                      ? 'text-emerald-600 font-semibold'
                                      : m.confidence >= 0.8
                                      ? 'text-amber-600 font-semibold'
                                      : 'text-rose-600 font-semibold'
                                  }
                                >
                                  {Math.round(m.confidence * 100)}%
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
      <Separator />
      <div className="px-4 py-2 text-[10px] text-slate-500">
        {side.kind === 'existing'
          ? side.existingFeedId ? 'Ready' : 'Pick a feed to continue'
          : ready(side) ? 'Ready to reconcile' : 'Upload a file and confirm mappings'}
      </div>
    </Card>
  );
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

interface UploadDropzoneProps {
  role: string;
  onFile: (f: File) => void | Promise<void>;
}

function UploadDropzone({ role, onFile }: UploadDropzoneProps): React.ReactElement {
  const id = `upload-${slugify(role)}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const openPicker = (): void => {
    // Reset so selecting the same file twice still triggers onChange.
    if (inputRef.current) inputRef.current.value = '';
    inputRef.current?.click();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void onFile(f);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload CSV or XLSX file"
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPicker();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
      }}
      onDrop={handleDrop}
      className={cn(
        'relative block rounded border-2 border-dashed p-5 text-center transition cursor-pointer select-none',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400',
        dragActive
          ? 'border-slate-900 bg-slate-100'
          : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'
      )}
    >
      <Upload className="h-4 w-4 mx-auto text-slate-400 pointer-events-none" />
      <p className="mt-1 text-xs text-slate-600 pointer-events-none">
        <span className="font-medium text-slate-800">Click to upload</span> or drag &amp; drop
      </p>
      <p className="mt-0.5 text-[10px] text-slate-400 pointer-events-none">CSV · XLSX · up to 10 MB</p>
      <input
        id={id}
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />
    </div>
  );
}
