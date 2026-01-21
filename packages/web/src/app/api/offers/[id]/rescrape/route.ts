import { queryOne, execute, getRedis, CacheKeys } from '@autoguard/shared';
import type { Offer, Page } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

type Params = { params: Promise<{ id: string }> };

// POST /api/offers/[id]/rescrape - Trigger re-scraping of Money Page
export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  // Check Offer exists and belongs to user
  const offer = queryOne<Offer>(
    'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offerId, user.userId]
  );

  if (!offer) {
    return errors.notFound('Offer not found');
  }

  // Check not already scraping
  if (offer.scrape_status === 'scraping') {
    return errors.validation('Scraping is already in progress');
  }

  try {
    // Get or create Money Page
    let moneyPage = queryOne<Page>(
      `SELECT * FROM pages WHERE offer_id = ? AND page_type = 'money'`,
      [offerId]
    );

    if (!moneyPage) {
      // Create Money Page record
      const pageResult = execute(
        `INSERT INTO pages (offer_id, page_type, content_source, status)
         VALUES (?, 'money', 'scraped', 'generating')`,
        [offerId]
      );
      moneyPage = queryOne<Page>('SELECT * FROM pages WHERE id = ?', [pageResult.lastInsertRowid]);
    } else {
      // Update status to generating
      execute(
        `UPDATE pages SET status = 'generating', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [moneyPage.id]
      );
    }

    // Queue scrape job
    const redis = getRedis();
    const job = {
      pageId: moneyPage!.id,
      offerId: offerId,
      variant: 'a' as const,
      action: 'scrape' as const,
      sourceUrl: offer.brand_url,
      subdomain: offer.subdomain,
    };
    await redis.lpush(CacheKeys.queue.pageGeneration, JSON.stringify(job));

    // Update offer scrape status
    execute(
      'UPDATE offers SET scrape_status = ?, scrape_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['scraping', offerId]
    );

    return success(
      {
        offer_id: offerId,
        page_id: moneyPage!.id,
        scrape_status: 'scraping',
      },
      'Scrape job queued successfully'
    );
  } catch (error) {
    console.error('Rescrape error:', error);
    return errors.internal('Failed to queue scrape job');
  }
}
