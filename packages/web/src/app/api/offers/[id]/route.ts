import { z } from 'zod';
import { queryAll, queryOne, execute, safeJsonParse } from '@autoguard/shared';
import type { Offer, Page } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';
import { withSnakeCaseAliases } from '@/lib/key-case';

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

function mapPageStatus(status: Page['status']): string {
  if (status === 'generated' || status === 'published') return 'completed';
  return status;
}

// GET /api/offers/[id] - 获取单个 Offer
export async function GET(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  const offer = queryOne<Offer>(
    'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return errors.notFound('Offer not found');
  }

  const pages = queryAll<Page>(
    `SELECT * FROM pages WHERE offer_id = ? ORDER BY page_type ASC`,
    [offerId]
  );

  const visitStats = queryOne<{
    total_visits: number;
    money_visits: number;
    safe_visits: number;
  }>(
    `SELECT
      COALESCE(SUM(total_visits), 0) as total_visits,
      COALESCE(SUM(money_page_visits), 0) as money_visits,
      COALESCE(SUM(safe_page_visits), 0) as safe_visits
     FROM daily_stats
     WHERE offer_id = ?`,
    [offerId]
  ) || { total_visits: 0, money_visits: 0, safe_visits: 0 };

  return success({
    id: offer.id,
    brand_name: offer.brand_name,
    brand_url: offer.brand_url,
    affiliate_link: offer.affiliate_link,

    subdomain: offer.subdomain,
    custom_domain: offer.custom_domain,
    custom_domain_status: offer.custom_domain_status,
    custom_domain_verified_at: offer.custom_domain_verified_at,

    cloak_enabled: offer.cloak_enabled === 1,

    target_countries: offer.target_countries
      ? safeJsonParse<string[]>(offer.target_countries, [])
      : [],
    target_countries_updated_at: offer.target_countries_updated_at,

    scrape_status: offer.scrape_status,
    scrape_error: offer.scrape_error,
    scraped_at: offer.scraped_at,
    scraped_data: offer.scraped_data
      ? safeJsonParse<Record<string, unknown> | null>(offer.scraped_data, null)
      : null,
    page_title: offer.page_title,
    page_description: offer.page_description,

    status: offer.status,
    created_at: offer.created_at,
    updated_at: offer.updated_at,

    stats: {
      total_visits: visitStats.total_visits,
      money_visits: visitStats.money_visits,
      safe_visits: visitStats.safe_visits,
    },
    pages: pages.map((page) => ({
      id: page.id,
      page_type: page.page_type,
      safe_page_style: page.safe_page_type,
      status: mapPageStatus(page.status),
      view_count: page.page_type === 'money' ? visitStats.money_visits : visitStats.safe_visits,
    })),
    access_urls: {
      system: `https://${offer.subdomain}.autoguard.dev`,
      custom: offer.custom_domain_status === 'verified' ? `https://${offer.custom_domain}` : null,
    },
  });
}

// PATCH /api/offers/[id] - 更新 Offer
export async function PATCH(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  // 检查 Offer 是否存在且属于当前用户
  const offer = queryOne<Offer>(
    'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return errors.notFound('Offer not found');
  }

  try {
    const body = withSnakeCaseAliases(await request.json());
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
        // Check scrape is completed
        if (offer.scrape_status !== 'completed') {
          return errors.validation('Cannot activate offer: page scraping must be completed first');
        }

        // Check both Money and Safe pages are ready
        const moneyPage = queryOne<Page>(
          `SELECT id FROM pages WHERE offer_id = ? AND page_type = 'money' AND status IN ('generated', 'published')`,
          [offerId]
        );
        const safePage = queryOne<Page>(
          `SELECT id FROM pages WHERE offer_id = ? AND page_type = 'safe' AND status IN ('generated', 'published')`,
          [offerId]
        );

        if (!moneyPage || !safePage) {
          const missing = [];
          if (!moneyPage) missing.push('Money Page');
          if (!safePage) missing.push('Safe Page');
          return errors.validation(
            `Cannot activate offer: ${missing.join(' and ')} must be ready (generated or published)`
          );
        }

        // Check required fields are set
        if (!offer.affiliate_link) {
          return errors.validation('Cannot activate offer: affiliate link is required');
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

    if (!updatedOffer) {
      return errors.internal('Failed to load updated offer');
    }

    return success({
      ...updatedOffer,
      cloak_enabled: updatedOffer.cloak_enabled === 1,
      target_countries: updatedOffer.target_countries
        ? safeJsonParse<string[]>(updatedOffer.target_countries, [])
        : [],
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid input', { errors: error.errors });
    }

    console.error('Update offer error:', error);
    return errors.internal();
  }
}

// DELETE /api/offers/[id] - 删除 Offer（软删除）
export async function DELETE(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  // 检查 Offer 是否存在且属于当前用户
  const offer = queryOne<Offer>(
    'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return errors.notFound('Offer not found');
  }

  // 软删除
  execute(
    'UPDATE offers SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?',
    [offerId]
  );

  return success({ id: offerId, deleted: true }, 'Offer deleted');
}
