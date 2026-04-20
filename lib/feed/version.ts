import type { SupabaseClient } from '@supabase/supabase-js';

export interface FeedVersionInfo {
  /** Existing feed id if any version of this name exists, else null. */
  feedId: string | null;
  /** Highest existing version for this name, 0 if new. */
  currentVersion: number;
  /** Version to use for the next insert (currentVersion + 1 or 1). */
  nextVersion: number;
  /** Whether a prior active version exists and needs to be retired. */
  hasExisting: boolean;
}

/**
 * Single source of truth for feed-profile versioning.
 *
 * Both `/api/feeds` (create) and `/api/feeds/process` (create-and-ingest)
 * need the same lookup: find the highest existing version for a given
 * profile name, and compute the next version number. Keeping this in one
 * place prevents drift — e.g., one route being hardened against a missing
 * row while the other still crashes.
 */
export async function resolveNextFeedVersion(
  sb: SupabaseClient,
  name: string
): Promise<FeedVersionInfo> {
  const { data, error } = await sb
    .from('feed_profiles')
    .select('id, version')
    .eq('name', name)
    .order('version', { ascending: false })
    .limit(1);

  if (error) throw error;

  const existing = data && data.length > 0 ? data[0]! : null;
  if (!existing) {
    return { feedId: null, currentVersion: 0, nextVersion: 1, hasExisting: false };
  }
  return {
    feedId: existing.id as string,
    currentVersion: existing.version as number,
    nextVersion: (existing.version as number) + 1,
    hasExisting: true
  };
}

/**
 * Marks the current version as retired. Call AFTER resolveNextFeedVersion
 * reports `hasExisting: true` and BEFORE inserting the new version row.
 * Idempotent: no-op when hasExisting is false.
 */
export async function retirePriorFeedVersion(
  sb: SupabaseClient,
  info: FeedVersionInfo
): Promise<void> {
  if (!info.hasExisting || !info.feedId) return;
  const { error } = await sb
    .from('feed_profiles')
    .update({ retired_at: new Date().toISOString() })
    .eq('id', info.feedId)
    .eq('version', info.currentVersion);
  if (error) throw error;
}
