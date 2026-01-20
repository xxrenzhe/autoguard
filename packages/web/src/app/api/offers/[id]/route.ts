import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne, queryAll, execute } from '@autoguard/shared';
import type { Offer, Page } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';

// 更新 Offer 的验证 schema
const updateOfferSchema = z.object({
  brand_name: z.string().min(1).max(100).optional(),
  brand_url: z.string().url().optional(),
  affiliate_link: z.string().url().optional(),
  target_countries: z.array(z.string()).optional(),
  cloak_enabled: z.boolean().optional(),
  status: z.enum(['draft', 'active', 'paused']).optional(),
});

type Params = { params: Promise<{ id: string }> };

// GET /api/offers/[id] - 获取单个 Offer
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
    'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
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
      ...offer,
      target_countries: offer.target_countries
        ? JSON.parse(offer.target_countries)
        : [],
      access_urls: {
        system: `https://${offer.subdomain}.autoguard.dev`,
        custom: offer.custom_domain_status === 'verified' ? `https://${offer.custom_domain}` : null,
      },
    },
  });
}

// PATCH /api/offers/[id] - 更新 Offer
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

  // 检查 Offer 是否存在且属于当前用户
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
    const data = updateOfferSchema.parse(body);

    // 构建更新 SQL
    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.brand_name !== undefined) {
      updates.push('brand_name = ?');
      values.push(data.brand_name);
    }
    if (data.brand_url !== undefined) {
      updates.push('brand_url = ?');
      values.push(data.brand_url);
    }
    if (data.affiliate_link !== undefined) {
      updates.push('affiliate_link = ?');
      values.push(data.affiliate_link);
    }
    if (data.target_countries !== undefined) {
      updates.push('target_countries = ?');
      updates.push('target_countries_updated_at = CURRENT_TIMESTAMP');
      values.push(JSON.stringify(data.target_countries));
    }
    if (data.cloak_enabled !== undefined) {
      updates.push('cloak_enabled = ?');
      values.push(data.cloak_enabled ? 1 : 0);
      if (data.cloak_enabled) {
        updates.push('cloak_enabled_at = CURRENT_TIMESTAMP');
      } else {
        updates.push('cloak_disabled_at = CURRENT_TIMESTAMP');
      }
    }
    if (data.status !== undefined) {
      // Precondition check for activating an offer
      if (data.status === 'active' && offer.status !== 'active') {
        // Check that at least one page is ready (generated or published)
        const readyPages = queryAll<Page>(
          `SELECT id FROM pages WHERE offer_id = ? AND status IN ('generated', 'published')`,
          [offerId]
        );

        if (readyPages.length === 0) {
          return NextResponse.json(
            {
              error: {
                code: 'PRECONDITION_FAILED',
                message: 'Cannot activate offer: at least one page must be ready (generated or published)',
              },
            },
            { status: 400 }
          );
        }

        // Check required fields are set
        if (!offer.affiliate_link) {
          return NextResponse.json(
            {
              error: {
                code: 'PRECONDITION_FAILED',
                message: 'Cannot activate offer: affiliate link is required',
              },
            },
            { status: 400 }
          );
        }
      }

      updates.push('status = ?');
      values.push(data.status);
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(offerId);

      execute(
        `UPDATE offers SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    // 返回更新后的 Offer
    const updatedOffer = queryOne<Offer>('SELECT * FROM offers WHERE id = ?', [offerId]);

    return NextResponse.json({
      success: true,
      data: updatedOffer,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('Update offer error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}

// DELETE /api/offers/[id] - 删除 Offer（软删除）
export async function DELETE(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  // 检查 Offer 是否存在且属于当前用户
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

  // 软删除
  execute(
    'UPDATE offers SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?',
    [offerId]
  );

  return NextResponse.json({
    success: true,
    message: 'Offer deleted',
  });
}
