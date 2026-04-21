import { NextResponse } from 'next/server';
import { z } from 'zod';
import { friendlyZodError } from '@/lib/api/errors';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseService } from '@/lib/supabase/service';
import { getCurrentUser } from '@/lib/rbac/server';
import { recordAudit } from '@/lib/audit/log';
import { CANONICAL_FIELDS, type CanonicalField, missingRequiredFields } from '@/lib/canonical/schema';
import { SanitizedRowSchema } from '@/lib/canonical/row-sanitizer';
import { runMatchingCycle } from '@/lib/matching/run-cycle';
import { embedBatch } from '@/lib/ai/openai';
import { logger } from '@/lib/logger/pino';
import { resolveCounterparty } from '@/lib/kg/queries';
import { resolveNextFeedVersion, retirePriorFeedVersion } from '@/lib/feed/version';
import {
  tryNormalizeDate,
  tryNormalizeDirection,
  normalizeIdentifier,
  normalizeSymbol,
  tryNormalizeCurrency,
  normalizeAccount,
  parseNumericStrict
} from '@/lib/canonical/normalize';

const ProcessSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z.enum(['BROKER', 'CUSTODIAN', 'INTERNAL', 'OTHER']),
  notes: z.string().max(500).optional(),
  pipeline_id: z.string().uuid().optional(),
  // When false, skip the automatic matching cycle (reconcile flow handles it separately)
  run_cycle: z.boolean().optional().default(true),
  mappings: z.array(
    z.object({
      source_field: z.string(),
      canonical_field: z.enum(CANONICAL_FIELDS),
      confidence: z.number().min(0).max(1).optional(),
      ai_reasoning: z.string().max(500).optional()
    })
  ).min(1),
  rows: z.array(SanitizedRowSchema).max(10_000)
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (user.role !== 'analyst' && user.role !== 'manager') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const parsed = ProcessSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(friendlyZodError(parsed.error), { status: 400 });
  }

  // Preflight: reject feeds missing any non-negotiable canonical field.
  // Without these, every row skips at canonicalization and the cycle lands
  // on an empty workspace with no explanation. Fail loudly, not silently.
  const mappedFields = parsed.data.mappings.map((m) => m.canonical_field);
  const missing = missingRequiredFields(mappedFields);
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: 'missing_required_fields',
        missing,
        message: `Feed is missing required canonical fields: ${missing.join(', ')}. Map these before saving, or upload a flattened version of the file.`
      },
      { status: 400 }
    );
  }

  const supabase = await supabaseServer();
  const service = supabaseService();

  // 1. Create feed_profile (new version) via shared version resolver
  const versionInfo = await resolveNextFeedVersion(supabase, parsed.data.name);
  await retirePriorFeedVersion(service, versionInfo);
  const feedId = versionInfo.feedId ?? crypto.randomUUID();
  const version = versionInfo.nextVersion;

  const { error: insErr } = await service
    .from('feed_profiles')
    .insert({
      id: feedId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      version,
      notes: parsed.data.notes,
      created_by: user.id
    });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // 2. Insert field_mappings
  const mappingRows = parsed.data.mappings.map((m) => ({
    feed_profile_id: feedId,
    feed_profile_version: version,
    source_field: m.source_field,
    canonical_field: m.canonical_field,
    confidence: m.confidence ?? null,
    ai_reasoning: m.ai_reasoning ?? null,
    confirmed_by: user.id
  }));
  const { error: mapErr } = await service.from('field_mappings').insert(mappingRows);
  if (mapErr) return NextResponse.json({ error: mapErr.message }, { status: 500 });

  // 3. Build a mapping index: canonical_field -> source_field
  const byCanonical = new Map<CanonicalField, string>();
  for (const m of parsed.data.mappings) {
    byCanonical.set(m.canonical_field, m.source_field);
  }

  // 4. Insert trades_raw in batches, capture ids
  const rowsToInsert = parsed.data.rows.map((r, i) => ({
    feed_profile_id: feedId,
    feed_profile_version: version,
    row_index: i,
    payload: r,
    uploaded_by: user.id
  }));

  const rawIdByIndex = new Map<number, string>();
  for (let i = 0; i < rowsToInsert.length; i += 200) {
    const batch = rowsToInsert.slice(i, i + 200);
    const { data: inserted, error } = await service
      .from('trades_raw')
      .insert(batch)
      .select('id, row_index');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of inserted ?? []) rawIdByIndex.set(row.row_index, row.id);
  }

  // 5. Fetch CP entity resolution maps (Postgres fallback for KG misses)
  // Ordered fetches so the Map-last-write-wins rule is deterministic when
  // two rows share a key (rare, but real — e.g. two aliases with same
  // normalized form mapping to different entities).
  const { data: cpEntities } = await service
    .from('counterparty_entities')
    .select('id, canonical_name')
    .order('id', { ascending: true });
  const { data: aliases } = await service
    .from('counterparty_aliases')
    .select('entity_id, alias, normalized_alias')
    .order('entity_id', { ascending: true });
  const cpByName = new Map((cpEntities ?? []).map((e) => [e.canonical_name.toLowerCase(), e.id]));
  const cpByAlias = new Map((aliases ?? []).map((a) => [a.alias.toLowerCase(), a.entity_id]));
  const cpByNorm = new Map((aliases ?? []).map((a) => [a.normalized_alias.toLowerCase(), a.entity_id]));

  // Counterparty resolution. Postgres projection first (in-memory maps, microseconds),
  // then a single KG lookup per *novel* name only. Seeded aliases resolve
  // via Postgres; novel aliases fall through to Neo4j. Matches CLAUDE.md #10
  // ("Neo4j is the reference-data system") without blocking ingest on per-row RTTs.
  type ResolveVia = 'pg-name' | 'pg-alias' | 'pg-norm' | 'kg' | 'none';
  const kgCache = new Map<string, { id: string | null; via: ResolveVia }>();
  const kgStats = { kg: 0, pgName: 0, pgAlias: 0, pgNorm: 0, none: 0 };

  const resolveFromPostgres = (key: string): { id: string; via: ResolveVia } | null => {
    const normAliasKey = key.replace(/[.,&]/g, '').replace(/\s+/g, ' ').trim();
    const byName = cpByName.get(key);
    if (byName) return { id: byName, via: 'pg-name' };
    const byAlias = cpByAlias.get(key);
    if (byAlias) return { id: byAlias, via: 'pg-alias' };
    const byNorm = cpByNorm.get(normAliasKey);
    if (byNorm) return { id: byNorm, via: 'pg-norm' };
    return null;
  };

  // Phase A — collect every unique raw counterparty string, resolve from Postgres
  //           synchronously, collect KG-fallback candidates.
  const uniqueCps = new Set<string>();
  for (const row of parsed.data.rows) {
    const raw = (row.counterparty ?? '').toString().trim();
    if (raw) uniqueCps.add(raw);
  }
  const kgFallbackCandidates: string[] = [];
  for (const raw of uniqueCps) {
    const key = raw.toLowerCase();
    const pg = resolveFromPostgres(key);
    if (pg) {
      kgCache.set(key, pg);
      continue;
    }
    kgFallbackCandidates.push(raw);
  }

  // Phase B — for Postgres misses only, hit the KG in parallel (capped).
  //           Most ingests will have 0–5 novel names, so this stays fast.
  if (kgFallbackCandidates.length > 0) {
    const CONCURRENCY = 4;
    let idx = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, kgFallbackCandidates.length) }, async () => {
        while (true) {
          const my = idx++;
          if (my >= kgFallbackCandidates.length) return;
          const raw = kgFallbackCandidates[my]!;
          const key = raw.toLowerCase();
          try {
            const kg = await resolveCounterparty(raw);
            kgCache.set(
              key,
              kg?.id ? { id: kg.id, via: 'kg' } : { id: null, via: 'none' }
            );
          } catch (err) {
            logger.warn({ err, raw }, 'KG resolveCounterparty threw — marking as none');
            kgCache.set(key, { id: null, via: 'none' });
          }
        }
      })
    );
  }

  const resolveCp = (cpRaw: string): { id: string | null; via: ResolveVia } => {
    const key = cpRaw.toLowerCase().trim();
    if (!key) return { id: null, via: 'none' };
    return kgCache.get(key) ?? { id: null, via: 'none' };
  };

  // 6. Canonicalize + insert trades_canonical
  const get = (row: Record<string, string>, cf: CanonicalField): string | undefined =>
    byCanonical.get(cf) ? row[byCanonical.get(cf)!] : undefined;

  const canonicalInserts: Array<Record<string, unknown>> = [];
  const skipReasons: Record<string, number> = {};
  const sampleSkips: Array<{ row_index: number; reason: string; sample: Record<string, string> }> = [];
  const bumpSkip = (reason: string, rowIndex: number, row: Record<string, string>): void => {
    skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
    if (sampleSkips.length < 5) sampleSkips.push({ row_index: rowIndex, reason, sample: row });
  };
  let skipped = 0;
  for (let i = 0; i < parsed.data.rows.length; i++) {
    const row = parsed.data.rows[i]!;
    try {
      const tradeDate = tryNormalizeDate(get(row, 'trade_date') ?? get(row, 'settlement_date'));
      const settleDate = tryNormalizeDate(get(row, 'settlement_date') ?? get(row, 'trade_date')) ?? tradeDate;
      if (!tradeDate || !settleDate) {
        skipped++;
        bumpSkip('unparseable_date', i, row);
        continue;
      }

      // Direction: must normalize to BUY/SELL. Previously we silently
      // defaulted unknown → BUY, which let rows like "HOLD" or "1" (when
      // the mapping didn't know FIX codes) land in canonical as BUY.
      const direction = tryNormalizeDirection(get(row, 'direction'));
      if (direction === null) {
        skipped++;
        bumpSkip('invalid_direction', i, row);
        continue;
      }

      // Quantity: strict parse so "60,2499" (4 digits after lone comma) is
      // rejected as ambiguous rather than becoming 602499 silently.
      const qtyResult = parseNumericStrict(get(row, 'quantity'));
      const quantity = qtyResult.value;
      if (quantity === null) {
        skipped++;
        bumpSkip(
          qtyResult.reason === 'ambiguous_decimal' ? 'ambiguous_quantity' : 'unparseable_quantity',
          i,
          row
        );
        continue;
      }
      if (quantity <= 0) {
        skipped++;
        bumpSkip('non_positive_quantity', i, row);
        continue;
      }

      const priceResult = parseNumericStrict(get(row, 'price'));
      const price = priceResult.value;
      if (price === null) {
        skipped++;
        bumpSkip(
          priceResult.reason === 'ambiguous_decimal' ? 'ambiguous_price' : 'unparseable_price',
          i,
          row
        );
        continue;
      }
      if (price < 0) {
        skipped++;
        bumpSkip('negative_price', i, row);
        continue;
      }

      // Currency: must be a known ISO-4217 code. We used to silently slice
      // the raw string to 3 chars, which let "XYZ" into canonical trades.
      const currency = tryNormalizeCurrency(get(row, 'currency') ?? 'USD');
      if (currency === null) {
        skipped++;
        bumpSkip('invalid_currency', i, row);
        continue;
      }

      const cpRaw = get(row, 'counterparty') ?? '';
      const resolved = resolveCp(cpRaw);
      const cpId = resolved.id;
      if (resolved.via === 'kg') kgStats.kg++;
      else if (resolved.via === 'pg-name') kgStats.pgName++;
      else if (resolved.via === 'pg-alias') kgStats.pgAlias++;
      else if (resolved.via === 'pg-norm') kgStats.pgNorm++;
      else kgStats.none++;

      canonicalInserts.push({
        source_id: feedId,
        source_version: version,
        source_ref: get(row, 'source_ref') ?? `row-${i}`,
        trade_date: tradeDate,
        settlement_date: settleDate,
        direction,
        symbol: normalizeSymbol(get(row, 'symbol') ?? 'UNK'),
        isin: normalizeIdentifier(get(row, 'isin')),
        cusip: normalizeIdentifier(get(row, 'cusip')),
        quantity,
        price,
        currency,
        counterparty: cpRaw,
        counterparty_canonical_id: cpId,
        account: normalizeAccount(get(row, 'account') ?? ''),
        asset_class: 'EQUITY' as const,
        lineage: { raw_row_id: rawIdByIndex.get(i), profile_version: version, mapping_version: version }
      });
    } catch (err) {
      skipped++;
      bumpSkip('exception', i, row);
      logger.warn({ err, row_index: i }, 'feeds/process: row canonicalization threw');
    }
  }
  if (skipped > 0) {
    logger.warn({ skipped, skipReasons, sampleSkips }, 'feeds/process: rows skipped during canonicalization');
  }
  logger.info(
    { kgStats, uniqueCounterparties: kgCache.size, totalResolutions: Object.values(kgStats).reduce((a, b) => a + b, 0) },
    'counterparty resolution breakdown (KG-first, Postgres fallback)'
  );

  for (let i = 0; i < canonicalInserts.length; i += 200) {
    const { error } = await service.from('trades_canonical').insert(canonicalInserts.slice(i, i + 200));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 6b. Embed counterparty strings (deduped — 1 OpenAI call per unique CPY, not per trade)
  const uniqueCpys = Array.from(
    new Set(canonicalInserts.map((r) => String(r.counterparty ?? '')).filter(Boolean))
  );
  if (uniqueCpys.length > 0) {
    logger.info({ count: uniqueCpys.length }, 'feeds/process: embedding unique counterparties');
    try {
      const vecs = await embedBatch(uniqueCpys, user.id);
      for (let idx = 0; idx < uniqueCpys.length; idx++) {
        const name = uniqueCpys[idx]!;
        const vec = vecs[idx];
        if (!vec || vec.length === 0) continue;
        const { error: upErr } = await service
          .from('trades_canonical')
          .update({ counterparty_embedding: `[${vec.join(',')}]` })
          .eq('source_id', feedId)
          .eq('source_version', version)
          .eq('counterparty', name);
        if (upErr) logger.warn({ err: upErr, name }, 'embedding update failed for CPY');
      }
    } catch (err) {
      logger.error({ err }, 'feeds/process embedding step failed — continuing without');
    }
  }

  // 7. Audit
  await recordAudit({
    action: 'FEED_PROFILE_PROCESS',
    entity_type: 'feed_profile',
    entity_id: feedId,
    after: {
      name: parsed.data.name,
      version,
      mapping_count: mappingRows.length,
      rows_ingested: canonicalInserts.length,
      rows_skipped: skipped
    },
    reason: versionInfo.hasExisting ? `new version ${version}` : 'initial version'
  });

  // 8. Trigger matching cycle against Internal Blotter — but only if at
  if (!parsed.data.run_cycle) {
    return NextResponse.json({
      feed_id: feedId,
      version,
      mapping_count: mappingRows.length,
      rows_ingested: canonicalInserts.length,
      rows_skipped: skipped,
      skip_reasons: skipReasons,
      cycle_id: null
    });
  }

  // (run_cycle === true below — onboarding path)
  // Trigger matching cycle against Internal Blotter — but only if at
  //    least one row survived canonicalization. Running an empty cycle
  //    silently produces a 0-match, 0-exception result which the UI shows
  //    as "no open exceptions" — indistinguishable from a healthy run.
  let cycle_id: string | null = null;
  if (canonicalInserts.length === 0) {
    logger.warn(
      { feedId, skipReasons },
      'feeds/process: zero rows canonicalized — skipping matching cycle'
    );
  } else {
    const { data: internal } = await service
      .from('feed_profiles')
      .select('id, version')
      .eq('name', 'Internal Blotter')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!internal) {
      logger.error(
        { feedId },
        'feeds/process: Internal Blotter feed not found — cannot run cycle'
      );
    } else {
      try {
        // Every surviving row has a trade_date; reduce is safe with a real seed.
        const firstDate = canonicalInserts[0]!.trade_date as string;
        let minDate = firstDate;
        let maxDate = firstDate;
        for (const r of canonicalInserts) {
          const d = r.trade_date as string;
          if (d < minDate) minDate = d;
          if (d > maxDate) maxDate = d;
        }

        const cycleResult = await runMatchingCycle({
          supabase: service,
          feedAId: internal.id,
          feedAVersion: internal.version,
          feedBId: feedId,
          feedBVersion: version,
          dateFrom: minDate,
          dateTo: maxDate,
          initiatedBy: user.id,
          restrictByCounterpartyEntity: true,
          pipelineId: parsed.data.pipeline_id
        });
        cycle_id = cycleResult.cycle_id;
      } catch (err) {
        logger.error({ err, feedId }, 'feeds/process: matching cycle failed');
      }
    }
  }

  return NextResponse.json({
    feed_id: feedId,
    version,
    mapping_count: mappingRows.length,
    rows_ingested: canonicalInserts.length,
    rows_skipped: skipped,
    skip_reasons: skipReasons,
    cycle_id
  });
}
