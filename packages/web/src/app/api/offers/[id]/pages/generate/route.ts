import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne, execute, getRedis, CacheKeys } from '@autoguard/shared';
import type { Offer, Page } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

// POST /api/offers/[id]/pages/generate - 触发页面生成
const generatePageSchema = z.object({
  variant: z.enum(['a', 'b']), // a = money page, b = safe page
  action: z.enum(['scrape', 'ai_generate']),
  source_url: z.string().url().optional(), // 仅 scrape 需要
  safe_page_type: z.enum(['review', 'tips', 'comparison', 'guide']).optional(), // AI 生成时可选
  competitors: z.array(z.string().min(1).max(200)).max(50).optional(),
});

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

  // 验证 Offer 属于当前用户
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
    const data = generatePageSchema.parse(body);

    // Enforce generation methods per design:
    // - Money Page (A): scrape only
    // - Safe Page (B): AI generate only
    if (data.variant === 'a' && data.action !== 'scrape') {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Money Page (variant a) only supports scrape generation',
          },
        },
        { status: 400 }
      );
    }

    if (data.variant === 'b' && data.action !== 'ai_generate') {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Safe Page (variant b) only supports AI generation',
          },
        },
        { status: 400 }
      );
    }

    // 确定源 URL
    let sourceUrl: string;
    // 将 variant a/b 映射到 page_type money/safe
    const pageType = data.variant === 'a' ? 'money' : 'safe';
    const safePageType = pageType === 'safe' ? (data.safe_page_type || 'review') : null;
    const competitors = pageType === 'safe' ? (data.competitors || []) : null;

    if (data.action === 'scrape') {
      if (data.variant === 'a') {
        // Money page: 使用 brand_url 或提供的 URL
        sourceUrl = data.source_url || offer.brand_url;
      } else {
        // Safe page: 必须提供 URL 或从 brand_url 生成
        sourceUrl = data.source_url || offer.brand_url;
      }
    } else {
      // AI 生成不需要 source_url
      sourceUrl = offer.brand_url;
    }

    // 检查或创建页面记录
    let page = queryOne<Page>(
      'SELECT * FROM pages WHERE offer_id = ? AND page_type = ?',
      [offerId, pageType]
    );

    const generationParams =
      pageType === 'money'
        ? JSON.stringify({ source_url: sourceUrl })
        : JSON.stringify({ safe_page_type: safePageType, competitors });

    if (page) {
      // 更新状态为生成中
      execute(
        `UPDATE pages SET
          content_source = ?,
          safe_page_type = COALESCE(?, safe_page_type),
          competitors = COALESCE(?, competitors),
          generation_params = COALESCE(?, generation_params),
          generation_error = NULL,
          status = 'generating',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [
          data.action === 'scrape' ? 'scraped' : 'generated',
          safePageType,
          competitors ? JSON.stringify(competitors) : null,
          generationParams,
          page.id,
        ]
      );
    } else {
      // 创建新页面记录
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
          offerId,
          pageType,
          data.action === 'scrape' ? 'scraped' : 'generated',
          safePageType,
          competitors ? JSON.stringify(competitors) : null,
          generationParams,
        ]
      );
      page = queryOne<Page>('SELECT * FROM pages WHERE id = ?', [result.lastInsertRowid]);
    }

    // 触发异步生成任务 - 推送到 Redis 队列
    const redis = getRedis();
    const job = {
      pageId: page!.id,
      offerId,
      variant: data.variant,
      action: data.action,
      sourceUrl,
      subdomain: offer.subdomain,
      safePageType: safePageType || undefined,
      affiliateLink: offer.affiliate_link,
      competitors: competitors || undefined,
    };

    await redis.lpush(CacheKeys.queue.pageGeneration, JSON.stringify(job));

    return NextResponse.json({
      success: true,
      data: {
        page_id: page!.id,
        status: 'generating',
        message: `Page generation started. Variant: ${data.variant === 'a' ? 'Money' : 'Safe'}, Action: ${data.action}`,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('Generate page error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
