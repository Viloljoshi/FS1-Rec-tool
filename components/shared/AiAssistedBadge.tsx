'use client';

import { Sparkles } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface AiAssistedBadgeProps {
  timestamp?: string | Date;
  /** @deprecated retained for compatibility; no longer surfaced in the UI. */
  model?: string;
}

export function AiAssistedBadge({ timestamp }: AiAssistedBadgeProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-violet-700">
            <Sparkles className="h-3 w-3" />
            AI-assisted
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-xs">
          <div className="space-y-0.5">
            <div>Output produced by a reasoning model.</div>
            {timestamp && (
              <div className="text-slate-400 font-mono">
                {typeof timestamp === 'string' ? timestamp : timestamp.toISOString()}
              </div>
            )}
            <div className="text-slate-300">
              Logged in <span className="font-mono">ai_calls</span>. Has deterministic fallback.
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
