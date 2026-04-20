import { cn } from '@/lib/utils';
import type { MatchBand } from '@/lib/canonical/schema';

const BAND_STYLES: Record<MatchBand, string> = {
  HIGH: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
  LOW: 'bg-rose-50 text-rose-700 border-rose-200'
};

const BAND_DOT: Record<MatchBand, string> = {
  HIGH: 'bg-emerald-500',
  MEDIUM: 'bg-amber-500',
  LOW: 'bg-rose-500'
};

const BAND_DIVIDER: Record<MatchBand, string> = {
  HIGH: 'bg-emerald-300/60',
  MEDIUM: 'bg-amber-300/60',
  LOW: 'bg-rose-300/70'
};

export function BandChip({
  band,
  posterior,
  className
}: {
  band: MatchBand;
  posterior?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wider',
        BAND_STYLES[band],
        className
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', BAND_DOT[band])} />
      <span>{band}</span>
      {posterior !== undefined && (
        <>
          <span
            aria-hidden="true"
            className={cn('h-3 w-px shrink-0 rounded-full', BAND_DIVIDER[band])}
          />
          <span
            className="font-mono tabular-nums text-2xs font-medium opacity-80"
            title={`Fellegi-Sunter posterior probability: ${posterior.toFixed(3)}`}
          >
            p={posterior.toFixed(2)}
          </span>
        </>
      )}
    </span>
  );
}
