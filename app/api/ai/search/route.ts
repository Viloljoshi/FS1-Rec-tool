import { NextResponse } from 'next/server';
import { z } from 'zod';
import { friendlyZodError } from '@/lib/api/errors';
import { parseSearchQuery } from '@/lib/ai/prompts/search';
import { getCurrentUser } from '@/lib/rbac/server';

const BodySchema = z.object({
  query: z.string().min(1).max(500)
});

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(friendlyZodError(parsed.error), { status: 400 });
  }

  const result = await parseSearchQuery({
    query: parsed.data.query,
    actor: user.id
  });
  return NextResponse.json(result);
}
