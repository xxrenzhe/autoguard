import { z } from 'zod';
import { queryAll, queryOne, execute, generateSubdomain, getRedis, CacheKeys } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, list, errors } from '@/lib/api-response';

// 创建 Offer 的验证 schema
const createOfferSchema = z.object({
  brand_name: z.string().min(1).max(100),
  brand_url: z.string().url(),
  affiliate_link: z.string().url(),
  target_countries: z.array(z.string()).optional(),
  cloak_enabled: z.boolean().optional(),
});

// GET /api/offers - 获取 Offer 列表
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const status = searchParams.get('status');

  const offset = (page - 1) * limit;

  let sql = 'SELECT * FROM offers WHERE user_id = ? AND is_deleted = 0';
  const params: unknown[] = [user.userId];

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const offers = queryAll<Offer>(sql, params);

  // 获取总数
  let countSql = 'SELECT COUNT(*) as count FROM offers WHERE user_id = ? AND is_deleted = 0';
  const countParams: unknown[] = [user.userId];
  if (status) {
    countSql += ' AND status = ?';
    countParams.push(status);
  }
  const countResult = queryOne<{ count: number }>(countSql, countParams);
  const total = countResult?.count || 0;

  return list(offers, { page, limit, total });
}

// POST /api/offers - 创建新 Offer
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  try {
    const body = await request.json();
    const data = createOfferSchema.parse(body);

    // 生成唯一子域名
    let subdomain: string;
    let attempts = 0;
    do {
      subdomain = generateSubdomain();
      const existing = queryOne<{ id: number }>(
        'SELECT id FROM offers WHERE subdomain = ?',
        [subdomain]
      );
      if (!existing) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
      return errors.internal('Failed to generate subdomain');
    }

    // 插入 Offer
    const result = execute(
      `INSERT INTO offers (
        user_id, brand_name, brand_url, affiliate_link,
        subdomain, cloak_enabled, target_countries, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.userId,
        data.brand_name,
        data.brand_url,
        data.affiliate_link,
        subdomain,
        data.cloak_enabled ? 1 : 0,
        data.target_countries ? JSON.stringify(data.target_countries) : null,
        'draft',
      ]
    );

    const offerId = result.lastInsertRowid;

    // 创建 Money Page 记录
    const pageResult = execute(
      `INSERT INTO pages (offer_id, page_type, content_source, status)
       VALUES (?, 'money', 'scraped', 'generating')`,
      [offerId]
    );
    const pageId = pageResult.lastInsertRowid;

    // 自动入队抓取任务（按文档设计）
    try {
      const redis = getRedis();
      const job = {
        pageId: Number(pageId),
        offerId: Number(offerId),
        variant: 'a' as const,
        action: 'scrape' as const,
        sourceUrl: data.brand_url,
        subdomain,
      };
      await redis.lpush(CacheKeys.queue.pageGeneration, JSON.stringify(job));

      // 更新 Offer 状态为 scraping
      execute('UPDATE offers SET scrape_status = ? WHERE id = ?', ['scraping', offerId]);
    } catch (queueError) {
      console.error('Failed to queue scrape job:', queueError);
      // 非阻塞：队列失败不影响 Offer 创建
    }

    // 获取创建的 Offer
    const offer = queryOne<Offer>('SELECT * FROM offers WHERE id = ?', [offerId]);

    return success(
      {
        ...offer,
        access_urls: {
          system: `https://${subdomain}.autoguard.dev`,
          custom: null,
        },
      },
      'Offer 创建成功，正在抓取页面'
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errors.validation('Invalid input', { errors: error.errors });
    }

    console.error('Create offer error:', error);
    return errors.internal();
  }
}
