import { NextResponse } from 'next/server';
import { z } from 'zod';
import { friendlyZodError } from '@/lib/api/errors';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseService } from '@/lib/supabase/service';
import { getCurrentUser } from '@/lib/rbac/server';
import { CANONICAL_FIELDS, type CanonicalField, missingRequiredFields } from '@/lib/canonical/schema';
import { SanitizedRowSchema } from '@/lib/canonical/row-sanitizer';
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

const IngestSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z.enum(['BROKER', 'CUSTODIAN', 'INTERNAL', 'OTHER']),
  notes: z.string().max(500).optional(),
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
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    if (user.role !== 'analyst' && user.role !== 'manager') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 });

    const parsed = IngestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(friendlyZodError(parsed.error), { status: 400 });
    }

    const mappedFields = parsed.data.mappings.map((m) => m.canonical_field);
    const missing = missingRequiredFields(mappedFields);
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: 'missing_required_fields',
          missing,
          message: `Feed is missing required canonical fields: ${missing.join(', ')}.`
        },
        { status: 400 }
      );
    }

    const supabase = await supabaseServer();
    const service = supabaseService();

    // 1. Resolve feed version
    const versionInfo = await resolveNextFeedVersion(supabase, parsed.data.name);
    await retirePriorFeedVersion(service, versionInfo);
    const feedId = versionInfo.feedId ?? crypto.randomUUID();
    const version = versionInfo.nextVersion;

    // 2. Insert feed_profile
    const { error: insErr } = await service.from('feed_profiles').insert({
      id: feedId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      version,
      notes: parsed.data.notes,
      created_by: user.id
    });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    // 3. Insert field_mappings
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

    // 4. Mapping index
    const byCanonical = new Map<CanonicalField, string>();
    for (const m of parsed.data.mappings) {
      byCanonical.set(m.canonical_field, m.source_field);
    }

    // 5. Insert trades_raw in batches
    const rowsToInsert = parsed.data.rows.map((r, i) => ({
      feed_profile_id: feedId,
      feed_profile_version: version,
      row_index: i,
      payload: r,
      uploaded_by: user.id
    }));
    const rawIdByIndex = new Map<number, string>();
    for (let i = 0; i < rowsToInsert.length; i += 200) {
      const { data: inserted, error } = await service
        .from('trades_raw')
        .insert(rowsToInsert.slice(i, i + 200))
        .select('id, row_index');
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const row of inserted ?? []) rawIdByIndex.set(row.row_index, row.id);
    }

    // 6. Counterparty resolution — Postgres only (no Neo4j on this path)
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
    const cpByNorm = new Map(
      (aliases ?? []).map((a) => [a.normalized_alias.toLowerCase(), a.entity_id])
    );

    const resolveCp = (cpRaw: string): string | null => {
      const key = cpRaw.toLowerCase().trim();
      if (!key) return null;
      const normKey = key.replace(/[.,&]/g, '').replace(/\s+/g, ' ').trim();
      return cpByName.get(key) ?? cpByAlias.get(key) ?? cpByNorm.get(normKey) ?? null;
    };

    // 7. Canonicalize rows
    const get = (row: Record<string, string>, cf: CanonicalField): string | undefined =>
      byCanonical.get(cf) ? row[byCanonical.get(cf)!] : undefined;

    const canonicalInserts: Array<Record<string, unknown>> = [];
    const skipReasons: Record<string, number> = {};
    let skipped = 0;

    for (let i = 0; i < parsed.data.rows.length; i++) {
      const row = parsed.data.rows[i]!;
      try {
        const tradeDate = tryNormalizeDate(get(row, 'trade_date') ?? get(row, 'settlement_date'));
        const settleDate =
          tryNormalizeDate(get(row, 'settlement_date') ?? get(row, 'trade_date')) ?? tradeDate;
        if (!tradeDate || !settleDate) {
          skipped++;
          skipReasons['unparseable_date'] = (skipReasons['unparseable_date'] ?? 0) + 1;
          continue;
        }

        const direction = tryNormalizeDirection(get(row, 'direction'));
        if (direction === null) {
          skipped++;
          skipReasons['invalid_direction'] = (skipReasons['invalid_direction'] ?? 0) + 1;
          continue;
        }

        const qtyResult = parseNumericStrict(get(row, 'quantity'));
        if (qtyResult.value === null || qtyResult.value <= 0) {
          skipped++;
          skipReasons['bad_quantity'] = (skipReasons['bad_quantity'] ?? 0) + 1;
          continue;
        }

        const priceResult = parseNumericStrict(get(row, 'price'));
        if (priceResult.value === null || priceResult.value < 0) {
          skipped++;
          skipReasons['bad_price'] = (skipReasons['bad_price'] ?? 0) + 1;
          continue;
        }

        const currency = tryNormalizeCurrency(get(row, 'currency') ?? 'USD');
        if (currency === null) {
          skipped++;
          skipReasons['invalid_currency'] = (skipReasons['invalid_currency'] ?? 0) + 1;
          continue;
        }

        const cpRaw = get(row, 'counterparty') ?? '';
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
          quantity: qtyResult.value,
          price: priceResult.value,
          currency,
          counterparty: cpRaw,
          counterparty_canonical_id: resolveCp(cpRaw),
          account: normalizeAccount(get(row, 'account') ?? ''),
          asset_class: 'EQUITY' as const,
          lineage: {
            raw_row_id: rawIdByIndex.get(i),
            profile_version: version,
            mapping_version: version
          }
        });
      } catch {
        skipped++;
        skipReasons['exception'] = (skipReasons['exception'] ?? 0) + 1;
      }
    }

    // 8. Insert trades_canonical in batches
    for (let i = 0; i < canonicalInserts.length; i += 200) {
      const { error } = await service
        .from('trades_canonical')
        .insert(canonicalInserts.slice(i, i + 200));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 9. Audit (inline — avoids pino import chain)
    await service.from('audit_events').insert({
      actor: user.id,
      action: 'FEED_PROFILE_PROCESS',
      entity_type: 'feed_profile',
      entity_id: feedId,
      before: null,
      after: {
        name: parsed.data.name,
        version,
        mapping_count: mappingRows.length,
        rows_ingested: canonicalInserts.length,
        rows_skipped: skipped
      },
      reason: versionInfo.hasExisting ? `new version ${version}` : 'initial version'
    });

    return NextResponse.json({
      feed_id: feedId,
      version,
      mapping_count: mappingRows.length,
      rows_ingested: canonicalInserts.length,
      rows_skipped: skipped,
      skip_reasons: skipReasons
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
