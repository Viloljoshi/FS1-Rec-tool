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
import { SlidersHorizontal, CheckCircle2, Lock, Loader2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ActiveRule {
  version: number;
  tolerances: {
    price_rel_tolerance?: number;
    quantity_rel_tolerance?: number;
    date_day_delta?: number;
    bands?: { high_min: number; medium_min: number };
    llm_tiebreak_band?: 'MEDIUM_ONLY' | 'ALL' | 'NONE';
    preset?: string;
  } | null;
}

interface ExpertModeProps {
  active: ActiveRule | null;
  canEdit: boolean;
  onPublished?: () => void;
}

export function ExpertMode({ active, canEdit, onPublished }: ExpertModeProps): React.ReactElement {
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
  const [publishing, setPublishing] = useState(false);

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
          preset: detected,
          bands: currentConfig.bands,
          tolerances: currentConfig.tolerances,
          llm_tiebreak_band: tiebreakBand,
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
