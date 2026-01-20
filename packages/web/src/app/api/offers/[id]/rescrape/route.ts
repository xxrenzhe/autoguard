import { NextResponse } from 'next/server';
import { queryOne, execute, getRedis, CacheKeys } from '@autoguard/shared';
import type { Offer, Page } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

// POST /api/offers/[id]/rescrape - Trigger re-scraping of Money Page
export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  const { id } = await params;
  const offerId = parseInt(id, 10);

  // Check Offer exists and belongs to user
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

  // Check not already scraping
  if (offer.scrape_status === 'scraping') {
    return NextResponse.json(
      { error: { code: 'ALREADY_IN_PROGRESS', message: 'Scraping is already in progress' } },
      { status: 400 }
    );
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

    return NextResponse.json({
      success: true,
      message: 'Scrape job queued successfully',
      data: {
        offer_id: offerId,
        page_id: moneyPage!.id,
        scrape_status: 'scraping',
      },
    });
  } catch (error) {
    console.error('Rescrape error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to queue scrape job' } },
      { status: 500 }
    );
  }
}
