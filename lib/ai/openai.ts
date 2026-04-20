import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { z, type ZodTypeAny } from 'zod';
import { supabaseService } from '@/lib/supabase/service';
import { logger } from '@/lib/logger/pino';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.4';
export const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';

export type AiCallType =
  | 'INFER_SCHEMA'
  | 'EMBED'
  | 'TIEBREAK'
  | 'EXPLAIN_BREAK'
  | 'NEXT_BEST_ACTION'
  | 'RULE_DRAFT'
  | 'SEARCH_PARSE'
  | 'WORKSPACE_SUMMARY'
  | 'DASHBOARD_NARRATIVE';

interface LogArgs {
  call_type: AiCallType;
  model: string;
  prompt: string;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  output: unknown;
  fallback_used: boolean;
  actor: string | null;
  request_id?: string;
}

async function logCall(args: LogArgs) {
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
      actor: args.actor,
      request_id: args.request_id ?? null
    });
  } catch (err) {
    logger.error({ err }, 'failed to log ai_call');
  }
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    return trimmed.slice(braceStart, braceEnd + 1);
  }
  return trimmed;
}

export interface JsonCallOptions<S extends ZodTypeAny> {
  call_type: AiCallType;
  system: string;
  user: string;
  schema: S;
  fallback: z.infer<S>;
  actor: string | null;
  request_id?: string;
}

/**
 * Calls GPT-5.4 via the Responses API and validates JSON output via Zod.
 * Falls back to `opts.fallback` on any error; every outcome is logged to ai_calls.
 */
export async function jsonCall<S extends ZodTypeAny>(
  opts: JsonCallOptions<S>
): Promise<z.infer<S>> {
  const prompt = `${opts.system}\n\n---\n${opts.user}`;
  const started = Date.now();

  try {
    const instructions =
      opts.system +
      '\n\nReturn ONLY a single JSON object — no markdown, no prose, no code fences.';

    const response = await client.responses.create({
      model: MODEL,
      instructions,
      input: opts.user
    });

    const latency_ms = Date.now() - started;
    const raw = response.output_text ?? '';
    const jsonStr = extractJson(raw);
    const parsed = JSON.parse(jsonStr);
    const validated = opts.schema.parse(parsed);

    await logCall({
      call_type: opts.call_type,
      model: MODEL,
      prompt,
      input_tokens: response.usage?.input_tokens ?? null,
      output_tokens: response.usage?.output_tokens ?? null,
      latency_ms,
      output: validated,
      fallback_used: false,
      actor: opts.actor,
      request_id: opts.request_id
    });

    return validated;
  } catch (err) {
    const latency_ms = Date.now() - started;
    logger.error({ err, call_type: opts.call_type }, 'ai jsonCall failed, using fallback');
    await logCall({
      call_type: opts.call_type,
      model: MODEL,
      prompt,
      input_tokens: null,
      output_tokens: null,
      latency_ms,
      output: { error: String(err), fallback: opts.fallback },
      fallback_used: true,
      actor: opts.actor,
      request_id: opts.request_id
    });
    return opts.fallback;
  }
}

/**
 * Freeform text generation (for dashboard narratives, copilot messages).
 * Not Zod-validated — caller is responsible.
 */
export async function textCall(opts: {
  call_type: AiCallType;
  system: string;
  user: string;
  actor: string | null;
}): Promise<string> {
  const prompt = `${opts.system}\n\n---\n${opts.user}`;
  const started = Date.now();
  try {
    const response = await client.responses.create({
      model: MODEL,
      instructions: opts.system,
      input: opts.user
    });
    const latency_ms = Date.now() - started;
    const out = response.output_text ?? '';
    await logCall({
      call_type: opts.call_type,
      model: MODEL,
      prompt,
      input_tokens: response.usage?.input_tokens ?? null,
      output_tokens: response.usage?.output_tokens ?? null,
      latency_ms,
      output: { text: out },
      fallback_used: false,
      actor: opts.actor
    });
    return out;
  } catch (err) {
    logger.error({ err }, 'textCall failed');
    await logCall({
      call_type: opts.call_type,
      model: MODEL,
      prompt,
      input_tokens: null,
      output_tokens: null,
      latency_ms: Date.now() - started,
      output: { error: String(err) },
      fallback_used: true,
      actor: opts.actor
    });
    return '';
  }
}

export async function embed(text: string, actor: string | null = null): Promise<number[]> {
  const started = Date.now();
  try {
    const res = await client.embeddings.create({
      model: EMBED_MODEL,
      input: text
    });
    const vec = res.data[0]?.embedding ?? [];
    await logCall({
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
    await logCall({
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
export async function embedBatch(texts: string[], actor: string | null = null): Promise<number[][]> {
  if (texts.length === 0) return [];
  const started = Date.now();
  try {
    const res = await client.embeddings.create({
      model: EMBED_MODEL,
      input: texts
    });
    const vecs = res.data.map((d) => d.embedding);
    await logCall({
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
