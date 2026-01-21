import { z } from 'zod';
import { queryOne, execute, getRedis, CacheKeys } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

// ISO 3166-1 alpha-2 country code pattern
const countryCodePattern = /^[A-Z]{2}$/;

const targetCountriesSchema = z
  .object({
    target_countries: z
      .array(z.string().regex(countryCodePattern, 'Invalid country code'))
      .max(250),
    // Backward-compatible alias
    countries: z
      .array(z.string().regex(countryCodePattern, 'Invalid country code'))
      .max(250)
      .optional(),
  })
  .transform((value) => ({
    target_countries: value.target_countries ?? value.countries ?? [],
  }));

type Params = { params: Promise<{ id: string }> };

// PATCH /api/offers/[id]/target-countries - Update target countries
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
    const data = targetCountriesSchema.parse(body);

    // Normalize: ensure uppercase and unique
    const normalizedCountries = [
      ...new Set(data.target_countries.map((c) => c.toUpperCase())),
    ];

    // Update target countries
    execute(
      `UPDATE offers SET
        target_countries = ?,
        target_countries_updated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [JSON.stringify(normalizedCountries), offerId]
    );

    // Invalidate Offer cache so Cloak Worker picks up changes immediately
    // The cloak worker caches offers by subdomain, so we must clear that cache
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
        target_countries: normalizedCountries,
        target_countries_updated_at: updatedOffer!.target_countries_updated_at,
      },
      '投放地区已更新'
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid input', { errors: error.errors });
    }

    console.error('Update target countries error:', error);
    return errors.internal('Failed to update target countries');
  }
}

// GET /api/offers/[id]/target-countries - Get target countries
export async function GET(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  const offer = queryOne<Offer>(
    'SELECT id, target_countries, target_countries_updated_at FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return errors.notFound('Offer not found');
  }

  const targetCountries = offer.target_countries ? JSON.parse(offer.target_countries) : [];

  return success({
    id: offer.id,
    target_countries: targetCountries,
    target_countries_updated_at: offer.target_countries_updated_at,
  });
}
