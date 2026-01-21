import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne, queryAll, execute, safeJsonParse } from '@autoguard/shared';
import type { Offer, Page, PageType, ContentSource, SafePageType, PageStatus } from '@autoguard/shared';
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
    'SELECT * FROM pages WHERE offer_id = ? ORDER BY page_type ASC',
    [offerId]
  );

  // Map page_type to variant and status for frontend compatibility
  const mappedPages = pages.map((page) => {
    const generationParams = page.generation_params
      ? safeJsonParse<Record<string, unknown>>(page.generation_params, {})
      : null;
    const storedSourceUrl =
      generationParams && typeof generationParams.source_url === 'string'
        ? generationParams.source_url
        : null;

    // Map page_type -> variant (money = a, safe = b)
    const variant = page.page_type === 'money' ? 'a' : 'b';
    // Map status: generated/published -> ready for frontend
    const frontendStatus = page.status === 'generated' || page.status === 'published' ? 'ready' : page.status;

    return {
      id: page.id,
      offer_id: page.offer_id,
      variant,
      page_type: page.page_type,
      source_type: page.content_source,
      source_url: storedSourceUrl, // Stored in generation_params (if available)
      local_path: `/data/pages/${offer.subdomain}/${variant}/`,
      status: frontendStatus,
      meta: generationParams,
      safe_page_type: page.safe_page_type,
      competitors: page.competitors ? JSON.parse(page.competitors) : null,
      created_at: page.created_at,
      updated_at: page.updated_at,
    };
  });

  return NextResponse.json({
    success: true,
    data: {
      offer: {
        id: offer.id,
        brand_name: offer.brand_name,
        subdomain: offer.subdomain,
      },
      pages: mappedPages,
    },
  });
}

// POST /api/offers/[id]/pages - 创建或更新页面
const createPageSchema = z.object({
  page_type: z.enum(['money', 'safe'] as const),
  content_source: z.enum(['scraped', 'generated', 'manual'] as const).optional(),
  safe_page_type: z.enum(['review', 'tips', 'comparison', 'guide'] as const).optional(),
  competitors: z.array(z.string()).optional(),
  html_content: z.string().optional(),
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

    // 检查是否已存在该类型的页面
    const existingPage = queryOne<Page>(
      'SELECT * FROM pages WHERE offer_id = ? AND page_type = ?',
      [offerId, data.page_type]
    );

    if (existingPage) {
      // 更新现有页面
      execute(
        `UPDATE pages SET
          content_source = COALESCE(?, content_source),
          safe_page_type = COALESCE(?, safe_page_type),
          competitors = COALESCE(?, competitors),
          html_content = COALESCE(?, html_content),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [
          data.content_source || null,
          data.safe_page_type || null,
          data.competitors ? JSON.stringify(data.competitors) : null,
          data.html_content || null,
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
        `INSERT INTO pages (offer_id, page_type, content_source, safe_page_type, competitors, html_content, status)
         VALUES (?, ?, ?, ?, ?, ?, 'draft')`,
        [
          offerId,
          data.page_type,
          data.content_source || 'scraped',
          data.safe_page_type || null,
          data.competitors ? JSON.stringify(data.competitors) : null,
          data.html_content || null,
        ]
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
