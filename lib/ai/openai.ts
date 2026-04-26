import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { z, type ZodTypeAny } from 'zod';
import { supabaseService } from '@/lib/supabase/service';
import { logger } from '@/lib/logger/pino';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (_openai === null) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

export const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
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
  | 'DASHBOARD_NARRATIVE'
  | 'PIPELINE_SUGGEST';

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

export async function jsonCall<S extends ZodTypeAny>(
  opts: JsonCallOptions<S>
): Promise<z.infer<S>> {
  const prompt = `${opts.system}\n\n---\n${opts.user}`;
  const started = Date.now();

  try {
    const systemWithJsonHint =
      opts.system +
      '\n\nReturn ONLY a single JSON object — no markdown, no prose, no code fences.';

    const response = await getOpenAI().chat.completions.create({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemWithJsonHint },
        { role: 'user', content: opts.user }
      ]
    });

    const latency_ms = Date.now() - started;
    const raw = response.choices[0]?.message?.content ?? '';
    const jsonStr = extractJson(raw);
    const parsed = JSON.parse(jsonStr);
    const validated = opts.schema.parse(parsed);

    await logCall({
      call_type: opts.call_type,
      model: MODEL,
      prompt,
      input_tokens: response.usage?.prompt_tokens ?? null,
      output_tokens: response.usage?.completion_tokens ?? null,
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

export interface TextCallOptions {
  call_type: AiCallType;
  system: string;
  user: string;
  actor: string | null;
  fallback?: string;
  max_tokens?: number;
}

export async function textCall(opts: TextCallOptions): Promise<string> {
  const fallback = opts.fallback ?? '';
  const prompt = `${opts.system}\n\n---\n${opts.user}`;
  const started = Date.now();
  try {
    const response = await getOpenAI().chat.completions.create({
      model: MODEL,
      max_completion_tokens: opts.max_tokens ?? 2048,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user }
      ]
    });
    const latency_ms = Date.now() - started;
    const out = response.choices[0]?.message?.content ?? '';
    await logCall({
      call_type: opts.call_type,
      model: MODEL,
      prompt,
      input_tokens: response.usage?.prompt_tokens ?? null,
      output_tokens: response.usage?.completion_tokens ?? null,
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
      output: { error: String(err), fallback },
      fallback_used: true,
      actor: opts.actor
    });
    return fallback;
  }
}

export async function embed(text: string, actor: string | null = null): Promise<number[]> {
  const started = Date.now();
  try {
    const res = await getOpenAI().embeddings.create({ model: EMBED_MODEL, input: text });
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

export async function embedBatch(
  texts: string[],
  actor: string | null = null
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const started = Date.now();
  try {
    const res = await getOpenAI().embeddings.create({ model: EMBED_MODEL, input: texts });
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
