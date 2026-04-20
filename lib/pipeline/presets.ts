import type { PipelineConfigView } from './stages';
import { DEFAULT_WEIGHTS } from '@/lib/matching/fellegi_sunter';

export type PresetName = 'STRICT' | 'BALANCED' | 'LENIENT' | 'CUSTOM';

export interface PresetProfile {
  id: PresetName;
  name: string;
  description: string;
  config: PipelineConfigView;
}

const baseTolerances = {
  price_rel_tolerance: 0.01,
  quantity_rel_tolerance: 0.05,
  date_day_delta: 1
};

export const PRESETS: Record<Exclude<PresetName, 'CUSTOM'>, PresetProfile> = {
  STRICT: {
    id: 'STRICT',
    name: 'Strict',
    description: 'Higher confidence thresholds. Fewer auto-matches, more analyst review. Suitable for high-value or regulated flows.',
    config: {
      bands: { high_min: 0.98, medium_min: 0.8 },
      weights: DEFAULT_WEIGHTS,
      tolerances: {
        price_rel_tolerance: 0.005,
        quantity_rel_tolerance: 0.02,
        date_day_delta: 0
      },
      llm_tiebreak_band: 'ALL'
    }
  },
  BALANCED: {
    id: 'BALANCED',
    name: 'Balanced',
    description: 'Default industry-standard thresholds. Optimal tradeoff between throughput and risk for most equity flows.',
    config: {
      bands: { high_min: 0.95, medium_min: 0.7 },
      weights: DEFAULT_WEIGHTS,
      tolerances: baseTolerances,
      llm_tiebreak_band: 'MEDIUM_ONLY'
    }
  },
  LENIENT: {
    id: 'LENIENT',
    name: 'Lenient',
    description: 'Lower thresholds. More auto-matches, less analyst work. Suitable for retail flows or high-volume low-risk cohorts.',
    config: {
      bands: { high_min: 0.9, medium_min: 0.6 },
      weights: DEFAULT_WEIGHTS,
      tolerances: {
        price_rel_tolerance: 0.02,
        quantity_rel_tolerance: 0.1,
        date_day_delta: 2
      },
      llm_tiebreak_band: 'MEDIUM_ONLY'
    }
  }
};

export function detectPreset(config: PipelineConfigView): PresetName {
  const match = (Object.values(PRESETS) as PresetProfile[]).find(
    (p) =>
      p.config.bands.high_min === config.bands.high_min &&
      p.config.bands.medium_min === config.bands.medium_min &&
      p.config.tolerances.price_rel_tolerance === config.tolerances.price_rel_tolerance &&
      p.config.tolerances.quantity_rel_tolerance === config.tolerances.quantity_rel_tolerance &&
      p.config.tolerances.date_day_delta === config.tolerances.date_day_delta &&
      p.config.llm_tiebreak_band === config.llm_tiebreak_band
  );
  return match?.id ?? 'CUSTOM';
}
