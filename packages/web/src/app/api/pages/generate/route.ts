import { z } from 'zod';
import { queryOne, execute, getRedis, CacheKeys } from '@autoguard/shared';
import type { Offer, Page } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, errors } from '@/lib/api-response';

const generateSchema = z
  .object({
    offer_id: z.number().int().positive(),
    page_type: z.enum(['money', 'safe']),
    safe_page_style: z.enum(['review', 'tips', 'comparison', 'guide']).optional(),
    competitors: z.array(z.string().min(1).max(200)).max(50).optional(),
    source_url: z.string().url().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.page_type === 'safe' && !data.safe_page_style) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'safe_page_style is required when page_type is safe',
        path: ['safe_page_style'],
      });
    }

    if (data.page_type === 'money' && data.safe_page_style) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'safe_page_style is only allowed when page_type is safe',
        path: ['safe_page_style'],
      });
    }
  });

// POST /api/pages/generate - Generate page (SystemDesign2)
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errors.validation('Invalid JSON body');
  }

  const parsed = generateSchema.safeParse(payload);
  if (!parsed.success) {
    return errors.validation('Invalid input', { errors: parsed.error.errors });
  }

  const { offer_id, page_type, safe_page_style, competitors, source_url } = parsed.data;

  const offer = queryOne<Offer>(
    'SELECT * FROM offers WHERE id = ? AND user_id = ? AND is_deleted = 0',
    [offer_id, user.userId]
  );

  if (!offer) {
    return errors.notFound('Offer not found');
  }

  const variant = page_type === 'money' ? 'a' : 'b';
  const action = page_type === 'money' ? 'scrape' : 'ai_generate';
  const sourceUrl = action === 'scrape' ? source_url || offer.brand_url : offer.brand_url;

  const safePageType = page_type === 'safe' ? safe_page_style : undefined;
  const competitorList = page_type === 'safe' ? competitors || [] : undefined;

  const generationParams =
    page_type === 'money'
      ? JSON.stringify({ source_url: sourceUrl })
      : JSON.stringify({ safe_page_type: safePageType, competitors: competitorList });

  // Ensure page row exists
  let page = queryOne<Page>(
    'SELECT * FROM pages WHERE offer_id = ? AND page_type = ?',
    [offer.id, page_type]
  );

  if (page) {
    execute(
      `UPDATE pages SET
        status = 'generating',
        content_source = ?,
        generation_error = NULL,
        safe_page_type = ?,
        competitors = ?,
        generation_params = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        page_type === 'money' ? 'scraped' : 'generated',
        safePageType || null,
        competitorList ? JSON.stringify(competitorList) : null,
        generationParams,
        page.id,
      ]
    );
  } else {
    const result = execute(
      `INSERT INTO pages (
        offer_id,
        page_type,
        content_source,
        safe_page_type,
        competitors,
        generation_params,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, 'generating')`,
      [
        offer.id,
        page_type,
        page_type === 'money' ? 'scraped' : 'generated',
        safePageType || null,
        competitorList ? JSON.stringify(competitorList) : null,
        generationParams,
      ]
    );

    page = queryOne<Page>('SELECT * FROM pages WHERE id = ?', [result.lastInsertRowid]);
  }

  if (!page) {
    return errors.internal('Failed to create page record');
  }

  // Push job to queue
  try {
    const redis = getRedis();
    await redis.lpush(
      CacheKeys.queue.pageGeneration,
      JSON.stringify({
        pageId: page.id,
        offerId: offer.id,
        variant,
        action,
        sourceUrl,
        subdomain: offer.subdomain,
        safePageType,
        affiliateLink: offer.affiliate_link,
        competitors: competitorList,
      })
    );
  } catch (queueError) {
    console.error('Failed to queue page generation job:', queueError);
    execute(
      `UPDATE pages SET status = 'failed', generation_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ['Failed to queue job', page.id]
    );
    return errors.internal('Failed to queue page generation job');
  }

  if (page_type === 'money') {
    execute(
      `UPDATE offers SET
        scrape_status = 'scraping',
        scrape_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [offer.id]
    );
  }

  return success(
    {
      id: page.id,
      offer_id: offer.id,
      page_type,
      status: 'generating',
    },
    '页面生成中，预计需要 1-2 分钟'
  );
}

