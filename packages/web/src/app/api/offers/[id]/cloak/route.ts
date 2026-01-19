import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne, execute, getRedis } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';

const cloakSchema = z.object({
  enabled: z.boolean(),
});

type Params = { params: Promise<{ id: string }> };

// PATCH /api/offers/[id]/cloak - Toggle cloak status
export async function PATCH(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  // Check offer exists and belongs to user
  const offer = queryOne<Offer>(
    'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Offer not found' } },
      { status: 404 }
    );
  }

  try {
    const body = await request.json();
    const data = cloakSchema.parse(body);

    // Update cloak status
    if (data.enabled) {
      execute(
        `UPDATE offers SET
          cloak_enabled = 1,
          cloak_enabled_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [offerId]
      );
    } else {
      execute(
        `UPDATE offers SET
          cloak_enabled = 0,
          cloak_disabled_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [offerId]
      );
    }

    // Update Redis cache for fast lookup
    try {
      const redis = getRedis();
      const cacheKey = `autoguard:offer:${offer.subdomain}:cloak`;
      await redis.set(cacheKey, data.enabled ? '1' : '0', 'EX', 3600);
    } catch (redisError) {
      console.error('Redis cache update failed:', redisError);
      // Continue even if Redis fails
    }

    // Return updated offer
    const updatedOffer = queryOne<Offer>('SELECT * FROM offers WHERE id = ?', [offerId]);

    return NextResponse.json({
      success: true,
      data: {
        id: updatedOffer!.id,
        cloak_enabled: Boolean(updatedOffer!.cloak_enabled),
        cloak_enabled_at: updatedOffer!.cloak_enabled_at,
        cloak_disabled_at: updatedOffer!.cloak_disabled_at,
      },
      message: data.enabled ? 'Cloak enabled' : 'Cloak disabled',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('Toggle cloak error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to toggle cloak' } },
      { status: 500 }
    );
  }
}

// GET /api/offers/[id]/cloak - Get cloak status
export async function GET(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  const offer = queryOne<Offer>(
    'SELECT id, cloak_enabled, cloak_enabled_at, cloak_disabled_at FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Offer not found' } },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      id: offer.id,
      cloak_enabled: Boolean(offer.cloak_enabled),
      cloak_enabled_at: offer.cloak_enabled_at,
      cloak_disabled_at: offer.cloak_disabled_at,
    },
  });
}
