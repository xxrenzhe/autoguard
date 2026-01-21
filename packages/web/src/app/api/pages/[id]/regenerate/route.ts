import { queryOne, execute, getRedis, CacheKeys, safeJsonParse } from '@autoguard/shared';
import type { Offer, Page } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

type PageWithOffer = Page & { subdomain: string; user_id: number; brand_url: string; affiliate_link: string };

type Params = { params: Promise<{ id: string }> };

// POST /api/pages/[id]/regenerate - Requeue generation using stored params
export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { id } = await params;
  const pageId = parseInt(id, 10);
  if (Number.isNaN(pageId)) {
    return errors.validation('Invalid page id');
  }

  const page = queryOne<PageWithOffer>(
    `SELECT p.*, o.subdomain, o.user_id, o.brand_url, o.affiliate_link
     FROM pages p
     JOIN offers o ON o.id = p.offer_id
     WHERE p.id = ? AND o.is_deleted = 0`,
    [pageId]
  );

  if (!page) {
    return errors.notFound('Page not found');
  }

  if (page.user_id !== user.userId && user.role !== 'admin') {
    return errors.forbidden('Access denied');
  }

  const variant = page.page_type === 'money' ? 'a' : 'b';
  const action = page.page_type === 'money' ? 'scrape' : 'ai_generate';

  const generationParams = safeJsonParse<Record<string, unknown>>(page.generation_params || '{}', {});
  const sourceUrl =
    typeof generationParams.source_url === 'string' && generationParams.source_url.length > 0
      ? generationParams.source_url
      : page.brand_url;

  const safePageType =
    page.page_type === 'safe' ? (page.safe_page_type || 'review') : undefined;
  const competitors = page.page_type === 'safe'
    ? safeJsonParse<string[]>(page.competitors || '[]', [])
    : undefined;

  // Update page status
  execute(
    `UPDATE pages SET
      status = 'generating',
      generation_error = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
    [pageId]
  );

  // Money page re-scrape should update offer status
  if (page.page_type === 'money') {
    execute(
      `UPDATE offers SET
        scrape_status = 'scraping',
        scrape_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [page.offer_id]
    );
  }

  try {
    const redis = getRedis();
    await redis.lpush(
      CacheKeys.queue.pageGeneration,
      JSON.stringify({
        pageId,
        offerId: page.offer_id,
        variant,
        action,
        sourceUrl,
        subdomain: page.subdomain,
        safePageType,
        affiliateLink: page.affiliate_link,
        competitors,
      })
    );
  } catch (err) {
    console.error('Failed to queue regenerate job:', err);
    execute(
      `UPDATE pages SET status = 'failed', generation_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ['Failed to queue job', pageId]
    );
    return errors.internal('Failed to queue regenerate job');
  }

  return success(
    {
      id: pageId,
      offer_id: page.offer_id,
      page_type: page.page_type,
      status: 'generating',
    },
    'Page regeneration queued'
  );
}

