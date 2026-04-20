import { NextResponse } from 'next/server';
import { searchCounterparties } from '@/lib/kg/queries';
import { getCurrentUser } from '@/lib/rbac/server';
import { logger } from '@/lib/logger/pino';

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const url = new URL(request.url);
  const q = url.searchParams.get('q') ?? '';
  const limit = Math.min(20, Number(url.searchParams.get('limit') ?? '10'));
  if (!q.trim()) return NextResponse.json({ results: [] });

  try {
    const results = await searchCounterparties(q, limit);
    return NextResponse.json({ results });
  } catch (err) {
    logger.error({ err, q, limit }, 'kg/search: Neo4j query failed');
    return NextResponse.json(
      { error: 'kg_search_failed', message: (err as Error).message },
      { status: 500 }
    );
  }
}
