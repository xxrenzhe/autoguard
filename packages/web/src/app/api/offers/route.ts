import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryAll, queryOne, execute, generateSubdomain } from '@autoguard/shared';
import type { Offer } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';

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
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
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

  return NextResponse.json({
    success: true,
    data: offers,
    meta: { page, limit, total },
  });
}

// POST /api/offers - 创建新 Offer
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
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
      return NextResponse.json(
        { error: { code: 'SUBDOMAIN_GENERATION_FAILED', message: 'Failed to generate subdomain' } },
        { status: 500 }
      );
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

    // 获取创建的 Offer
    const offer = queryOne<Offer>('SELECT * FROM offers WHERE id = ?', [offerId]);

    return NextResponse.json({
      success: true,
      data: {
        ...offer,
        access_urls: {
          system: `https://${subdomain}.autoguard.dev`,
          custom: null,
        },
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('Create offer error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
