import { z } from 'zod';
import { queryOne, safeJsonParse } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { makeDecision, initEngine, getDecisionReason } from '@autoguard/cloak';
import { success, errors } from '@/lib/api-response';

// Test cloak decision request schema
const testRequestSchema = z.object({
  // Either provide offer_id or subdomain
  offer_id: z.number().optional(),
  subdomain: z.string().optional(),

  // Visitor information to test
  ip: z.string().ip().optional().default('8.8.8.8'),
  user_agent: z.string().optional().default('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'),
  referer: z.string().optional().default(''),
  url: z.string().optional().default('/'),

  // Override settings
  cloak_enabled: z.boolean().optional(),
  target_countries: z.array(z.string()).optional(),
});

const testQuerySchema = z.object({
  offer_id: z.coerce.number().int().positive().optional(),
  subdomain: z.string().optional(),
  ip: z.string().ip().optional(),
  ua: z.string().optional(),
});

function getClientIpFromHeaders(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('cf-connecting-ip') ||
    headers.get('x-real-ip') ||
    '8.8.8.8'
  );
}

// POST /api/cloak/test - Test cloak decision (JSON body)
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  try {
    const body = await request.json();
    const data = testRequestSchema.parse(body);

    // Get the offer
    let offer: Offer | undefined;

    if (data.offer_id) {
      offer = queryOne<Offer>(
        'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
        [data.offer_id, user.userId]
      );
    } else if (data.subdomain) {
      offer = queryOne<Offer>(
        'SELECT * FROM offers WHERE subdomain = ? AND user_id = ? AND is_deleted = 0',
        [data.subdomain, user.userId]
      );
    }

    if (!offer) {
      return errors.notFound('Offer not found');
    }

    // Initialize engine if needed
    await initEngine();

    // Build cloak request
    const cloakRequest = {
      ip: data.ip,
      userAgent: data.user_agent,
      referer: data.referer,
      url: data.url,
      host: `${offer.subdomain}.autoguard.dev`,
    };

    // Get target countries from offer or override
    let targetCountries: string[] = [];
    if (data.target_countries) {
      targetCountries = data.target_countries;
    } else if (offer.target_countries) {
      try {
        targetCountries = JSON.parse(offer.target_countries);
      } catch {
        targetCountries = [];
      }
    }

    // Make decision
    const decision = await makeDecision(
      cloakRequest,
      offer.id,
      offer.user_id,
      {
        targetCountries,
        cloakEnabled: data.cloak_enabled ?? (offer.cloak_enabled === 1),
      }
    );

    // Build response
    return success({
      decision: decision.decision,
      score: decision.score,
      decision_reason: getDecisionReason(decision),
      blocked_at_layer: decision.blockedAt || null,
      processing_time_ms: decision.processingTime,
      details: decision.details,
      test_params: {
        ip: data.ip,
        ua: data.user_agent,
        referer: data.referer,
        url: data.url,
        cloak_enabled: data.cloak_enabled ?? (offer.cloak_enabled === 1),
        target_countries: targetCountries,
      },
      offer: {
        id: offer.id,
        brand_name: offer.brand_name,
        subdomain: offer.subdomain,
        status: offer.status,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid input', { errors: error.errors });
    }

    console.error('Cloak test error:', error);
    return errors.internal();
  }
}

// GET /api/cloak/test - Test cloak decision (query params, SystemDesign2-compatible)
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { searchParams } = new URL(request.url);
  let parsed: z.infer<typeof testQuerySchema>;
  try {
    parsed = testQuerySchema.parse({
      offer_id: searchParams.get('offer_id'),
      subdomain: searchParams.get('subdomain'),
      ip: searchParams.get('ip'),
      ua: searchParams.get('ua'),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid parameters', { errors: error.errors });
    }
    return errors.validation('Invalid parameters');
  }

  if (!parsed.offer_id && !parsed.subdomain) {
    return errors.validation('offer_id or subdomain is required');
  }

  const ip = parsed.ip || getClientIpFromHeaders(request.headers);
  const userAgent = parsed.ua || request.headers.get('user-agent') || '';

  const offer = parsed.offer_id
    ? queryOne<Offer>(
        'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
        [parsed.offer_id, user.userId]
      )
    : queryOne<Offer>(
        'SELECT * FROM offers WHERE subdomain = ? AND user_id = ? AND is_deleted = 0',
        [parsed.subdomain, user.userId]
      );

  if (!offer) {
    return errors.notFound('Offer not found');
  }

  await initEngine();

  const decision = await makeDecision(
    {
      ip,
      userAgent,
      referer: request.headers.get('referer') || '',
      url: searchParams.get('url') || '/',
      host: `${offer.subdomain}.autoguard.dev`,
    },
    offer.id,
    offer.user_id,
    {
      targetCountries: offer.target_countries
        ? safeJsonParse<string[]>(offer.target_countries, [])
        : [],
      cloakEnabled: offer.cloak_enabled === 1,
    }
  );

  return success({
    decision: decision.decision,
    score: decision.score,
    details: decision.details,
    processing_time_ms: decision.processingTime,
  });
}
