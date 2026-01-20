import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne, execute, getRedis, CacheKeys } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';

// ISO 3166-1 alpha-2 country code pattern
const countryCodePattern = /^[A-Z]{2}$/;

const targetCountriesSchema = z.object({
  countries: z.array(z.string().regex(countryCodePattern, 'Invalid country code')).max(250),
});

type Params = { params: Promise<{ id: string }> };

// PATCH /api/offers/[id]/target-countries - Update target countries
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
    const data = targetCountriesSchema.parse(body);

    // Normalize: ensure uppercase and unique
    const normalizedCountries = [...new Set(data.countries.map(c => c.toUpperCase()))];

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

    return NextResponse.json({
      success: true,
      data: {
        id: updatedOffer!.id,
        target_countries: normalizedCountries,
        target_countries_updated_at: updatedOffer!.target_countries_updated_at,
      },
      message: normalizedCountries.length > 0
        ? `Target regions updated to ${normalizedCountries.length} countries`
        : 'Target regions removed (global targeting)',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('Update target countries error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to update target countries' } },
      { status: 500 }
    );
  }
}

// GET /api/offers/[id]/target-countries - Get target countries
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
    'SELECT id, target_countries, target_countries_updated_at FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Offer not found' } },
      { status: 404 }
    );
  }

  const targetCountries = offer.target_countries ? JSON.parse(offer.target_countries) : [];

  return NextResponse.json({
    success: true,
    data: {
      id: offer.id,
      target_countries: targetCountries,
      target_countries_updated_at: offer.target_countries_updated_at,
      is_global: targetCountries.length === 0,
    },
  });
}
