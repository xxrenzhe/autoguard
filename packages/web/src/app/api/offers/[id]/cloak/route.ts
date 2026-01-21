import { z } from 'zod';
import { queryOne, execute, getRedis, CacheKeys } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

const cloakSchema = z.object({
  enabled: z.boolean(),
});

type Params = { params: Promise<{ id: string }> };

// PATCH /api/offers/[id]/cloak - Toggle cloak status
export async function PATCH(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  // Check offer exists and belongs to user
  const offer = queryOne<Offer>(
    'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return errors.notFound('Offer not found');
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

    // Invalidate Offer cache so Cloak Worker picks up changes immediately
    try {
      const redis = getRedis();
      // Clear the offer subdomain cache (this is what cloak worker reads)
      await redis.del(CacheKeys.offer.bySubdomain(offer.subdomain));
      // Also clear by id if cached
      await redis.del(CacheKeys.offer.byId(offerId));
      // Clear custom domain cache if applicable
      if (offer.custom_domain) {
        await redis.del(CacheKeys.offer.byDomain(offer.custom_domain));
      }
    } catch (redisError) {
      console.error('Redis cache invalidation failed:', redisError);
    }

    // Return updated offer
    const updatedOffer = queryOne<Offer>('SELECT * FROM offers WHERE id = ?', [offerId]);

    return success(
      {
        id: updatedOffer!.id,
        cloak_enabled: Boolean(updatedOffer!.cloak_enabled),
        cloak_enabled_at: updatedOffer!.cloak_enabled_at,
        cloak_disabled_at: updatedOffer!.cloak_disabled_at,
      },
      data.enabled ? 'Cloak enabled' : 'Cloak disabled'
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid input', { errors: error.errors });
    }

    console.error('Toggle cloak error:', error);
    return errors.internal('Failed to toggle cloak');
  }
}

// GET /api/offers/[id]/cloak - Get cloak status
export async function GET(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  const offer = queryOne<Offer>(
    'SELECT id, cloak_enabled, cloak_enabled_at, cloak_disabled_at FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return errors.notFound('Offer not found');
  }

  return success({
    id: offer.id,
    cloak_enabled: Boolean(offer.cloak_enabled),
    cloak_enabled_at: offer.cloak_enabled_at,
    cloak_disabled_at: offer.cloak_disabled_at,
  });
}
