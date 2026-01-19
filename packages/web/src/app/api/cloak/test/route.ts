import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { makeDecision, initEngine, getDecisionReason } from '@autoguard/cloak';

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

// POST /api/cloak/test - Test cloak decision
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
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
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Offer not found or access denied' } },
        { status: 404 }
      );
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
    return NextResponse.json({
      success: true,
      data: {
        // Decision result
        decision: decision.decision,
        variant: decision.decision === 'money' ? 'a' : 'b',
        score: decision.score,
        reason: getDecisionReason(decision),

        // Detailed breakdown
        blockedAt: decision.blockedAt || null,
        processingTime: decision.processingTime,

        // Detection layer details
        details: {
          l1: decision.details.l1 || null,
          l2: decision.details.l2 || null,
          l3: decision.details.l3 || null,
          l4: decision.details.l4 || null,
          l5: decision.details.l5 || null,
        },

        // Test parameters used
        testParams: {
          ip: data.ip,
          user_agent: data.user_agent,
          referer: data.referer,
          url: data.url,
          cloak_enabled: data.cloak_enabled ?? (offer.cloak_enabled === 1),
          target_countries: targetCountries,
        },

        // Offer info
        offer: {
          id: offer.id,
          brand_name: offer.brand_name,
          subdomain: offer.subdomain,
          status: offer.status,
        },

        // Page that would be shown
        resultPage: {
          type: decision.decision === 'money' ? 'Money Page' : 'Safe Page',
          path: `/internal/pages/${offer.subdomain}/${decision.decision === 'money' ? 'a' : 'b'}/index.html`,
        },
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('Cloak test error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

// GET /api/cloak/test - Get test info and available options
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      description: 'Test cloak decision for an offer with custom visitor parameters',
      method: 'POST',
      parameters: {
        offer_id: {
          type: 'number',
          required: false,
          description: 'Offer ID (either offer_id or subdomain required)',
        },
        subdomain: {
          type: 'string',
          required: false,
          description: 'Offer subdomain (either offer_id or subdomain required)',
        },
        ip: {
          type: 'string',
          required: false,
          default: '8.8.8.8',
          description: 'IP address to test',
        },
        user_agent: {
          type: 'string',
          required: false,
          default: 'Mozilla/5.0...',
          description: 'User-Agent string to test',
        },
        referer: {
          type: 'string',
          required: false,
          default: '',
          description: 'Referer header to test',
        },
        url: {
          type: 'string',
          required: false,
          default: '/',
          description: 'Request URL to test',
        },
        cloak_enabled: {
          type: 'boolean',
          required: false,
          description: 'Override cloak enabled setting',
        },
        target_countries: {
          type: 'string[]',
          required: false,
          description: 'Override target countries (ISO codes)',
        },
      },
      example: {
        offer_id: 1,
        ip: '203.0.113.50',
        user_agent: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
        cloak_enabled: true,
        target_countries: ['US', 'CA', 'GB'],
      },
    },
  });
}
