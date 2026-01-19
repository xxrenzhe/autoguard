import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne, execute } from '@autoguard/shared';
import type { Offer, Page } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

// POST /api/offers/[id]/pages/generate - 触发页面生成
const generatePageSchema = z.object({
  variant: z.enum(['a', 'b']), // a = money page, b = safe page
  action: z.enum(['scrape', 'ai_generate']),
  source_url: z.string().url().optional(), // 仅 scrape 需要
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

    // 确定源 URL
    let sourceUrl: string;
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
      'SELECT * FROM pages WHERE offer_id = ? AND variant = ?',
      [offerId, data.variant]
    );

    if (page) {
      // 更新状态为生成中
      execute(
        `UPDATE pages SET
          source_type = ?,
          source_url = ?,
          status = 'generating',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [data.action === 'scrape' ? 'scrape' : 'ai_generate', sourceUrl, page.id]
      );
    } else {
      // 创建新页面记录
      const result = execute(
        `INSERT INTO pages (offer_id, variant, source_type, source_url, status)
         VALUES (?, ?, ?, ?, 'generating')`,
        [offerId, data.variant, data.action === 'scrape' ? 'scrape' : 'ai_generate', sourceUrl]
      );
      page = queryOne<Page>('SELECT * FROM pages WHERE id = ?', [result.lastInsertRowid]);
    }

    // 触发异步生成任务
    // 在生产环境中，这里应该将任务放入队列（如 Redis）
    // 然后由后台 worker 处理
    // 这里简化处理，直接返回生成中状态

    // TODO: 实际的页面生成逻辑
    // 可以通过以下方式实现:
    // 1. 将任务推送到 Redis 队列
    // 2. Page Generator worker 消费队列并处理
    // 3. 处理完成后更新数据库状态

    // 模拟：将生成任务信息存入 Redis
    // 实际实现时取消注释并配置 Redis
    /*
    import { redis } from '@autoguard/shared';
    await redis.lpush('page_generation_queue', JSON.stringify({
      pageId: page!.id,
      offerId,
      variant: data.variant,
      action: data.action,
      sourceUrl,
      subdomain: offer.subdomain,
    }));
    */

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
