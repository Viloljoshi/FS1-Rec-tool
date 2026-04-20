import { NextResponse } from 'next/server';
import { z } from 'zod';
import { friendlyZodError } from '@/lib/api/errors';
import { supabaseServer } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/rbac/server';
import { recordAudit } from '@/lib/audit/log';
import { CANONICAL_FIELDS } from '@/lib/canonical/schema';
import { resolveNextFeedVersion, retirePriorFeedVersion } from '@/lib/feed/version';

const CreateFeedSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z.enum(['BROKER', 'CUSTODIAN', 'INTERNAL', 'OTHER']),
  notes: z.string().max(500).optional(),
  mappings: z.array(
    z.object({
      source_field: z.string().min(1),
      canonical_field: z.enum(CANONICAL_FIELDS),
      confidence: z.number().min(0).max(1).optional(),
      ai_reasoning: z.string().max(500).optional()
    })
  ).min(1)
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from('feed_profiles')
    .select('id, name, kind, version, notes, created_at, retired_at, created_by')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ feeds: data });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (user.role !== 'analyst' && user.role !== 'manager') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const parsed = CreateFeedSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(friendlyZodError(parsed.error), { status: 400 });
  }

  const supabase = await supabaseServer();

  // Determine version via shared version resolver
  const versionInfo = await resolveNextFeedVersion(supabase, parsed.data.name);
  await retirePriorFeedVersion(supabase, versionInfo);
  const feedId = versionInfo.feedId ?? crypto.randomUUID();
  const version = versionInfo.nextVersion;

  const { data: inserted, error: insErr } = await supabase
    .from('feed_profiles')
    .insert({
      id: feedId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      version,
      notes: parsed.data.notes,
      created_by: user.id
    })
    .select()
    .single();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const mappingRows = parsed.data.mappings.map((m) => ({
    feed_profile_id: feedId,
    feed_profile_version: version,
    source_field: m.source_field,
    canonical_field: m.canonical_field,
    confidence: m.confidence ?? null,
    ai_reasoning: m.ai_reasoning ?? null,
    confirmed_by: user.id
  }));

  const { error: mapErr } = await supabase.from('field_mappings').insert(mappingRows);
  if (mapErr) return NextResponse.json({ error: mapErr.message }, { status: 500 });

  await recordAudit({
    action: 'FEED_PROFILE_CREATE',
    entity_type: 'feed_profile',
    entity_id: feedId,
    after: { name: parsed.data.name, version, kind: parsed.data.kind, mapping_count: mappingRows.length },
    reason: versionInfo.hasExisting ? `new version ${version}` : 'initial version'
  });

  return NextResponse.json({ feed: inserted, mapping_count: mappingRows.length });
}
