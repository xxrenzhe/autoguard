import { queryAll, queryOne } from '@autoguard/shared';
import type { Page } from '@autoguard/shared';
import { getCurrentUser } from '@/lib/auth';
import { list, errors } from '@/lib/api-response';

interface PageWithOffer extends Page {
  brand_name: string;
  subdomain: string;
  offer_status: string;
}

type PageListItem = Omit<PageWithOffer, 'status'> & {
  status: string;
  db_status: PageWithOffer['status'];
  variant: 'a' | 'b';
};

function mapStatusToFrontend(status: PageWithOffer['status']): string {
  if (status === 'generated' || status === 'published') return 'ready';
  return status;
}

// GET /api/pages - Get all pages (global list)
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return errors.unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const pageType = searchParams.get('page_type') || searchParams.get('pageType'); // money | safe
  const status = searchParams.get('status'); // draft | generating | ready | failed | published | generated
  const offerId = searchParams.get('offer_id') || searchParams.get('offerId');
  const search = searchParams.get('search') || searchParams.get('q');

  const offset = (page - 1) * limit;

  let sql = `
    SELECT p.*, o.brand_name, o.subdomain, o.status as offer_status
    FROM pages p
    JOIN offers o ON o.id = p.offer_id
    WHERE o.user_id = ? AND o.is_deleted = 0
  `;
  const params: unknown[] = [user.userId];

  if (pageType) {
    sql += ' AND p.page_type = ?';
    params.push(pageType);
  }

  if (status) {
    if (status === 'ready') {
      sql += ` AND p.status IN ('generated', 'published')`;
    } else if (status === 'error') {
      sql += ` AND p.status = 'failed'`;
    } else {
      sql += ' AND p.status = ?';
      params.push(status);
    }
  }

  if (offerId) {
    sql += ' AND p.offer_id = ?';
    params.push(parseInt(offerId, 10));
  }

  if (search) {
    sql += ' AND (o.brand_name LIKE ? OR o.subdomain LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = queryAll<PageWithOffer>(sql, params);

  const pages: PageListItem[] = rows.map((row) => ({
    ...row,
    db_status: row.status,
    status: mapStatusToFrontend(row.status),
    variant: row.page_type === 'money' ? 'a' : 'b',
  }));

  // Get total count
  let countSql = `
    SELECT COUNT(*) as count
    FROM pages p
    JOIN offers o ON o.id = p.offer_id
    WHERE o.user_id = ? AND o.is_deleted = 0
  `;
  const countParams: unknown[] = [user.userId];

  if (pageType) {
    countSql += ' AND p.page_type = ?';
    countParams.push(pageType);
  }
  if (status) {
    if (status === 'ready') {
      countSql += ` AND p.status IN ('generated', 'published')`;
    } else if (status === 'error') {
      countSql += ` AND p.status = 'failed'`;
    } else {
      countSql += ' AND p.status = ?';
      countParams.push(status);
    }
  }
  if (offerId) {
    countSql += ' AND p.offer_id = ?';
    countParams.push(parseInt(offerId, 10));
  }
  if (search) {
    countSql += ' AND (o.brand_name LIKE ? OR o.subdomain LIKE ?)';
    countParams.push(`%${search}%`, `%${search}%`);
  }

  const countResult = queryOne<{ count: number }>(countSql, countParams);
  const total = countResult?.count || 0;

  return list(pages, { page, limit, total });
}
