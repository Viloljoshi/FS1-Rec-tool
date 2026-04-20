import { NextResponse } from 'next/server';
import { getCounterpartyCluster } from '@/lib/kg/queries';
import { getCurrentUser } from '@/lib/rbac/server';

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { id } = await context.params;
  try {
    const cluster = await getCounterpartyCluster(id);
    if (!cluster) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(cluster);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
