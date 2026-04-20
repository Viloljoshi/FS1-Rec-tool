import { NextResponse } from 'next/server';
import { z } from 'zod';
import { inferSchema } from '@/lib/ai/prompts/infer-schema';
import { getCurrentUser } from '@/lib/rbac/server';
import { SanitizedRowSchema } from '@/lib/canonical/row-sanitizer';
import { friendlyZodError } from '@/lib/api/errors';

const BodySchema = z.object({
  headers: z.array(z.string()).min(1).max(60),
  samples: z.array(SanitizedRowSchema).min(1).max(10)
});

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(friendlyZodError(parsed.error), { status: 400 });
  }

  const result = await inferSchema({
    headers: parsed.data.headers,
    samples: parsed.data.samples,
    actor: user.id
  });

  return NextResponse.json(result);
}
