import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne, queryAll, execute } from '@autoguard/shared';
import type { Offer, Page } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';

type Params = { params: Promise<{ id: string }> };

// GET /api/offers/[id]/pages - 获取 Offer 的页面列表
export async function GET(request: Request, { params }: Params) {
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

  // 获取页面列表
  const pages = queryAll<Page>(
    'SELECT * FROM pages WHERE offer_id = ? ORDER BY variant ASC',
    [offerId]
  );

  return NextResponse.json({
    success: true,
    data: {
      offer: {
        id: offer.id,
        brand_name: offer.brand_name,
        subdomain: offer.subdomain,
      },
      pages: pages.map((page) => ({
        ...page,
        meta: page.meta ? JSON.parse(page.meta) : null,
      })),
    },
  });
}

// POST /api/offers/[id]/pages - 创建或更新页面
const createPageSchema = z.object({
  variant: z.enum(['a', 'b']), // a = money page, b = safe page
  source_type: z.enum(['scrape', 'upload', 'ai_generate']),
  source_url: z.string().url().optional(),
  status: z.enum(['pending', 'generating', 'ready', 'failed']).optional(),
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
    const data = createPageSchema.parse(body);

    // 检查是否已存在该 variant 的页面
    const existingPage = queryOne<Page>(
      'SELECT * FROM pages WHERE offer_id = ? AND variant = ?',
      [offerId, data.variant]
    );

    if (existingPage) {
      // 更新现有页面
      execute(
        `UPDATE pages SET
          source_type = ?,
          source_url = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [
          data.source_type,
          data.source_url || null,
          data.status || 'pending',
          existingPage.id,
        ]
      );

      const updatedPage = queryOne<Page>('SELECT * FROM pages WHERE id = ?', [existingPage.id]);

      return NextResponse.json({
        success: true,
        data: updatedPage,
        message: 'Page updated',
      });
    } else {
      // 创建新页面
      const result = execute(
        `INSERT INTO pages (offer_id, variant, source_type, source_url, status)
         VALUES (?, ?, ?, ?, ?)`,
        [offerId, data.variant, data.source_type, data.source_url || null, data.status || 'pending']
      );

      const newPage = queryOne<Page>('SELECT * FROM pages WHERE id = ?', [result.lastInsertRowid]);

      return NextResponse.json({
        success: true,
        data: newPage,
        message: 'Page created',
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('Create/update page error:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
