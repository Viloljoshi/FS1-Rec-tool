/**
 * lib/ai/openai.ts — EMBEDDINGS ONLY.
 *
 * Chat/completion lives in lib/ai/anthropic.ts (Claude Sonnet 4.6). This file
 * keeps its name for import-compat — every prompt file still does
 * `import { jsonCall } from '@/lib/ai/openai'`, and we re-export from here.
 *
 * Only embeddings remain on OpenAI (text-embedding-3-small) because Anthropic
 * does not offer an embeddings API. See ADR-013.
 */

import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { supabaseService } from '@/lib/supabase/service';
import { logger } from '@/lib/logger/pino';

/**
 * Lazy client — avoid crashing at module load when OPENAI_API_KEY isn't
 * available. Next.js evaluates this module during `next build` (page-data
 * collection); a missing env var there would abort the build even though
 * no embedding is being computed. Initialize on first use instead.
 */
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (_openai === null) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

export const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';

// Re-export the chat surface so prompt files don't need import changes.
export {
  jsonCall,
  textCall,
  CHAT_MODEL as MODEL,
  type AiCallType,
  type JsonCallOptions,
  type TextCallOptions
} from './anthropic';

import type { AiCallType } from './anthropic';

interface EmbedLogArgs {
  call_type: AiCallType;
  model: string;
  prompt: string;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  output: unknown;
  fallback_used: boolean;
  actor: string | null;
}

async function logEmbed(args: EmbedLogArgs): Promise<void> {
  try {
    const sb = supabaseService();
    const prompt_hash = createHash('sha256').update(args.prompt).digest('hex');
    await sb.from('ai_calls').insert({
      call_type: args.call_type,
      model: args.model,
      prompt_hash,
      input_tokens: args.input_tokens,
      output_tokens: args.output_tokens,
      latency_ms: args.latency_ms,
      output: args.output as object,
      fallback_used: args.fallback_used,
      actor: args.actor
    });
  } catch (err) {
    logger.error({ err }, 'failed to log embed ai_call');
  }
}

export async function embed(text: string, actor: string | null = null): Promise<number[]> {
  const started = Date.now();
  try {
    const res = await getOpenAI().embeddings.create({ model: EMBED_MODEL, input: text });
    const vec = res.data[0]?.embedding ?? [];
    await logEmbed({
      call_type: 'EMBED',
      model: EMBED_MODEL,
      prompt: text,
      input_tokens: res.usage?.prompt_tokens ?? null,
      output_tokens: null,
      latency_ms: Date.now() - started,
      output: { length: vec.length },
      fallback_used: false,
      actor
    });
    return vec;
  } catch (err) {
    logger.error({ err }, 'embed failed');
    await logEmbed({
      call_type: 'EMBED',
      model: EMBED_MODEL,
      prompt: text,
      input_tokens: null,
      output_tokens: null,
      latency_ms: Date.now() - started,
      output: { error: String(err) },
      fallback_used: true,
      actor
    });
    return [];
  }
}

/**
 * Batched embeddings — for seed/canonicalization time when we have many unique
 * counterparty strings to embed at once.
 */
export async function embedBatch(
  texts: string[],
  actor: string | null = null
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const started = Date.now();
  try {
    const res = await getOpenAI().embeddings.create({ model: EMBED_MODEL, input: texts });
    const vecs = res.data.map((d) => d.embedding);
    await logEmbed({
      call_type: 'EMBED',
      model: EMBED_MODEL,
      prompt: texts.join('||'),
      input_tokens: res.usage?.prompt_tokens ?? null,
      output_tokens: null,
      latency_ms: Date.now() - started,
      output: { count: vecs.length, dims: vecs[0]?.length ?? 0 },
      fallback_used: false,
      actor
    });
    return vecs;
  } catch (err) {
    logger.error({ err }, 'embedBatch failed');
    return texts.map(() => []);
  }
}
