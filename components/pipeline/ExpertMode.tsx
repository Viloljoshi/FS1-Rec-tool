'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { toast } from 'sonner';
import { AiAssistedBadge } from '@/components/shared/AiAssistedBadge';
import { PRESETS, detectPreset, type PresetName } from '@/lib/pipeline/presets';
import { SlidersHorizontal, CheckCircle2, Lock, Loader2, Upload, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

type BlockingField =
  | 'symbol'
  | 'isin'
  | 'cusip'
  | 'trade_date'
  | 'settlement_date'
  | 'direction'
  | 'currency'
  | 'account';
type PipelineStageId =
  | 'normalize'
  | 'hash'
  | 'blocking'
  | 'similarity'
  | 'fellegi_sunter'
  | 'hungarian'
  | 'llm_tiebreak';
type MatchTypeLabel = '1:1' | '1:N' | 'N:1' | 'N:M';

interface ActiveRule {
  version: number;
  tolerances: {
    price_rel_tolerance?: number;
    quantity_rel_tolerance?: number;
    date_day_delta?: number;
    bands?: { high_min: number; medium_min: number };
    llm_tiebreak_band?: 'MEDIUM_ONLY' | 'ALL' | 'NONE';
    blocking_keys?: BlockingField[];
    enabled_stages?: PipelineStageId[];
    match_types?: MatchTypeLabel[];
    preset?: string;
  } | null;
}

interface ExpertModeProps {
  active: ActiveRule | null;
  canEdit: boolean;
  onPublished?: () => void;
  activePipelineId?: string | null;
  activePipelineAssetClass?: string | null;
  activeFeedId?: string | null;
}

export function ExpertMode({ active, canEdit, onPublished, activePipelineId, activePipelineAssetClass, activeFeedId }: ExpertModeProps): React.ReactElement {
  const initialTol = active?.tolerances ?? {};
  const initialBands = initialTol.bands ?? { high_min: 0.95, medium_min: 0.7 };

  const [bandsHigh, setBandsHigh] = useState(initialBands.high_min);
  const [bandsMedium, setBandsMedium] = useState(initialBands.medium_min);
  const [priceTol, setPriceTol] = useState(initialTol.price_rel_tolerance ?? 0.01);
  const [qtyTol, setQtyTol] = useState(initialTol.quantity_rel_tolerance ?? 0.05);
  const [dateDelta, setDateDelta] = useState(initialTol.date_day_delta ?? 1);
  const [tiebreakBand, setTiebreakBand] = useState<'MEDIUM_ONLY' | 'ALL' | 'NONE'>(
    initialTol.llm_tiebreak_band ?? 'MEDIUM_ONLY'
  );
  const DEFAULT_BLOCKING: BlockingField[] = ['symbol', 'trade_date', 'direction'];
  const DEFAULT_STAGES: PipelineStageId[] = [
    'normalize',
    'hash',
    'blocking',
    'similarity',
    'fellegi_sunter',
    'hungarian',
    'llm_tiebreak'
  ];
  const [blockingKeys, setBlockingKeys] = useState<BlockingField[]>(
    initialTol.blocking_keys ?? DEFAULT_BLOCKING
  );
  const [enabledStages, setEnabledStages] = useState<PipelineStageId[]>(
    initialTol.enabled_stages ?? DEFAULT_STAGES
  );
  const [matchTypes, setMatchTypes] = useState<MatchTypeLabel[]>(
    initialTol.match_types ?? ['1:1']
  );
  const [publishing, setPublishing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [lastSuggestion, setLastSuggestion] = useState<{ summary: string; warnings: string[] } | null>(null);

  const suggestWithAI = async () => {
    setSuggesting(true);
    try {
      const assetClass = (activePipelineAssetClass as 'EQUITY' | 'FI' | 'FX' | 'FUTURE' | 'OTHER') ?? 'EQUITY';
      const res = await fetch('/api/ai/suggest-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feed_id: activeFeedId ?? undefined, asset_class_hint: assetClass })
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'suggestion failed');
      const { suggestion } = (await res.json()) as {
        suggestion: {
          summary: string;
          tolerances: {
            price_rel_tolerance: number;
            quantity_rel_tolerance: number;
            date_day_delta: number;
            bands: { high_min: number; medium_min: number };
          };
          llm_tiebreak_band: 'MEDIUM_ONLY' | 'ALL' | 'NONE';
          blocking_keys?: BlockingField[];
          enabled_stages?: PipelineStageId[];
          match_types?: MatchTypeLabel[];
          warnings: string[];
        };
      };
      setBandsHigh(suggestion.tolerances.bands.high_min);
      setBandsMedium(suggestion.tolerances.bands.medium_min);
      setPriceTol(suggestion.tolerances.price_rel_tolerance);
      setQtyTol(suggestion.tolerances.quantity_rel_tolerance);
      setDateDelta(suggestion.tolerances.date_day_delta);
      setTiebreakBand(suggestion.llm_tiebreak_band);
      if (suggestion.blocking_keys && suggestion.blocking_keys.length > 0) setBlockingKeys(suggestion.blocking_keys);
      if (suggestion.enabled_stages && suggestion.enabled_stages.length > 0) setEnabledStages(suggestion.enabled_stages);
      if (suggestion.match_types && suggestion.match_types.length > 0) setMatchTypes(suggestion.match_types);
      setLastSuggestion({ summary: suggestion.summary, warnings: suggestion.warnings });
      toast.success('AI suggestion applied — review, then Publish to save.');
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSuggesting(false);
    }
  };

  const currentConfig = {
    bands: { high_min: bandsHigh, medium_min: bandsMedium },
    tolerances: { price_rel_tolerance: priceTol, quantity_rel_tolerance: qtyTol, date_day_delta: dateDelta },
    llm_tiebreak_band: tiebreakBand,
    weights: undefined
  } as const;

  const detected = detectPreset({
    ...currentConfig,
    weights: {} as never
  });

  const applyPreset = (name: PresetName) => {
    if (name === 'CUSTOM') return;
    const p = PRESETS[name as Exclude<PresetName, 'CUSTOM'>];
    setBandsHigh(p.config.bands.high_min);
    setBandsMedium(p.config.bands.medium_min);
    setPriceTol(p.config.tolerances.price_rel_tolerance);
    setQtyTol(p.config.tolerances.quantity_rel_tolerance);
    setDateDelta(p.config.tolerances.date_day_delta);
    setTiebreakBand(p.config.llm_tiebreak_band);
    toast.success(`Loaded preset: ${p.name}`);
  };

  const publish = async () => {
    setPublishing(true);
    try {
      const res = await fetch('/api/pipeline/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipeline_id: activePipelineId ?? undefined,
          preset: detected,
          bands: currentConfig.bands,
          tolerances: currentConfig.tolerances,
          llm_tiebreak_band: tiebreakBand,
          blocking_keys: blockingKeys,
          enabled_stages: enabledStages,
          match_types: matchTypes,
          reason: `Published ${detected} via pipeline expert mode`
        })
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'publish failed');
      const data = await res.json();
      toast.success(`Published ruleset v${data.version}`);
      onPublished?.();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Expert mode — configure the matching pipeline
          <Badge variant="outline" className="ml-auto text-[10px]">
            {canEdit ? 'editable (manager)' : 'view-only'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* AI Suggester */}
        <div className="rounded border border-violet-200 bg-violet-50/60 p-3">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-600" />
                <span className="text-sm font-medium text-slate-800">Suggest pipeline with AI</span>
                <AiAssistedBadge />
              </div>
              <p className="text-[11px] text-slate-600 mt-1 leading-snug">
                GPT proposes tolerances and bands based on this pipeline&apos;s asset class and a sample of its feed. Review before publishing.
              </p>
              {lastSuggestion && (
                <div className="mt-2 text-[11px] text-slate-700">
                  <div className="font-medium">Last suggestion</div>
                  <div className="text-slate-600">{lastSuggestion.summary}</div>
                  {lastSuggestion.warnings.length > 0 && (
                    <ul className="mt-1 list-disc ml-4 text-amber-700">
                      {lastSuggestion.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-violet-300 text-violet-800 hover:bg-violet-100"
              onClick={suggestWithAI}
              disabled={!canEdit || suggesting}
            >
              {suggesting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
              {suggesting ? 'Thinking…' : 'Suggest with AI'}
            </Button>
          </div>
        </div>

        {/* Presets */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-mono mb-2">Preset profile</div>
          <div className="grid grid-cols-4 gap-2">
            {(['STRICT', 'BALANCED', 'LENIENT'] as const).map((key) => {
              const p = PRESETS[key];
              const isCurrent = detected === key;
              return (
                <button
                  key={key}
                  onClick={() => canEdit && applyPreset(key)}
                  disabled={!canEdit}
                  className={cn(
                    'rounded border p-3 text-left transition',
                    isCurrent ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:bg-slate-50',
                    !canEdit && 'opacity-60 cursor-not-allowed'
                  )}
                >
                  <div className="flex items-center gap-2">
                    {isCurrent && <CheckCircle2 className="h-3.5 w-3.5" />}
                    <span className="font-medium text-sm">{p.name}</span>
                  </div>
                  <p className={cn('text-[10px] mt-1 leading-snug', isCurrent ? 'text-slate-200' : 'text-slate-500')}>
                    {p.description.slice(0, 80)}…
                  </p>
                </button>
              );
            })}
            <div
              className={cn(
                'rounded border p-3 text-left',
                detected === 'CUSTOM' ? 'border-amber-300 bg-amber-50' : 'border-dashed border-slate-200 bg-slate-50/50'
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-slate-700">Custom</span>
                {detected === 'CUSTOM' && <Badge variant="outline" className="text-[9px] bg-white">unsaved</Badge>}
              </div>
              <p className="text-[10px] mt-1 text-slate-500 leading-snug">
                Any deviation from the three presets lands here. Publish to save.
              </p>
            </div>
          </div>
        </div>

        {/* Thresholds */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-mono mb-2">Bands &amp; tolerances</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <NumField
              label="HIGH band floor"
              hint="Posterior ≥ this → auto-suggest"
              value={bandsHigh}
              min={0.5}
              max={0.999}
              step={0.01}
              editable={canEdit}
              onChange={setBandsHigh}
            />
            <NumField
              label="MEDIUM band floor"
              hint="Between this and HIGH → analyst confirms"
              value={bandsMedium}
              min={0.3}
              max={0.9}
              step={0.01}
              editable={canEdit}
              onChange={setBandsMedium}
            />
            <NumField
              label="Price relative tolerance"
              hint="|a−b| / max · at which field score → 0"
              value={priceTol}
              min={0}
              max={0.2}
              step={0.001}
              editable={canEdit}
              onChange={setPriceTol}
              percent
            />
            <NumField
              label="Quantity relative tolerance"
              hint="Beyond this ⇒ WRONG_QTY exception"
              value={qtyTol}
              min={0}
              max={0.5}
              step={0.01}
              editable={canEdit}
              onChange={setQtyTol}
              percent
            />
            <NumField
              label="Date delta (days)"
              hint="Business days accepted for TIMING drift"
              value={dateDelta}
              min={0}
              max={5}
              step={1}
              editable={canEdit}
              onChange={setDateDelta}
            />
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-slate-500">LLM tiebreak band</Label>
                <AiAssistedBadge />
              </div>
              <Select
                value={tiebreakBand}
                onValueChange={(v) => canEdit && setTiebreakBand(v as typeof tiebreakBand)}
                disabled={!canEdit}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEDIUM_ONLY">MEDIUM only (recommended)</SelectItem>
                  <SelectItem value="ALL">All bands (expensive)</SelectItem>
                  <SelectItem value="NONE">Disabled</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-400">Which bands send to the AI tiebreak.</p>
            </div>
          </div>
        </div>

        {/* Per-pipeline structural config: blocking keys, stage enablement, match types */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-mono mb-2">
            Pipeline structure
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-slate-500">
                Blocking keys
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    'symbol',
                    'isin',
                    'cusip',
                    'trade_date',
                    'settlement_date',
                    'direction',
                    'currency',
                    'account'
                  ] as BlockingField[]
                ).map((k) => {
                  const on = blockingKeys.includes(k);
                  return (
                    <button
                      key={k}
                      disabled={!canEdit}
                      onClick={() => {
                        if (!canEdit) return;
                        setBlockingKeys((prev) =>
                          prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
                        );
                      }}
                      className={cn(
                        'text-[10px] font-mono px-2 py-0.5 rounded border transition',
                        on
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
                        !canEdit && 'opacity-60 cursor-not-allowed'
                      )}
                    >
                      {k}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-400">
                Fields grouped before scoring. Reduces candidate pairs 100–1000×.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-slate-500">
                Enabled stages
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    'normalize',
                    'hash',
                    'blocking',
                    'similarity',
                    'fellegi_sunter',
                    'hungarian',
                    'llm_tiebreak'
                  ] as PipelineStageId[]
                ).map((s) => {
                  const on = enabledStages.includes(s);
                  const forced = s === 'normalize' || s === 'fellegi_sunter';
                  return (
                    <button
                      key={s}
                      disabled={!canEdit || forced}
                      onClick={() => {
                        if (!canEdit || forced) return;
                        setEnabledStages((prev) =>
                          prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                        );
                      }}
                      className={cn(
                        'text-[10px] font-mono px-2 py-0.5 rounded border transition',
                        on
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-white text-slate-500 border-slate-200',
                        (forced || !canEdit) && 'opacity-80 cursor-not-allowed'
                      )}
                      title={forced ? 'Load-bearing — cannot disable' : undefined}
                    >
                      {s}
                      {forced && <span className="ml-1 opacity-70">•</span>}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-400">
                <span className="font-mono">normalize</span> + <span className="font-mono">fellegi_sunter</span> are always on.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-slate-500">
                Match types
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {(['1:1', '1:N', 'N:1', 'N:M'] as MatchTypeLabel[]).map((m) => {
                  const on = matchTypes.includes(m);
                  return (
                    <button
                      key={m}
                      disabled={!canEdit}
                      onClick={() => {
                        if (!canEdit) return;
                        setMatchTypes((prev) =>
                          prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
                        );
                      }}
                      className={cn(
                        'text-[10px] font-mono px-2 py-0.5 rounded border transition',
                        on
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
                        !canEdit && 'opacity-60 cursor-not-allowed'
                      )}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-400">
                Engine emits 1:1 today; 1:N/N:M stamp intent — full support tracked in ADR-012.
              </p>
            </div>
          </div>
        </div>

        {/* Publish */}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-200">
          <div className="text-xs text-slate-500">
            Active: <span className="font-mono text-slate-800">v{active?.version ?? 1}</span>
            {' · '}Detected: <span className="font-mono text-slate-800">{detected}</span>
          </div>
          {canEdit ? (
            <Button onClick={publish} disabled={publishing}>
              {publishing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Publish as new version
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Lock className="h-3 w-3" /> Only manager role can publish
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface NumFieldProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  editable: boolean;
  percent?: boolean;
  onChange: (v: number) => void;
}

function NumField({ label, hint, value, min, max, step, editable, percent, onChange }: NumFieldProps): React.ReactElement {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-slate-500">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          value={percent ? (value * 100).toFixed(2) : value}
          min={percent ? min * 100 : min}
          max={percent ? max * 100 : max}
          step={percent ? step * 100 : step}
          disabled={!editable}
          onChange={(e) => {
            const raw = Number(e.target.value);
            if (Number.isFinite(raw)) onChange(percent ? raw / 100 : raw);
          }}
          className="h-8 text-xs font-mono tabular-nums pr-7"
        />
        {percent && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">%</span>
        )}
      </div>
      <p className="text-[10px] text-slate-400">{hint}</p>
    </div>
  );
}
