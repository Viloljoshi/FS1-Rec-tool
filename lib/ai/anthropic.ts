import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { z, type ZodTypeAny } from 'zod';
import { supabaseService } from '@/lib/supabase/service';
import { logger } from '@/lib/logger/pino';

/**
 * Extract a JSON object/array from Claude's response text. Claude Sonnet 4.6
 * reliably emits bare JSON when the system prompt says "JSON only" — we
 * additionally handle fenced code blocks and leading prose defensively.
 */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) return trimmed.slice(braceStart, braceEnd + 1);
  const bracketStart = trimmed.indexOf('[');
  const bracketEnd = trimmed.lastIndexOf(']');
  if (bracketStart >= 0 && bracketEnd > bracketStart) return trimmed.slice(bracketStart, bracketEnd + 1);
  return trimmed;
}

/**
 * Lazy client — instantiating Anthropic() reads ANTHROPIC_API_KEY and throws
 * if missing. Next.js evaluates server modules during `next build` to collect
 * page data, which would fail the build on environments that don't expose
 * runtime secrets at build time (Netlify Builds scope, CI caches, etc.).
 * Initialize on first use instead.
 */
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client === null) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/**
 * Per-seam model routing. Reasoning-heavy seams (tiebreak, schema inference,
 * pipeline suggestion, rule drafts, NL search parsing) get Sonnet; simpler
 * high-volume seams (explanation, next-best-action, summaries, narratives)
 * get Haiku. ~5× cheaper per call for equivalent quality on short outputs.
 *
 * Override per tier via ANTHROPIC_MODEL_SONNET / ANTHROPIC_MODEL_HAIKU env
 * vars. ANTHROPIC_MODEL is kept as the Sonnet default for back-compat.
 */
const SONNET_MODEL =
  process.env.ANTHROPIC_MODEL_SONNET ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
const HAIKU_MODEL = process.env.ANTHROPIC_MODEL_HAIKU ?? 'claude-haiku-4-5';
/** Back-compat export for modules that imported the singular MODEL constant. */
export const CHAT_MODEL = SONNET_MODEL;
const DEFAULT_MAX_TOKENS = 16000;

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

type ModelTier = 'sonnet' | 'haiku';

const TIER_BY_CALL_TYPE: Record<AiCallType, ModelTier> = {
  TIEBREAK: 'sonnet',
  INFER_SCHEMA: 'sonnet',
  PIPELINE_SUGGEST: 'sonnet',
  RULE_DRAFT: 'sonnet',
  SEARCH_PARSE: 'sonnet',
  EXPLAIN_BREAK: 'haiku',
  NEXT_BEST_ACTION: 'haiku',
  WORKSPACE_SUMMARY: 'haiku',
  DASHBOARD_NARRATIVE: 'haiku',
  EMBED: 'sonnet' // never invoked via this wrapper; embeddings go through OpenAI
};

function modelFor(call_type: AiCallType): string {
  return TIER_BY_CALL_TYPE[call_type] === 'haiku' ? HAIKU_MODEL : SONNET_MODEL;
}

interface LogArgs {
  call_type: AiCallType;
  model: string;
  prompt: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  latency_ms: number;
  output: unknown;
  fallback_used: boolean;
  actor: string | null;
  request_id?: string;
  refusal?: boolean;
}

async function logCall(args: LogArgs): Promise<void> {
  try {
    const sb = supabaseService();
    const prompt_hash = createHash('sha256').update(args.prompt).digest('hex');
    await sb.from('ai_calls').insert({
      call_type: args.call_type,
      model: args.model,
      prompt_hash,
      input_tokens: args.input_tokens,
      output_tokens: args.output_tokens,
      cache_read_tokens: args.cache_read_tokens,
      cache_creation_tokens: args.cache_creation_tokens,
      latency_ms: args.latency_ms,
      output: args.output as object,
      fallback_used: args.fallback_used,
      actor: args.actor,
      request_id: args.request_id ?? null,
      refusal: args.refusal ?? false
    });
  } catch (err) {
    logger.error({ err }, 'failed to log ai_call');
  }
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
 * Calls Claude Sonnet 4.6 with Zod-enforced structured output. On any failure
 * — API error, refusal, schema mismatch — logs the outcome and returns
 * opts.fallback so callers never have to handle AI errors themselves.
 *
 * Prompt caching: the system prompt is wrapped with cache_control. Sonnet 4.6
 * requires a ≥2048-token prefix to actually cache, so short system prompts
 * won't hit the cache today — the marker is harmless and future-proofs growth.
 */
export async function jsonCall<S extends ZodTypeAny>(
  opts: JsonCallOptions<S>
): Promise<z.infer<S>> {
  const prompt = `${opts.system}\n\n---\n${opts.user}`;
  const started = Date.now();

  try {
    // System prompt enforces JSON-only output; we parse + Zod-validate the text
    // response. This avoids the SDK's zodOutputFormat helper which requires
    // Zod v4 shape (this repo is on Zod 3.x).
    const systemWithJsonHint =
      opts.system +
      '\n\nIMPORTANT: Respond with a single JSON object only. No prose before or after. No markdown code fences.';

    const response = await getClient().messages.create({
      model: modelFor(opts.call_type),
      max_tokens: DEFAULT_MAX_TOKENS,
      system: [
        { type: 'text', text: systemWithJsonHint, cache_control: { type: 'ephemeral' } }
      ],
      messages: [{ role: 'user', content: opts.user }]
    });

    const latency_ms = Date.now() - started;
    const usage = response.usage;

    if (response.stop_reason === 'refusal') {
      await logCall({
        call_type: opts.call_type,
        model: modelFor(opts.call_type),
        prompt,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_tokens: usage.cache_read_input_tokens ?? 0,
        cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
        latency_ms,
        output: { refusal: true, fallback: opts.fallback },
        fallback_used: true,
        actor: opts.actor,
        request_id: opts.request_id,
        refusal: true
      });
      return opts.fallback;
    }

    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const jsonStr = extractJson(raw);
    const parsed = JSON.parse(jsonStr);
    const validated = opts.schema.parse(parsed);

    await logCall({
      call_type: opts.call_type,
      model: modelFor(opts.call_type),
      prompt,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
      latency_ms,
      output: validated,
      fallback_used: false,
      actor: opts.actor,
      request_id: opts.request_id
    });

    return validated as z.infer<S>;
  } catch (err) {
    const latency_ms = Date.now() - started;
    const kind =
      err instanceof Anthropic.RateLimitError
        ? 'rate_limit'
        : err instanceof Anthropic.InternalServerError
          ? 'server_error'
          : err instanceof Anthropic.BadRequestError
            ? 'bad_request'
            : err instanceof Anthropic.APIError
              ? 'api_error'
              : err instanceof z.ZodError
                ? 'zod_error'
                : 'unknown';
    logger.error({ err, kind, call_type: opts.call_type }, 'ai jsonCall failed, using fallback');
    await logCall({
      call_type: opts.call_type,
      model: modelFor(opts.call_type),
      prompt,
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      latency_ms,
      output: { error: String(err), error_kind: kind, fallback: opts.fallback },
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
  fallback?: string;
  actor: string | null;
  max_tokens?: number;
}

/** Plain-text output. Used by workspace summary + dashboard narrative. */
export async function textCall(opts: TextCallOptions): Promise<string> {
  const fallback = opts.fallback ?? '';
  const prompt = `${opts.system}\n\n---\n${opts.user}`;
  const started = Date.now();
  try {
    const response = await getClient().messages.create({
      model: modelFor(opts.call_type),
      max_tokens: opts.max_tokens ?? 2048,
      system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: opts.user }]
    });

    const latency_ms = Date.now() - started;
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    await logCall({
      call_type: opts.call_type,
      model: modelFor(opts.call_type),
      prompt,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_creation_tokens: response.usage.cache_creation_input_tokens ?? 0,
      latency_ms,
      output: text,
      fallback_used: false,
      actor: opts.actor
    });
    return text;
  } catch (err) {
    const latency_ms = Date.now() - started;
    logger.error({ err, call_type: opts.call_type }, 'ai textCall failed, using fallback');
    await logCall({
      call_type: opts.call_type,
      model: modelFor(opts.call_type),
      prompt,
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      latency_ms,
      output: { error: String(err), fallback },
      fallback_used: true,
      actor: opts.actor
    });
    return fallback;
  }
}
