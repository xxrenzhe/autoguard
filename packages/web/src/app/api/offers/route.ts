import { z } from 'zod';
import { queryAll, queryOne, execute, generateSubdomain, getRedis, CacheKeys, safeJsonParse } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { success, list, errors } from '@/lib/api-response';
import { withSnakeCaseAliases } from '@/lib/key-case';

// 创建 Offer 的验证 schema
const createOfferSchema = z.object({
  brand_name: z.string().min(1).max(100),
  brand_url: z.string().url(),
  affiliate_link: z.string().url(),
  target_countries: z.array(z.string()).optional(),
  cloak_enabled: z.boolean().optional(),
});

const offerListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['draft', 'active', 'paused']).optional(),
  search: z.string().trim().min(1).optional(),
  sort: z.enum(['created_at', 'updated_at', 'brand_name']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

type OfferListRow = Offer & {
  money_page_count: number;
  safe_page_count: number;
  total_visits: number;
  money_visits: number;
  safe_visits: number;
};

// GET /api/offers - 获取 Offer 列表
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const parsed = offerListQuerySchema.safeParse({
    page: searchParams.get('page') || 1,
    limit: searchParams.get('limit') || 20,
    status: searchParams.get('status') || undefined,
    search: searchParams.get('search') || undefined,
    sort: searchParams.get('sort') || 'created_at',
    order: searchParams.get('order') || 'desc',
  });

  if (!parsed.success) {
    return errors.validation('Invalid parameters', { errors: parsed.error.errors });
  }

  const { page, limit, status, search, sort, order } = parsed.data;
  const offset = (page - 1) * limit;

  let whereClause = 'WHERE o.user_id = ? AND o.is_deleted = 0';
  const whereParams: unknown[] = [user.userId];

  if (status) {
    whereClause += ' AND o.status = ?';
    whereParams.push(status);
  }

  if (search) {
    whereClause += ' AND o.brand_name LIKE ?';
    whereParams.push(`%${search}%`);
  }

  const rows = queryAll<OfferListRow>(
    `SELECT
      o.*,
      (SELECT COUNT(*) FROM pages p WHERE p.offer_id = o.id AND p.page_type = 'money' AND p.status IN ('generated', 'published')) as money_page_count,
      (SELECT COUNT(*) FROM pages p WHERE p.offer_id = o.id AND p.page_type = 'safe' AND p.status IN ('generated', 'published')) as safe_page_count,
      (SELECT COALESCE(SUM(ds.total_visits), 0) FROM daily_stats ds WHERE ds.offer_id = o.id) as total_visits,
      (SELECT COALESCE(SUM(ds.money_page_visits), 0) FROM daily_stats ds WHERE ds.offer_id = o.id) as money_visits,
      (SELECT COALESCE(SUM(ds.safe_page_visits), 0) FROM daily_stats ds WHERE ds.offer_id = o.id) as safe_visits
    FROM offers o
    ${whereClause}
    ORDER BY o.${sort} ${order}
    LIMIT ? OFFSET ?`,
    [...whereParams, limit, offset]
  );

  const countResult = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM offers o ${whereClause}`,
    whereParams
  );
  const total = countResult?.count || 0;

  const offers = rows.map((offer) => ({
    id: offer.id,
    brand_name: offer.brand_name,
    brand_url: offer.brand_url,
    affiliate_link: offer.affiliate_link,
    scrape_status: offer.scrape_status,
    status: offer.status,
    page_count: {
      money: offer.money_page_count || 0,
      safe: offer.safe_page_count || 0,
    },
    stats: {
      total_visits: offer.total_visits || 0,
      money_visits: offer.money_visits || 0,
      safe_visits: offer.safe_visits || 0,
    },
    subdomain: offer.subdomain,
    custom_domain: offer.custom_domain,
    custom_domain_status: offer.custom_domain_status,
    cloak_enabled: offer.cloak_enabled === 1,
    target_countries: offer.target_countries
      ? safeJsonParse<string[]>(offer.target_countries, [])
      : [],
    created_at: offer.created_at,
    updated_at: offer.updated_at,
  }));

  return list(offers, { page, limit, total });
}

// POST /api/offers - 创建新 Offer
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  try {
    const body = withSnakeCaseAliases(await request.json());
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
        cloak_enabled: Boolean(offer?.cloak_enabled),
        target_countries: offer?.target_countries
          ? safeJsonParse<string[]>(offer.target_countries, [])
          : [],
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
